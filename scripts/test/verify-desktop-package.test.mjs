import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyDesktopPackage } from "../verify-desktop-package.mjs";
import {
  resolveDesktopProductIdentity,
  desktopProductIdentities,
} from "../../packages/desktop/scripts/desktop-product-identity.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const require = createRequire(join(repoRoot, "packages/desktop/package.json"));

// 仓库侧 asar 读取器（合成 asar 是真实 asar 文件，可直接读取）；
// verifyDesktopPackage 的合成项目根解析不到仓库 node_modules，故注入。
const repoAsar = await import(pathToFileURL(require.resolve("@electron/asar")).href);
const extractAsarFile = repoAsar.extractFile;

// 产品身份只由构建期环境决定（ZCODE_ENV / ZCODE_PREVIEW_IDENTITY）。测试全程显式传入
// env，不读调用者 shell：CI 的 repo-scripts 步骤不设 ZCODE_ENV，本机宿主进程却可能设了
// 它，靠继承会让同一份夹具在不同机器上得到相反结论。
const ENV_DEFAULT = {}; // 未设置 ZCODE_ENV → 测试后端 → Preview 身份
const ENV_PREVIEW = { ZCODE_ENV: "test" };
const ENV_PRODUCTION = { ZCODE_ENV: "production" };
const ENV_PRODUCTION_PREVIEW_IDENTITY = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" };

async function temp() {
  return mkdtemp(join(tmpdir(), "verify-desktop-package-test-"));
}

/** 合成最小桌面包：真实 asar（真实 @electron/asar 打包）+ 版本元数据 + 资源件。 */
async function syntheticPackage(
  root,
  { buildCommitId = "a1b2c3d4", version = "3.18.2+openzwork.1", flavor = "production" } = {},
) {
  // 目录名必须与被核验身份的 productName 一致，否则脚本解析不到包内路径。
  const productName = desktopProductIdentities[flavor].productName;
  const resources = join(root, `mac-arm64/${productName}.app/Contents/Resources`);
  await mkdir(join(resources, "licenses"), { recursive: true });
  await mkdir(join(root, `mac-arm64/${productName}.app/Contents/MacOS`), { recursive: true });
  const staging = join(root, "staging");
  await mkdir(join(staging, "out/metadata"), { recursive: true });
  await mkdir(join(staging, "out/main"), { recursive: true });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ version, zcodeProductFlavor: flavor }),
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
  // 用 Node fs API 而非 `cp -R`：repo-scripts 在 macOS/Windows/Linux 三平台运行。
  await cp(packageRoot, join(root, "packages/desktop/dist-pkg"), { recursive: true });
  return root;
}

test("verify-desktop-package accepts a production package when the environment says production", async () => {
  const packageRoot = await temp();
  await syntheticPackage(packageRoot, { flavor: "production" });
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      env: ENV_PRODUCTION,
      expectedCommit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.flavor, "production");
    assert.equal(report.buildCommitId, "a1b2c3d4");
    assert.equal(report.requiredMarkers[".openzwork"] > 0, true);
    assert.equal(report.forbiddenMarkers.highspeed, 0);
    assert.match(report.zcodeCjsSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

// 默认环境（未设 ZCODE_ENV）在 CI 与开发者机器上都必须是 Preview 身份：这是本轮返工的
// 核心回归——旧夹具固定 production，CI 无 ZCODE_ENV 时三个用例全部找不到包。
test("verify-desktop-package defaults to the preview identity without ZCODE_ENV", async () => {
  assert.equal(resolveDesktopProductIdentity(ENV_DEFAULT).flavor, "preview");
  const packageRoot = await temp();
  await syntheticPackage(packageRoot, { flavor: "preview" });
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      env: ENV_DEFAULT,
    });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.flavor, "preview");
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package resolves an explicit preview identity and rejects a production package", async () => {
  // 显式 Preview（ZCODE_ENV=test 或 production+ZCODE_PREVIEW_IDENTITY=1）都必须找 Preview 包。
  const previewRoot = await temp();
  await syntheticPackage(previewRoot, { flavor: "preview" });
  const previewProject = await projectRoot(previewRoot);
  try {
    for (const env of [ENV_PREVIEW, ENV_PRODUCTION_PREVIEW_IDENTITY]) {
      const report = await verifyDesktopPackage({
        platform: "macos-arm64",
        root: previewProject,
        distRoot: "packages/desktop/dist-pkg",
        extractAsarFile,
        env,
      });
      assert.equal(report.ok, true, `${JSON.stringify(env)}: ${JSON.stringify(report.failures)}`);
      assert.equal(report.flavor, "preview");
    }
  } finally {
    await rm(previewRoot, { recursive: true, force: true });
    await rm(previewProject, { recursive: true, force: true });
  }

  // 反例：production 身份下必须拒绝 Preview 包（不能靠"目录里恰好有个包"放行）。
  const productionRoot = await temp();
  await syntheticPackage(productionRoot, { flavor: "production" });
  const productionProject = await projectRoot(productionRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root: productionProject,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      env: ENV_PREVIEW,
    });
    assert.equal(report.ok, false);
    assert.equal(report.flavor, "preview");
  } finally {
    await rm(productionRoot, { recursive: true, force: true });
    await rm(productionProject, { recursive: true, force: true });
  }
});

test("verify-desktop-package fails on reintroduced trimmed markers and unbound commits", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot, { flavor: "production" });
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
      env: ENV_PRODUCTION,
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
  const { resources } = await syntheticPackage(packageRoot, { flavor: "production" });
  await rm(join(resources, "THIRD-PARTY-NOTICES.md"), { force: true });
  await rm(join(resources, "glm"), { recursive: true, force: true });
  const root = await projectRoot(packageRoot);
  try {
    const report = await verifyDesktopPackage({
      platform: "macos-arm64",
      root,
      distRoot: "packages/desktop/dist-pkg",
      extractAsarFile,
      env: ENV_PRODUCTION,
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
