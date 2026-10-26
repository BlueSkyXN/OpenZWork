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
const extended = parse(
  await readFile(new URL("../../.github/workflows/extended-checks.yml", import.meta.url), "utf8"),
);

function script(name, sourceSteps = steps) {
  const step = sourceSteps.find((entry) => entry.name === name);
  assert.ok(step, name);
  const match = step.run.match(/^node --input-type=module <<'NODE'\n([\s\S]*)\nNODE\s*$/);
  assert.ok(match, `${name}: executable Node script`);
  return match[1];
}

async function fixture(t, version = "3.15.1") {
  const cwd = await mkdtemp(join(tmpdir(), "openzwork-release-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "packages/desktop/dist"), { recursive: true });
  if (version.includes("+openzwork.")) {
    // 此测试只执行 workflow 编排；真实包字段验证由独立校验器与三平台构建负责。
    await mkdir(join(cwd, "scripts"));
    await writeFile(join(cwd, "scripts/verify-desktop-release-version.mjs"),
      'export async function verifyPackagedVersion({ version }) { return { version, fixture: true }; }\n');
    await writeFile(join(cwd, "packages/desktop/dist/VERSION-VERIFICATION.json"), JSON.stringify({ version, fixture: true }));
  }
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ version }),
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
  if (version.includes("+openzwork.")) await git("tag", `v${version}`);
  const env = {
    ...process.env,
    RELEASE_TAG: version.includes("+openzwork.") ? `v${version}` : "v3.15.1-openzwork",
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
    run: (name, overrides = {}, sourceSteps = steps) => exec(
      process.execPath, ["--input-type=module", "--eval", script(name, sourceSteps)],
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

test("修订版完整版本贯穿源码校验、安装文件名与来源清单", async (t) => {
  const version = "3.16.2+openzwork.1";
  const f = await fixture(t, version);
  await f.run("Verify release source");
  await f.run("Verify packaged release version");
  await assert.rejects(f.run("Verify release source", { RELEASE_TAG: "v3.15.1-openzwork" }));
  const name = `OpenZWork-${version}-win-x64.exe`;
  await writeFile(join(f.cwd, "packages/desktop/dist", name), "installer fixture");
  await f.run("Record release installer provenance");
  const manifest = JSON.parse(await readFile(join(f.cwd, "packages/desktop/dist/RELEASE-MANIFEST.json"), "utf8"));
  assert.equal(manifest.version, version);
  assert.equal(manifest.sourceTag, `v${version}`);
  assert.equal(manifest.upstreamVersion, "3.16.2");
  assert.equal(manifest.releaseRevision, "1");
  assert.equal(manifest.nativeBuildVersion, "3.16.2.1");
  assert.equal(manifest.assets[0].name, name);
});

test("frozen-source validation records the checked commit and rejects a mismatched source", async (t) => {
  const f = await fixture(t);
  const name = "Record validation source";
  const historical = extended.jobs["historical-tests"];
  const sourceSteps = historical.steps;
  await f.run(name, { SOURCE_COMMIT: f.sha, ZCODE_TEST_POOL: "forks" }, sourceSteps);
  const record = JSON.parse(await readFile(join(f.cwd, ".run-logs/full-groups/source.json"), "utf8"));
  assert.equal(record.sourceCommit, f.sha);
  assert.match(record.sourceTree, /^[a-f0-9]{40}$/);
  assert.equal(record.workflowCommit, "a".repeat(40));
  assert.equal(record.testPool, "forks");
  await assert.rejects(f.run(name, { SOURCE_COMMIT: "b".repeat(40) }, sourceSteps));
  await assert.rejects(f.run(name, { SOURCE_COMMIT: "main" }, sourceSteps));
  await f.run(name, { SOURCE_COMMIT: "" }, sourceSteps);
  for (const job of Object.values(extended.jobs)) {
    assert.equal(job.steps[0].with.ref, "${{ inputs.source_commit || github.sha }}");
    assert.equal(script(name, job.steps), script(name, sourceSteps));
    assert.ok(job.steps.findIndex(step => step.name === name) < job.steps.findIndex(step => step.run?.startsWith("pnpm install")));
  }
  assert.equal(historical.env.ZCODE_TEST_POOL, "${{ matrix.platform == 'windows-amd64' && 'forks' || 'threads' }}");
});

test("production installers use verified tag sources before installing dependencies", () => {
  const job = workflow.jobs.installer;
  assert.equal(job.env.ZCODE_ENV, "${{ (inputs.release_tag || github.ref_type == 'tag') && 'production' || '' }}");
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
