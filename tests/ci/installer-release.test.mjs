import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

const exec = promisify(execFile);
const workflow = parse(
  await readFile(new URL("../../.github/workflows/installers.yml", import.meta.url), "utf8"),
);
const steps = workflow.jobs.installer.steps;

function script(name) {
  const step = steps.find((entry) => entry.name === name);
  assert.ok(step, name);
  const match = step.run.match(/^node --input-type=module <<'NODE'\n([\s\S]*)\nNODE\s*$/);
  assert.ok(match, `${name}: executable Node script`);
  return match[1];
}

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "openzwork-release-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "packages/desktop/dist"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ version: "3.15.1" }),
  );
  // Desktop 包没有独立版本；正式打包从根 package.json 取应用版本。
  await writeFile(
    join(cwd, "packages/desktop/package.json"),
    JSON.stringify({ name: "@zcode/desktop", private: true }),
  );
  const git = (...args) => exec("git", [
    "-c", "core.hooksPath=", "-c", "commit.gpgsign=false",
    "-c", "tag.gpgsign=false", ...args,
  ], { cwd });
  await git("init");
  await git("add", ".");
  await git(
    "-c", "user.name=Release fixture", "-c", "user.email=release@example.invalid",
    "commit", "-m", "fixture",
  );
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("tag", "v3.15.1-openzwork");
  await git("tag", "v3.16.1-openzwork");
  const env = {
    ...process.env,
    RELEASE_TAG: "v3.15.1-openzwork",
    RELEASE_COMMIT: sha,
    RELEASE_OS: "win",
    RELEASE_ARCH: "x64",
    RELEASE_PLATFORM: "windows-amd64",
    ZCODE_ENV: "production",
    ZCODE_PREVIEW_IDENTITY: "0",
    GITHUB_REPOSITORY: "BlueSkyXN/OpenZWork",
    GITHUB_RUN_ID: "123",
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
  };
  return {
    cwd,
    sha,
    run: (name, overrides = {}) => exec(
      process.execPath, ["--input-type=module", "--eval", script(name)],
      { cwd, env: { ...env, ...overrides } },
    ),
  };
}

test("release source validation accepts the exact tag and rejects incomplete or mismatched inputs", async (t) => {
  const f = await fixture(t);
  const name = "Verify release source";
  await f.run(name);
  await f.run(name, { RELEASE_TAG: "", RELEASE_COMMIT: "" });
  for (const overrides of [
    { RELEASE_TAG: "" },
    { RELEASE_COMMIT: "" },
    { RELEASE_COMMIT: "b".repeat(40) },
    { RELEASE_TAG: "v3.16.1-openzwork" },
    { RELEASE_TAG: "main" },
  ]) await assert.rejects(f.run(name, overrides));
});

test("production installers use verified tag sources before installing dependencies", () => {
  const job = workflow.jobs.installer;
  assert.equal(job.env.ZCODE_ENV, "${{ inputs.release_tag && 'production' || '' }}");
  assert.equal(job.env.ZCODE_PREVIEW_IDENTITY, "0");
  assert.equal(job.env.ZCODE_ENABLE_MAC_SIGN, "0");
  assert.equal(job.env.ZCODE_ENABLE_WINDOWS_SIGN, "0");
  assert.equal(steps[0].with.ref, "${{ inputs.release_tag || github.ref }}");
  const verify = steps.findIndex((step) => step.name === "Verify release source");
  const install = steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  assert.ok(verify >= 0 && verify < install);
  assert.notEqual(steps[verify]["continue-on-error"], true);
  assert.match(workflow.concurrency.group, /inputs\.release_tag \|\| github\.ref/);
});

test("release manifest hashes the installer and excludes unpacked executables", async (t) => {
  const f = await fixture(t);
  const root = join(f.cwd, "packages/desktop/dist");
  const name = "OpenZWork-3.15.1-win-x64.exe";
  const bytes = Buffer.from("installer fixture\n");
  await writeFile(join(root, name), bytes);
  await mkdir(join(root, "win-unpacked"));
  await writeFile(join(root, "win-unpacked/OpenZWork.exe"), "not an installer");
  await f.run("Record release installer provenance");
  const manifest = JSON.parse(await readFile(join(root, "RELEASE-MANIFEST.json"), "utf8"));
  assert.equal(manifest.sourceCommit, f.sha);
  assert.equal(manifest.sourceTag, "v3.15.1-openzwork");
  assert.equal(manifest.workflowCommit, "a".repeat(40));
  assert.equal(manifest.productName, "OpenZWork");
  assert.equal(manifest.environment, "production");
  assert.deepEqual(manifest.assets, [{
    name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  }]);
  await assert.rejects(f.run("Record release installer provenance", { ZCODE_ENV: "test" }));
  await writeFile(join(root, name), "");
  await assert.rejects(f.run("Record release installer provenance"));
  await rm(join(root, name));
  await assert.rejects(f.run("Record release installer provenance"));
});

test("Linux manifest accepts format-specific x64 aliases and rejects ambiguous installers", async (t) => {
  const f = await fixture(t);
  const root = join(f.cwd, "packages/desktop/dist");
  // 实际 electron-builder 输出：AppImage/rpm=x86_64，deb=amd64，pacman=x64。
  const names = [
    "OpenZWork-3.15.1-linux-x86_64.AppImage",
    "OpenZWork-3.15.1-linux-amd64.deb",
    "OpenZWork-3.15.1-linux-x86_64.rpm",
    "OpenZWork-3.15.1-linux-x64.pkg.tar.zst",
  ];
  for (const name of names) await writeFile(join(root, name), `fixture: ${name}`);
  const env = { RELEASE_OS: "linux", RELEASE_PLATFORM: "linux-amd64" };
  await f.run("Record release installer provenance", env);
  const manifest = JSON.parse(await readFile(join(root, "RELEASE-MANIFEST.json"), "utf8"));
  assert.deepEqual(manifest.assets.map(asset => asset.name), names);
  await writeFile(join(root, "OpenZWork-3.15.1-linux-x64.AppImage"), "ambiguous");
  await assert.rejects(f.run("Record release installer provenance", env));
});
