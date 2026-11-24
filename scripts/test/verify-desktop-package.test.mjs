import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  REQUIRED_ASAR_DIRECTORIES,
  REQUIRED_BUNDLED_PLUGIN_PACKAGES,
  REQUIRED_PLUGIN_ENTRY_POINTS,
  REQUIRED_RENDERER_ENTRIES,
  verifyDesktopPackage,
} from "../verify-desktop-package.mjs";
import {
  resolveDesktopProductIdentity,
  desktopProductIdentities,
} from "../../packages/desktop/scripts/desktop-product-identity.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const require = createRequire(join(repoRoot, "packages/desktop/package.json"));

// 仓库侧 asar 读取器（合成 asar 是真实 asar 文件，可直接读取）；
// verifyDesktopPackage 的合成项目根解析不到仓库 node_modules，故注入。
const repoAsar = await import(pathToFileURL(require.resolve("@electron/asar")).href);
// Windows 的盘符路径不能直接用于 ESM 导入，打包和读取夹具复用同一个模块。
const { createPackage, extractFile: extractAsarFile } = repoAsar;

// 产品身份只由构建期环境决定（ZCODE_ENV / ZCODE_PREVIEW_IDENTITY）。测试全程显式传入
// env，不读调用者 shell：CI 的 repo-scripts 步骤不设 ZCODE_ENV，本机宿主进程却可能设了
// 它，靠继承会让同一份夹具在不同机器上得到相反结论。
const ENV_DEFAULT = {}; // 未设置 ZCODE_ENV → 测试后端 → Preview 身份
const ENV_PREVIEW = { ZCODE_ENV: "test" };
const ENV_PRODUCTION = { ZCODE_ENV: "production" };
const ENV_PRODUCTION_PREVIEW_IDENTITY = { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" };

// 合成项目与包内元数据共用固定版本，避免仓库升版让 PK01 夹具版本失配。
const FIXTURE_VERSION = {
  appVersion: "1.2.3+openzwork.7",
  upstreamVersion: "1.2.3",
  releaseRevision: "7",
};

async function temp() {
  return mkdtemp(join(tmpdir(), "verify-desktop-package-test-"));
}

/** 合成最小桌面包：真实 asar（真实 @electron/asar 打包）+ 版本元数据 + 资源件。 */
async function syntheticPackage(
  root,
  { buildCommitId = "a1b2c3d4", flavor = "production", platform = "macos-arm64" } = {},
) {
  // 目录名必须与被核验身份的 productName 一致，否则脚本解析不到包内路径。
  const productName = desktopProductIdentities[flavor].productName;
  const resources =
    platform === "windows-amd64"
      ? join(root, "win-unpacked", "resources")
      : join(root, `mac-arm64/${productName}.app/Contents/Resources`);
  await mkdir(join(resources, "licenses"), { recursive: true });
  if (platform === "macos-arm64")
    await mkdir(join(root, `mac-arm64/${productName}.app/Contents/MacOS`), { recursive: true });
  const staging = join(root, "staging");
  await mkdir(join(staging, "out/metadata"), { recursive: true });
  await mkdir(join(staging, "out/main"), { recursive: true });
  // PK01 扩展入口与分块目录（H6）：合成包必须带上被核验的全部必需项，否则核验会
  // 因夹具缺件失败——这是夹具责任，不是放宽检查。
  for (const directory of REQUIRED_ASAR_DIRECTORIES) {
    if (directory === "out/metadata" || directory === "out/main") continue;
    await mkdir(join(staging, directory), { recursive: true });
  }
  for (const entry of REQUIRED_RENDERER_ENTRIES) {
    const target = join(staging, entry);
    if (entry.endsWith("/")) await mkdir(target, { recursive: true });
    else await writeFile(target, "<html></html>\n");
  }
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ version: FIXTURE_VERSION.appVersion, zcodeProductFlavor: flavor }),
  );
  await writeFile(
    join(staging, "out/metadata/build-meta.json"),
    JSON.stringify({ ...FIXTURE_VERSION, buildCommitId }),
  );
  await writeFile(
    join(staging, "out/main/index.js"),
    'const dataRoot = ".openzwork";\nshareCopiedDataRootCredentialKey();\n',
  );
  await createPackage(staging, join(resources, "app.asar"));
  await writeFile(join(resources, "THIRD-PARTY-NOTICES.md"), "notices\n");
  await mkdir(join(resources, "glm"), { recursive: true });
  await writeFile(join(resources, "glm/zcode.cjs"), "console.log('agent');\n");
  // 内置插件包 + MCP 入口 + 运行库材料。
  for (const name of REQUIRED_BUNDLED_PLUGIN_PACKAGES) {
    const directory = join(resources, "glm", "packages", name);
    await mkdir(directory, { recursive: true });
    const entry = REQUIRED_PLUGIN_ENTRY_POINTS[name];
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify(entry ? { name, main: entry } : { name }),
    );
    if (entry) {
      const entryPath = join(directory, entry);
      await mkdir(join(entryPath, ".."), { recursive: true });
      await writeFile(entryPath, "// mcp server\n");
    }
  }
  const runtimePaths = ["glm/node-runtime/npm", "tools/ripgrep", "tools/ugrep"];
  if (platform === "macos-arm64") runtimePaths.push("tools/bfs");
  if (platform === "windows-amd64") {
    runtimePaths.push(
      "preinstalled-entry-shim/zcode-preinstalled-entry-shim.exe",
      "tools/runtime-host/zcode-runtime-host.exe",
      "tools/runtime-host/zcode-installer-process-helper.exe",
    );
  }
  for (const relative of runtimePaths) {
    const target = join(resources, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "binary\n");
  }
  return { resources, staging };
}

async function projectRoot(packageRoot) {
  const root = await temp();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: FIXTURE_VERSION.appVersion }),
  );
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
    assert.equal(report.forbiddenMarkers[`high${"speed"}`], 0);
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
    `startPlan("high${"speed"}");\n.openzwork\nshareCopiedDataRootCredentialKey\n`,
  );
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
    assert.match(joined, new RegExp(`high${"speed"}.*present`));
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

// H6：PK01 自动核验范围。以下反例证明新增检查能发现真实缺件，而不是只断言"出现了某字符串"。
test("verify-desktop-package rejects a missing bundled plugin package", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot, { flavor: "production" });
  await rm(join(resources, "glm/packages/design-plugin"), { recursive: true, force: true });
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
    assert.match(
      report.failures.join("\n"),
      /bundled plugin package missing: glm\/packages\/design-plugin/,
    );
    assert.equal(report.bundledPlugins["design-plugin"], false);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package rejects a plugin whose declared MCP entry is absent", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot, { flavor: "production" });
  // 声明了 main 但文件被删：只看 package.json 存在会漏判。
  await rm(join(resources, "glm/packages/node-repl-host/dist/mcp/server.js"), { force: true });
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
    assert.match(
      report.failures.join("\n"),
      /plugin entry point missing: glm\/packages\/node-repl-host/,
    );
    assert.equal(report.pluginEntryPoints["node-repl-host"].present, false);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package rejects missing extension-host chunk and renderer entries", async () => {
  const packageRoot = await temp();
  const { staging } = await syntheticPackage(packageRoot, { flavor: "production" });
  // 删掉 extension-host 分块与 renderer 静态资源后重打 asar。
  await rm(join(staging, "out/extension-host"), { recursive: true, force: true });
  await rm(join(staging, "out/renderer/assets"), { recursive: true, force: true });
  const productName = desktopProductIdentities.production.productName;
  const resources = join(packageRoot, `mac-arm64/${productName}.app/Contents/Resources`);
  await createPackage(staging, join(resources, "app.asar"));
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
    assert.match(joined, /required asar directory missing: out\/extension-host/);
    assert.match(joined, /required renderer entry missing: out\/renderer\/assets\//);
    assert.equal(report.asarDirectories["out/extension-host"], false);
    assert.equal(report.rendererEntries["out/renderer/assets/"], false);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-desktop-package rejects a missing runtime library", async () => {
  const packageRoot = await temp();
  const { resources } = await syntheticPackage(packageRoot, { flavor: "production" });
  await rm(join(resources, "tools/ripgrep"), { force: true });
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
    assert.match(report.failures.join("\n"), /required runtime path missing: tools\/ripgrep/);
    assert.equal(report.runtimePaths["tools/ripgrep"], false);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows package verification requires its native search tools, runtime-host helpers, and preinstalled entry shim without bfs", async (t) => {
  const packageRoot = await temp();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await syntheticPackage(packageRoot, { platform: "windows-amd64" });
  const root = await projectRoot(packageRoot);
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    platform: "windows-amd64",
    root,
    distRoot: "packages/desktop/dist-pkg",
    extractAsarFile,
    env: ENV_PRODUCTION,
  };
  const report = await verifyDesktopPackage(options);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(Object.hasOwn(report.runtimePaths, "tools/bfs"), false);
  assert.equal(report.runtimePaths["tools/ripgrep"], true);
  assert.equal(report.runtimePaths["tools/ugrep"], true);
  assert.equal(
    report.runtimePaths["preinstalled-entry-shim/zcode-preinstalled-entry-shim.exe"],
    true,
  );
  assert.equal(report.runtimePaths["tools/runtime-host/zcode-runtime-host.exe"], true);
  assert.equal(report.runtimePaths["tools/runtime-host/zcode-installer-process-helper.exe"], true);
  await rm(join(root, options.distRoot, "win-unpacked/resources/tools/ugrep"));
  await rm(
    join(
      root,
      options.distRoot,
      "win-unpacked/resources/preinstalled-entry-shim/zcode-preinstalled-entry-shim.exe",
    ),
  );
  await rm(
    join(
      root,
      options.distRoot,
      "win-unpacked/resources/tools/runtime-host/zcode-runtime-host.exe",
    ),
  );
  const missing = await verifyDesktopPackage(options);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.failures, [
    "required runtime path missing: tools/ugrep",
    "required runtime path missing: preinstalled-entry-shim/zcode-preinstalled-entry-shim.exe",
    "required runtime path missing: tools/runtime-host/zcode-runtime-host.exe",
  ]);
});
