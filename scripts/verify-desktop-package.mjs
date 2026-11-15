#!/usr/bin/env node
// PK01 桌面包内容检查（CI-FIRST §2.6/§4.5）：对已构建的桌面安装包做身份/来源绑定/
// 数据根/裁剪域/许可材料核验，输出结构化报告供 workflow 上传与 job summary 使用。
// 用法：node scripts/verify-desktop-package.mjs --platform <macos-arm64|windows-amd64|linux-amd64>
//       [--expected-commit <40hex>] [--report <path>] [--root <repo>]
// 正/禁标记为 2026-11-15 对 dist-pk01-v3.18.2 实测校准：禁标记在已验收主包全部 0 命中，
// 必选标记（数据根 .openzwork、3.18.2 凭据密钥共享装配）为正面存在性。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDesktopVersion } from "./openzwork-version.mjs";
import { resolveDesktopProductIdentity } from "../packages/desktop/scripts/desktop-product-identity.mjs";

// 上游 3.18.2 的 Start Plan / OAuth 官方链 / Highspeed / microphone 指南 /
// compactLogArchive 均为 OpenZWork 已裁剪域；主包出现即回归。
export const FORBIDDEN_MAIN_MARKERS = [
  "start-plan",
  "startPlan",
  "oauthCredentialRepo",
  "useMicrophonePermissionGuide",
  "compactLogArchive",
  "highspeed",
  "Highspeed",
];

// 数据根常量与 3.18.2 凭据密钥共享装配（shareCopiedDataRootCredentialKey）必须存在。
export const REQUIRED_MAIN_MARKERS = [".openzwork", "shareCopiedDataRootCredentialKey"];

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

export async function verifyDesktopPackage({
  platform,
  expectedCommit = "",
  root = process.cwd(),
  distRoot = "",
  forbiddenMarkers = FORBIDDEN_MAIN_MARKERS,
  requiredMarkers = REQUIRED_MAIN_MARKERS,
  // 测试注入合成 asar 读取器；缺省按本仓 hoisted 布局从 packages/desktop 解析。
  extractAsarFile = null,
}) {
  const failures = [];
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const expected = getDesktopVersion(version);
  const identity = resolveDesktopProductIdentity();
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
