import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { verifyDesktopPackage } from "../verify-desktop-package.mjs";

const exec = promisify(execFile);
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const require = createRequire(join(repoRoot, "packages/desktop/package.json"));

// 仓库侧 asar 读取器（合成 asar 是真实 asar 文件，可直接读取）；
// verifyDesktopPackage 的合成项目根解析不到仓库 node_modules，故注入。
const repoAsar = await import(pathToFileURL(require.resolve("@electron/asar")).href);
const extractAsarFile = repoAsar.extractFile;

async function temp() {
  return mkdtemp(join(tmpdir(), "verify-desktop-package-test-"));
}

/** 合成最小桌面包：真实 asar（真实 @electron/asar 打包）+ 版本元数据 + 资源件。 */
async function syntheticPackage(
  root,
  { buildCommitId = "a1b2c3d4", version = "3.18.2+openzwork.1" } = {},
) {
  const resources = join(root, "mac-arm64/OpenZWork.app/Contents/Resources");
  await mkdir(join(resources, "licenses"), { recursive: true });
  await mkdir(join(root, "mac-arm64/OpenZWork.app/Contents/MacOS"), { recursive: true });
  const staging = join(root, "staging");
  await mkdir(join(staging, "out/metadata"), { recursive: true });
  await mkdir(join(staging, "out/main"), { recursive: true });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ version, zcodeProductFlavor: "production" }),
  );
  await writeFile(
    join(staging, "out/metadata/build-meta.json"),
    JSON.stringify({
      appVersion: version,
      upstreamVersion: "3.18.2",
      releaseRevision: "1",
      buildCommitId,
    }),
  );
  await writeFile(
    join(staging, "out/main/index.js"),
    'const dataRoot = ".openzwork";\nshareCopiedDataRootCredentialKey();\n',
  );
  const { createPackage } = await import(require.resolve("@electron/asar"));
  await createPackage(staging, join(resources, "app.asar"));
  await writeFile(join(resources, "THIRD-PARTY-NOTICES.md"), "notices\n");
  await mkdir(join(resources, "glm"), { recursive: true });
  await writeFile(join(resources, "glm/zcode.cjs"), "console.log('agent');\n");
  return { resources };
}

async function projectRoot(packageRoot) {
  const root = await temp();
  // verifyDesktopPackage 只读根 package.json 版本与 desktop 包结构；复制真实根清单最小化。
  await cp(join(repoRoot, "package.json"), join(root, "package.json"));
  await mkdir(join(root, "packages/desktop/dist-pkg"), { recursive: true });
  await exec("cp", ["-R", packageRoot + "/.", join(root, "packages/desktop/dist-pkg")]);
  return root;
}

test("verify-desktop-package accepts a well-formed package and binds the checkout commit", async () => {
  const packageRoot = await temp();
  await syntheticPackage(packageRoot);
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      expectedCommit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.buildCommitId, "a1b2c3d4");
    assert.equal(report.requiredMarkers[".openzwork"] > 0, true);
    assert.equal(report.forbiddenMarkers.highspeed, 0);
    assert.match(report.zcodeCjsSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package fails on reintroduced trimmed markers and unbound commits", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot);
  // 用带禁标记的主包重打 asar。
  const staging = join(packageRoot, "staging-bad");
  await mkdir(staging, { recursive: true });
  await cp(join(packageRoot, "staging/."), staging, { recursive: true });
  await writeFile(
    join(staging, "out/main/index.js"),
    'startPlan("highspeed");\n.openzwork\nshareCopiedDataRootCredentialKey\n',
  );
  const { createPackage } = await import(require.resolve("@electron/asar"));
  await createPackage(staging, join(resources, "app.asar"));
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      expectedCommit: "ffffffffffffffffffffffffffffffffffffffff",
    });
    assert.equal(report.ok, false);
    const joined = report.failures.join("\n");
    assert.match(joined, /startPlan.*present/);
    assert.match(joined, /highspeed.*present/);
    assert.match(joined, /does not bind checkout/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package fails when license material or runtime entries go missing", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot);
  await rm(join(resources, "THIRD-PARTY-NOTICES.md"), { force: true });
  await rm(join(resources, "glm"), { recursive: true, force: true });
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
    });
    assert.equal(report.ok, false);
    const joined = report.failures.join("\n");
    assert.match(joined, /license material missing: thirdPartyNotices/);
    assert.match(joined, /agent runtime directory missing/);
    assert.match(joined, /desktop CLI entry missing/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
