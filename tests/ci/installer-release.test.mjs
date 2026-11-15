import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  // 步骤可在 heredoc 前后带 shell 前言/收尾（set -euo pipefail、job summary），只取 Node 段。
  const match = step.run.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n\s*NODE\b/);
  assert.ok(match, `${name}: executable Node script`);
  return match[1];
}

async function fixture(t, version = "3.15.1") {
  const cwd = await mkdtemp(join(tmpdir(), "openzwork-release-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "packages/desktop/dist"), { recursive: true });
  await mkdir(join(cwd, "scripts"), { recursive: true });
  // 清单步骤按 workflow 内的相对路径 import 真实模块：把实现与它依赖的身份函数复制进
  // 夹具，测试执行的是生产代码本身（不是 YAML 里是否出现某个字符串）。
  await cp(
    new URL("../../scripts/installer-provenance.mjs", import.meta.url),
    join(cwd, "scripts/installer-provenance.mjs"),
  );
  await mkdir(join(cwd, "packages/desktop/scripts"), { recursive: true });
  await cp(
    new URL("../../packages/desktop/scripts/desktop-product-identity.mjs", import.meta.url),
    join(cwd, "packages/desktop/scripts/desktop-product-identity.mjs"),
  );
  if (version.includes("+openzwork.")) {
    // 此测试只执行 workflow 编排；真实包字段验证由独立校验器与三平台构建负责。
    await writeFile(
      join(cwd, "scripts/verify-desktop-release-version.mjs"),
      "export async function verifyPackagedVersion({ version }) { return { version, fixture: true }; }\n",
    );
    await writeFile(
      join(cwd, "packages/desktop/dist/VERSION-VERIFICATION.json"),
      JSON.stringify({ version, fixture: true }),
    );
  }
  await writeFile(join(cwd, "package.json"), JSON.stringify({ version }));
  // Desktop 包没有独立版本；正式打包从根 package.json 取应用版本。
  await writeFile(
    join(cwd, "packages/desktop/package.json"),
    JSON.stringify({ name: "@zcode/desktop", private: true }),
  );
  const git = (...args) =>
    exec(
      "git",
      ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
      { cwd },
    );
  await git("init");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Release fixture",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("tag", "v3.15.1-openzwork");
  await git("tag", "v3.16.1-openzwork");
  if (version.includes("+openzwork.")) await git("tag", `v${version}`);
  const env = {
    ...process.env,
    RELEASE_TAG: version.includes("+openzwork.") ? `v${version}` : "v3.15.1-openzwork",
    // 清单步骤读 SOURCE_TAG（= release_tag || tag 名），与 workflow env 同形。
    SOURCE_TAG: version.includes("+openzwork.") ? `v${version}` : "v3.15.1-openzwork",
    RELEASE_COMMIT: sha,
    // 清单步骤取 `inputs.release_commit || inputs.source_commit || github.sha`。
    EXPECTED_COMMIT: sha,
    RELEASE_OS: "win",
    RELEASE_ARCH: "x64",
    RELEASE_PLATFORM: "windows-amd64",
    ZCODE_ENV: "production",
    ZCODE_PREVIEW_IDENTITY: "0",
    // 清单步骤的路由输入：本夹具一律走正式 tag 路由。
    IS_RELEASE: "1",
    IS_BUILD_PRODUCTION: "0",
    GITHUB_REPOSITORY: "BlueSkyXN/OpenZWork",
    GITHUB_RUN_ID: "123",
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
  };
  return {
    cwd,
    sha,
    run: (name, overrides = {}, sourceSteps = steps) =>
      exec(process.execPath, ["--input-type=module", "--eval", script(name, sourceSteps)], {
        cwd,
        env: { ...env, ...overrides },
      }),
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
  ])
    await assert.rejects(f.run(name, overrides));
});

test("修订版完整版本贯穿源码校验、安装文件名与来源清单", async (t) => {
  const version = "3.16.2+openzwork.1";
  const f = await fixture(t, version);
  await f.run("Verify release source");
  await f.run("Verify packaged release version");
  await assert.rejects(f.run("Verify release source", { RELEASE_TAG: "v3.15.1-openzwork" }));
  const name = `OpenZWork-${version}-win-x64.exe`;
  await writeFile(join(f.cwd, "packages/desktop/dist", name), "installer fixture");
  await f.run("Record build provenance");
  const manifest = JSON.parse(
    await readFile(join(f.cwd, "packages/desktop/dist/RELEASE-MANIFEST.json"), "utf8"),
  );
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
  const record = JSON.parse(
    await readFile(join(f.cwd, ".run-logs/full-groups/source.json"), "utf8"),
  );
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
    const install = job.steps.findIndex((step) => step.run?.startsWith("pnpm install"));
    if (install >= 0) assert.ok(job.steps.findIndex((step) => step.name === name) < install);
  }
  assert.equal(
    historical.env.ZCODE_TEST_POOL,
    "${{ matrix.platform == 'windows-amd64' && 'forks' || 'threads' }}",
  );
});

test("production installers use verified tag sources before installing dependencies", () => {
  const job = workflow.jobs.installer;
  // production 身份：正式 tag，或 dispatch 的 production 仅构建路由。
  assert.equal(
    job.env.ZCODE_ENV,
    "${{ (inputs.release_tag || github.ref_type == 'tag' || inputs.build_production == true) && 'production' || '' }}",
  );
  assert.equal(job.env.ZCODE_PREVIEW_IDENTITY, "0");
  assert.equal(job.env.ZCODE_ENABLE_MAC_SIGN, "0");
  assert.equal(job.env.ZCODE_ENABLE_WINDOWS_SIGN, "0");
  // 2026-11-15（CI-FIRST §2.7）：来源钉定到不可变提交，不再用浮动分支名。
  assert.equal(
    steps[0].with.ref,
    "${{ inputs.release_tag || inputs.source_commit || github.sha }}",
  );
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
  await f.run("Record build provenance");
  const manifest = JSON.parse(await readFile(join(root, "RELEASE-MANIFEST.json"), "utf8"));
  assert.equal(manifest.sourceCommit, f.sha);
  assert.equal(manifest.sourceTag, "v3.15.1-openzwork");
  assert.equal(manifest.workflowCommit, "a".repeat(40));
  assert.equal(manifest.productName, "OpenZWork");
  assert.equal(manifest.environment, "production");
  assert.deepEqual(manifest.assets, [
    {
      name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ]);
  await assert.rejects(f.run("Record build provenance", { ZCODE_ENV: "test" }));
  await writeFile(join(root, name), "");
  await assert.rejects(f.run("Record build provenance"));
  await rm(join(root, name));
  await assert.rejects(f.run("Record build provenance"));
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
  await f.run("Record build provenance", env);
  const manifest = JSON.parse(await readFile(join(root, "RELEASE-MANIFEST.json"), "utf8"));
  assert.deepEqual(
    manifest.assets.map((asset) => asset.name),
    names,
  );
  await writeFile(join(root, "OpenZWork-3.15.1-linux-x64.AppImage"), "ambiguous");
  await assert.rejects(f.run("Record build provenance", env));
});

test("dispatch builds pin immutable sources and verify packaged contents in-runner", () => {
  const job = workflow.jobs.installer;
  const stepIndex = (name) => job.steps.findIndex((step) => step.name === name);
  // 来源钉定：dispatch 输入与事件提交都不可变；校验先于安装执行。
  const dispatchVerify = stepIndex("Verify dispatch source");
  const install = job.steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  assert.ok(dispatchVerify >= 0 && dispatchVerify < install);
  assert.notEqual(job.steps[dispatchVerify]["continue-on-error"], true);
  assert.match(job.steps[dispatchVerify].run, /SOURCE_COMMIT/);
  // PK01 包内检查：绑定本次 checkout 提交，报告落盘并上传（上传路径由 runtime 套件断言）。
  const pk01 = stepIndex("Verify packaged contents (PK01)");
  const version = stepIndex("Verify packaged release version");
  assert.ok(pk01 > version);
  assert.match(job.steps[pk01].run, /scripts\/verify-desktop-package\.mjs/);
  assert.match(job.steps[pk01].run, /--expected-commit/);
  assert.match(job.steps[pk01].run, /PK01-REPORT\.json/);
  // 来源清单：三条路由共用一个步骤（Preview / production 仅构建 / 正式 tag），
  // 命名与哈希逻辑在 scripts/installer-provenance.mjs（下方行为用例直接执行它）。
  const provenance = stepIndex("Record build provenance");
  assert.ok(provenance > pk01);
  assert.match(job.steps[provenance].run, /scripts\/installer-provenance\.mjs/);
  assert.equal(job.steps[provenance].env.IS_RELEASE, "${{ (inputs.release_tag || github.ref_type == 'tag') && '1' || '0' }}");
  assert.equal(job.steps[provenance].env.IS_BUILD_PRODUCTION, "${{ inputs.build_production == true && '1' || '0' }}");
});

test("production build-only entry requires an immutable source and never publishes", () => {
  const job = workflow.jobs.installer;
  const stepIndex = (name) => job.steps.findIndex((step) => step.name === name);
  // 新输入：production 未签名、仅构建、不发布。
  assert.equal(workflow.on.workflow_dispatch.inputs.build_production.type, "boolean");
  assert.equal(workflow.on.workflow_dispatch.inputs.build_production.default, false);
  // production 身份：tag 或 build_production 打开 ZCODE_ENV=production。
  assert.match(job.env.ZCODE_ENV, /inputs\.build_production == true/);
  // 缺少/非法 source_commit 必须失败，且校验先于安装。
  const guard = stepIndex("Require immutable source for production build-only");
  const install = job.steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  assert.ok(guard >= 0 && guard < install);
  assert.equal(job.steps[guard].if, "inputs.build_production == true");
  assert.match(job.steps[guard].run, /source_commit/);
  assert.match(job.steps[guard].run, /\[0-9a-f\]\{40\}/);
  // 仅构建入口不进 publish job。
  assert.match(workflow.jobs.publish.if, /inputs\.build_production != true/);
});

test("installer-provenance names preview assets from the real product identity", async (t) => {
  // 复现缺陷：分支 Preview 包是 `OpenZWork Preview-<version>-mac-arm64_TEST.dmg`，
  // 旧清单硬找 `OpenZWork-<version>-mac-arm64.dmg` → found 0。
  const cwd = await mkdtemp(join(tmpdir(), "openzwork-provenance-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, "packages/desktop/dist");
  await mkdir(root, { recursive: true });
  await writeFile(join(cwd, "package.json"), JSON.stringify({ version: "3.18.2+openzwork.1" }));
  const git = (...args) =>
    exec("git", ["-c", "core.hooksPath=", ...args], { cwd });
  await git("init");
  await git("add", ".");
  await git("-c", "user.name=P", "-c", "user.email=p@example.invalid", "commit", "-m", "fixture");
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();

  const { recordInstallerProvenance } = await import("../../scripts/installer-provenance.mjs");
  const previewEnv = { ZCODE_ENV: "test", ZCODE_PREVIEW_IDENTITY: "0" };
  const previewName = "OpenZWork Preview-3.18.2+openzwork.1-mac-arm64_TEST.dmg";
  const previewZip = "OpenZWork Preview-3.18.2+openzwork.1-mac-arm64_TEST.zip";
  // 先只放 dmg：mac 同时产 dmg+zip，缺 zip 必须失败（不能只认第一个命中的产物）。
  await writeFile(join(root, previewName), "preview dmg");
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "preview",
      env: previewEnv,
    }),
    /Expected at least one zip installer, found 0/,
  );
  await writeFile(join(root, previewZip), "zip");
  const { manifest: preview, fileName: previewFile } = await recordInstallerProvenance({
    cwd,
    platform: "macos-arm64",
    os: "mac",
    arch: "arm64",
    mode: "preview",
    env: previewEnv,
  });
  assert.equal(previewFile, "PREVIEW-MANIFEST.json");
  assert.equal(preview.productName, "OpenZWork Preview");
  assert.equal(preview.flavor, "preview");
  assert.equal(preview.environment, "preview");
  assert.equal(preview.artifactEnvSuffix, "_TEST");
  assert.equal(preview.sourceCommit, sha);
  assert.match(preview.sourceTree, /^[a-f0-9]{40}$/);
  assert.deepEqual(
    preview.assets.map((asset) => asset.name).sort(),
    [previewName, previewZip].sort(),
  );
  // 反例：production 身份不得为 Preview 包出清单。
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "release",
      env: { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "0" },
      sourceTag: "v3.18.2+openzwork.1",
      expectedCommit: sha,
    }),
    /Release manifest requires production identity|Expected one dmg/,
  );
});

test("installer-provenance covers build-only and release routes with source binding", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openzwork-provenance-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, "packages/desktop/dist");
  await mkdir(root, { recursive: true });
  await writeFile(join(cwd, "package.json"), JSON.stringify({ version: "3.18.2+openzwork.1" }));
  await writeFile(join(root, "VERSION-VERIFICATION.json"), JSON.stringify({ version: "3.18.2+openzwork.1" }));
  const git = (...args) => exec("git", ["-c", "core.hooksPath=", ...args], { cwd });
  await git("init");
  await git("add", ".");
  await git("-c", "user.name=P", "-c", "user.email=p@example.invalid", "commit", "-m", "fixture");
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();
  const { recordInstallerProvenance } = await import("../../scripts/installer-provenance.mjs");
  const productionEnv = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "0" };

  // build-only：production 身份 + 固定 source_commit，产出 BUILD-MANIFEST，不要求 tag。
  for (const name of [
    "OpenZWork-3.18.2+openzwork.1-mac-arm64.dmg",
    "OpenZWork-3.18.2+openzwork.1-mac-arm64.zip",
  ])
    await writeFile(join(root, name), `bytes: ${name}`);
  const buildOnly = await recordInstallerProvenance({
    cwd,
    platform: "macos-arm64",
    os: "mac",
    arch: "arm64",
    mode: "build-only",
    env: productionEnv,
    expectedCommit: sha,
    versionVerification: { version: "3.18.2+openzwork.1" },
  });
  assert.equal(buildOnly.fileName, "BUILD-MANIFEST.json");
  assert.equal(buildOnly.manifest.flavor, "production");
  assert.equal(buildOnly.manifest.environment, "production");
  assert.equal(buildOnly.manifest.upstreamVersion, "3.18.2");
  assert.equal(buildOnly.manifest.releaseRevision, "1");
  assert.equal(buildOnly.manifest.nativeBuildVersion, "3.18.2.1");
  assert.equal(buildOnly.manifest.artifactEnvSuffix, "");
  assert.deepEqual(buildOnly.manifest.versionVerification, { version: "3.18.2+openzwork.1" });
  // 反例：来源不符 / 缺 40 位 SHA 必须拒绝。
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "build-only",
      env: productionEnv,
      expectedCommit: "b".repeat(40),
    }),
    /does not match source/,
  );
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "build-only",
      env: productionEnv,
      expectedCommit: "main",
    }),
    /full 40-hex/,
  );

  // release：同一批包 + tag 来源，产出 RELEASE-MANIFEST 且 sourceTag 记录在案。
  const release = await recordInstallerProvenance({
    cwd,
    platform: "macos-arm64",
    os: "mac",
    arch: "arm64",
    mode: "release",
    env: productionEnv,
    sourceTag: "v3.18.2+openzwork.1",
    expectedCommit: sha,
    versionVerification: { version: "3.18.2+openzwork.1" },
  });
  assert.equal(release.fileName, "RELEASE-MANIFEST.json");
  assert.equal(release.manifest.sourceTag, "v3.18.2+openzwork.1");
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "release",
      env: productionEnv,
      sourceTag: "v3.18.2+openzwork.1",
      expectedCommit: "b".repeat(40),
    }),
    /Source changed during build/,
  );
  // 缺包必须失败，不能靠空清单通过。
  await rm(join(root, "OpenZWork-3.18.2+openzwork.1-mac-arm64.zip"));
  await assert.rejects(
    recordInstallerProvenance({
      cwd,
      platform: "macos-arm64",
      os: "mac",
      arch: "arm64",
      mode: "release",
      env: productionEnv,
      sourceTag: "v3.18.2+openzwork.1",
      expectedCommit: sha,
    }),
    /Expected one zip installer, found 0/,
  );
});

test("agent node dist job builds and verifies the independent distribution", () => {
  const job = workflow.jobs["agent-node-dist"];
  assert.ok(job, "agent-node-dist job exists");
  assert.equal(
    job.steps[0].with.ref,
    "${{ inputs.release_tag || inputs.source_commit || github.sha }}",
  );
  const runs = job.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /pnpm build:sea:prepare/);
  assert.match(runs, /pnpm build:zcode --base-url/);
  assert.match(runs, /scripts\/verify-agent-node-dist\.mjs/);
  assert.match(runs, /AGENT-DIST-REPORT\.json/);
  const upload = job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
  assert.equal(upload.with["if-no-files-found"], "error");
});
