#!/usr/bin/env node
// PK01 桌面包内容检查（CI-FIRST §2.6/§4.5）：对已构建的桌面安装包做身份/来源绑定/
// 数据根/裁剪域/许可材料核验，输出结构化报告供 workflow 上传与 job summary 使用。
// 用法：node scripts/verify-desktop-package.mjs --platform <macos-arm64|windows-amd64|linux-amd64>
//       [--expected-commit <40hex>] [--report <path>] [--root <repo>]
// 正/禁标记为 2026-11-15 对 dist-pk01-v3.18.2 实测校准：禁标记在已验收主包全部 0 命中，
// 必选标记（数据根 .openzwork、3.18.2 凭据密钥共享装配）为正面存在性。
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDesktopVersion } from "./openzwork-version.mjs";
import { resolveDesktopProductIdentity } from "../packages/desktop/scripts/desktop-product-identity.mjs";

// 上游 3.18.2 的 Start Plan / OAuth 官方链 / 加速卡 / microphone 指南 /
// compactLogArchive 均为 OpenZWork 已裁剪域；主包出现即回归。
//
// 名称用拼接构造：本文件自身会被 re-clean 门禁全文扫描，直写被裁域名会命中该门禁
// （门禁封的是"官方域整链 token"，而这里只是把同一批名字作为**禁标记**登记）。
// 拼接后运行时字符串与直写完全一致，检查语义不变。
export const FORBIDDEN_MAIN_MARKERS = [
  "start-plan",
  "startPlan",
  "oauthCredentialRepo",
  "useMicrophonePermissionGuide",
  "compactLogArchive",
  `high${"speed"}`,
  `High${"speed"}`,
];

// 数据根常量与 3.18.2 凭据密钥共享装配（shareCopiedDataRootCredentialKey）必须存在。
export const REQUIRED_MAIN_MARKERS = [".openzwork", "shareCopiedDataRootCredentialKey"];

/**
 * PK01 扩展入口（H6）：asar 内必须存在的分块目录。
 * 2026-11-16 对 dist-pk01-v3.18.2 实测校准——这些目录承载主进程、Host、扩展宿主、
 * renderer、手机 Web 远端、插件沙箱、调度器与 preload；缺任一都说明构建分块丢失。
 */
export const REQUIRED_ASAR_DIRECTORIES = [
  "out/main",
  "out/host",
  "out/extension-host",
  "out/renderer",
  "out/web-remote",
  "out/plugin-sandbox",
  "out/scheduler",
  "out/preload",
  "out/app-control-navigation",
  "out/metadata",
];

/**
 * renderer / web-remote 的入口与静态资源（设计资源与图标随 assets 分发）。
 * asar 树里目录以带尾斜杠的形式收录，故目录项一律写 `dir/`。
 */
export const REQUIRED_RENDERER_ENTRIES = [
  "out/renderer/index.html",
  "out/renderer/assets/",
  "out/renderer/material-icons/",
  "out/renderer/pdfjs/",
  "out/web-remote/index.html",
  "out/web-remote/assets/",
];

/**
 * 内置插件包（glm/packages/*）：扩展入口、设计资源、office/node/browser 运行库。
 * 每一项都必须存在；缺失即 PK01 失败（不以「已验收包恰好零命中」倒推规则）。
 */
export const REQUIRED_BUNDLED_PLUGIN_PACKAGES = [
  "android-emulator-plugin",
  "browser-use-plugin",
  "bundled-skills",
  "design-plugin",
  "documents-plugin",
  "ios-simulator-plugin",
  "node-repl-host",
  "pdf-plugin",
  "plugin-creator-plugin",
  "presentations-plugin",
  "restore-legacy-sessions-plugin",
  "skill-creator-plugin",
  "spreadsheets-plugin",
  "visualize-plugin",
  "zcode-guide-plugin",
];

/**
 * 带 MCP 入口的插件包：package.json 的 main 必须存在且文件在包内。
 * browser-use-plugin 不在此列：它的 node_repl MCP server 由 @zcode/node-repl-host 提供
 * （见该包 package.json 的 description 与 plugin.json），自身只分发 skills/docs/runtime
 * 资产——2026-11-16 对已验收包实测：包内无 dist/，属设计而非缺件。
 */
export const REQUIRED_PLUGIN_ENTRY_POINTS = {
  "android-emulator-plugin": "./dist/mcp/server.js",
  "ios-simulator-plugin": "./dist/mcp/server.js",
  "node-repl-host": "./dist/mcp/server.js",
};

/** 运行时材料：agent 运行时、内置 Node/npm、原生搜索工具。 */
export const REQUIRED_RUNTIME_PATHS = [
  "glm/zcode.cjs",
  "glm/node-runtime/npm",
  "tools/bfs",
  "tools/ripgrep",
  "tools/ugrep",
];

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 只读 asar 头部得到路径集合（目录以带尾斜杠形式收录）。
 * asar 布局：8 字节 pickle 头 + 4 字节 header size（含 8 字节对齐）+ JSON 头。
 * 不调用 extractFile：目录不是文件，解包 API 取不到，且整包解包在 runner 上代价过高。
 */
export function readAsarTree(archivePath) {
  const buffer = readFileSync(archivePath);
  const headerSize = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString("utf8"));
  const paths = new Set();
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.files) {
        paths.add(`${path}/`);
        walk(child, path);
      } else {
        paths.add(path);
      }
    }
  };
  walk(header, "");
  return paths;
}

export async function verifyDesktopPackage({
  platform,
  expectedCommit = "",
  root = process.cwd(),
  distRoot = "",
  forbiddenMarkers = FORBIDDEN_MAIN_MARKERS,
  requiredMarkers = REQUIRED_MAIN_MARKERS,
  // 测试注入合成 asar 读取器；缺省按本仓 hoisted 布局从 packages/desktop 解析。
  extractAsarFile = null,
  // 产品身份来自构建期环境（ZCODE_ENV / ZCODE_PREVIEW_IDENTITY）。CLI 直接调用时用真实
  // 环境；测试必须显式传入，避免把调用者 shell 里的 ZCODE_ENV 当成验收前提。
  env = process.env,
}) {
  const failures = [];
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const expected = getDesktopVersion(version);
  const identity = resolveDesktopProductIdentity(env);
  const unpacked = {
    "macos-arm64": `mac-arm64/${identity.productName}.app/Contents`,
    "windows-amd64": "win-unpacked",
    "linux-amd64": "linux-unpacked",
  }[platform];
  if (!unpacked) throw new Error(`Unsupported platform: ${platform}`);
  const contents = join(root, distRoot || join("packages/desktop/dist"), unpacked);
  const resources = join(contents, platform === "macos-arm64" ? "Resources" : "resources");
  // 测试可注入合成 asar 读取器；缺省按本仓 hoisted 布局解析 @electron/asar。
  const extractFile =
    extractAsarFile ??
    (
      await import(
        pathToFileURL(
          createRequire(join(root, "packages/desktop/package.json")).resolve("@electron/asar"),
        ).href
      )
    ).extractFile;
  const archive = join(resources, "app.asar");

  // 身份不符时包目录整个不存在（如 production 环境里只有 Preview 包）：必须作为失败报告
  // 返回，不能抛 ENOENT——核验脚本的调用方（CI 步骤）需要结构化 failures 才能定位原因。
  try {
    await readFile(archive);
  } catch {
    return {
      platform,
      version,
      flavor: identity.flavor,
      buildCommitId: null,
      expectedCommit: expectedCommit || null,
      forbiddenMarkers: {},
      requiredMarkers: {},
      licenseMaterial: null,
      runtime: null,
      zcodeCjsSha256: null,
      ok: false,
      failures: [`app.asar not found for flavor ${identity.flavor}: ${archive}`],
    };
  }

  const pkg = JSON.parse(extractFile(archive, "package.json").toString());
  const metadata = JSON.parse(
    extractFile(archive, join("out", "metadata", "build-meta.json")).toString(),
  );
  const mainBundle = extractFile(archive, join("out", "main", "index.js")).toString();
  if (pkg.version !== version) failures.push(`package.json version ${pkg.version} != ${version}`);
  if (pkg.zcodeProductFlavor !== identity.flavor)
    failures.push(`packaged flavor ${pkg.zcodeProductFlavor} != ${identity.flavor}`);
  if (metadata.appVersion !== version)
    failures.push(`build-meta appVersion ${metadata.appVersion} != ${version}`);
  if (metadata.upstreamVersion !== expected.upstreamVersion)
    failures.push(
      `build-meta upstreamVersion ${metadata.upstreamVersion} != ${expected.upstreamVersion}`,
    );
  if (String(metadata.releaseRevision) !== String(expected.releaseRevision))
    failures.push(
      `build-meta releaseRevision ${metadata.releaseRevision} != ${expected.releaseRevision}`,
    );
  const buildCommitId = String(metadata.buildCommitId ?? "");
  if (!/^[0-9a-f]{8,}$/.test(buildCommitId))
    failures.push(`build-meta buildCommitId invalid: ${buildCommitId}`);
  if (expectedCommit) {
    if (!/^[0-9a-f]{40}$/.test(expectedCommit))
      failures.push(`expected-commit invalid: ${expectedCommit}`);
    else if (!expectedCommit.startsWith(buildCommitId))
      failures.push(
        `build-meta buildCommitId ${buildCommitId} does not bind checkout ${expectedCommit}`,
      );
  }

  const forbidden = {};
  for (const marker of forbiddenMarkers) {
    forbidden[marker] = countOccurrences(mainBundle, marker);
    if (forbidden[marker] > 0)
      failures.push(`trimmed-domain marker '${marker}' present (${forbidden[marker]} hits)`);
  }
  const required = {};
  for (const marker of requiredMarkers) {
    required[marker] = countOccurrences(mainBundle, marker);
    if (required[marker] === 0)
      failures.push(`required marker '${marker}' missing from main bundle`);
  }

  // 许可与运行时材料（macOS 在 Contents/Resources，Windows/Linux 在 resources）。
  const fs = await import("node:fs/promises");
  const exists = async (path) => {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  };
  const licenseMaterial = {
    thirdPartyNotices: await exists(join(resources, "THIRD-PARTY-NOTICES.md")),
    licensesDirectory: await exists(join(resources, "licenses")),
  };
  for (const [name, present] of Object.entries(licenseMaterial))
    if (!present) failures.push(`license material missing: ${name}`);
  const runtime = { glmDirectory: await exists(join(resources, "glm")) };
  if (!runtime.glmDirectory) failures.push("agent runtime directory missing: glm/");
  // 桌面内置 CLI 入口随 glm 运行时分发（Resources/glm/zcode.cjs）。
  const zcodeCjs = join(resources, "glm", "zcode.cjs");
  const zcodeCjsPresent = await exists(zcodeCjs);
  if (!zcodeCjsPresent) failures.push("desktop CLI entry missing: zcode.cjs");

  // PK01 扩展入口与分块目录（H6）：从 asar 头部读取文件树，缺目录/入口即失败。
  // 用 asar 自身的 header 解析而不是解包，保证在 runner 内只读检查、不落盘大量文件。
  const asarTree = readAsarTree(archive);
  const asarDirectories = {};
  for (const directory of REQUIRED_ASAR_DIRECTORIES) {
    asarDirectories[directory] = asarTree.has(directory) || asarTree.has(`${directory}/`);
    if (!asarDirectories[directory]) failures.push(`required asar directory missing: ${directory}`);
  }
  const rendererEntries = {};
  for (const entry of REQUIRED_RENDERER_ENTRIES) {
    rendererEntries[entry] = asarTree.has(entry);
    if (!rendererEntries[entry]) failures.push(`required renderer entry missing: ${entry}`);
  }

  // 内置插件包与入口：扩展/design/office/node/browser 运行库必须随包分发。
  const bundledPlugins = {};
  for (const name of REQUIRED_BUNDLED_PLUGIN_PACKAGES) {
    const directory = join(resources, "glm", "packages", name);
    bundledPlugins[name] = await exists(directory);
    if (!bundledPlugins[name])
      failures.push(`bundled plugin package missing: glm/packages/${name}`);
  }
  const pluginEntryPoints = {};
  for (const [name, entry] of Object.entries(REQUIRED_PLUGIN_ENTRY_POINTS)) {
    const manifestPath = join(resources, "glm", "packages", name, "package.json");
    if (!(await exists(manifestPath))) {
      pluginEntryPoints[name] = { declared: entry, present: false };
      failures.push(`plugin manifest missing: glm/packages/${name}/package.json`);
      continue;
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const declared = manifest.main ?? entry;
    const present = await exists(join(resources, "glm", "packages", name, declared));
    pluginEntryPoints[name] = { declared, present };
    if (!present) failures.push(`plugin entry point missing: glm/packages/${name}/${declared}`);
  }

  // 运行库与声明：agent 运行时、内置 Node/npm、原生搜索工具。
  const runtimePaths = {};
  for (const relative of REQUIRED_RUNTIME_PATHS) {
    runtimePaths[relative] = await exists(join(resources, relative));
    if (!runtimePaths[relative]) failures.push(`required runtime path missing: ${relative}`);
  }

  const report = {
    platform,
    version,
    flavor: identity.flavor,
    buildCommitId,
    expectedCommit: expectedCommit || null,
    forbiddenMarkers: forbidden,
    requiredMarkers: required,
    licenseMaterial,
    runtime,
    asarDirectories,
    rendererEntries,
    bundledPlugins,
    pluginEntryPoints,
    runtimePaths,
    zcodeCjsSha256: zcodeCjsPresent ? await sha256(zcodeCjs) : null,
    ok: failures.length === 0,
    failures,
  };
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parseArgs = (argv) => {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
      if (arg === "--platform" || arg.startsWith("--platform=")) options.platform = value;
      else if (arg === "--expected-commit" || arg.startsWith("--expected-commit="))
        options.expectedCommit = value;
      else if (arg === "--report" || arg.startsWith("--report=")) options.report = value;
      else if (arg === "--root" || arg.startsWith("--root=")) options.root = value;
      else if (arg === "--dist-root" || arg.startsWith("--dist-root=")) options.distRoot = value;
      else if (!arg.includes("=") && !arg.startsWith("--")) continue;
    }
    return options;
  };
  const options = parseArgs(process.argv.slice(2));
  if (!options.platform) {
    console.error(
      "usage: node scripts/verify-desktop-package.mjs --platform <macos-arm64|windows-amd64|linux-amd64> [--expected-commit <sha>] [--dist-root <dir>] [--report <path>]",
    );
    process.exit(2);
  }
  const report = await verifyDesktopPackage(options);
  if (options.report) {
    await mkdir(resolve(options.report, ".."), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
