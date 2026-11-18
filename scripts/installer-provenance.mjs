#!/usr/bin/env node
// 安装包来源清单（CI-FIRST §2.7）：Preview、production 仅构建、正式 tag 三条路由共用同一
// 命名与清单逻辑。产品身份、环境后缀、平台/架构别名一律取真实构建期函数，不再硬编码
// `OpenZWork-<version>-...`——分支 Preview 包实际叫 `OpenZWork Preview-<version>-..._TEST.dmg`。
// 用法（workflow 内 import）：
//   node --input-type=module  →  await import('./scripts/installer-provenance.mjs')
// CLI：node scripts/installer-provenance.mjs --mode <preview|release|build-only> --platform ... --os ... --arch ...
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  resolveDesktopArtifactSuffix,
  resolveDesktopProductIdentity,
} from "../packages/desktop/scripts/desktop-product-identity.mjs";

const exec = promisify(execFile);

const EXTENSIONS = {
  mac: ["dmg", "zip"],
  win: ["exe"],
  linux: ["AppImage", "deb", "rpm", "pkg.tar.zst"],
};

/** Linux 各 target 按发行格式把 x64 映射为 x86_64 / amd64；沿用 bundle 的架构别名。 */
export function archAliases(os, arch) {
  return os === "linux" && arch === "x64" ? ["x64", "x86_64", "amd64"] : [arch];
}

/** 与 electron-builder 的 artifactName 模板逐项对齐：`<productName>-<version>-<os>-<arch><suffix>.<ext>`。 */
export function installerAssetName({ productName, version, os, arch, envSuffix, extension }) {
  return `${productName}-${version}-${os}-${arch}${envSuffix}.${extension}`;
}

/**
 * 在 dist 根目录挑选本平台本架构的安装包。
 * mode 决定基数：release 每个扩展名恰好 1 个（多产物说明命名漂移）；preview/build-only 至少 1 个
 * （mac 的 dmg 可能同时产出多架构）。`find | head -1` 那种忽略多产物的写法不能用于验收。
 */
export async function selectInstallerAssets({
  root,
  mode,
  productName,
  version,
  os,
  arch,
  envSuffix,
}) {
  const extensions = EXTENSIONS[os];
  if (!extensions) throw new Error(`Unsupported installer platform os: ${os}`);
  const aliases = archAliases(os, arch);
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const assets = [];
  for (const extension of extensions) {
    const expected = aliases.map((alias) =>
      installerAssetName({ productName, version, os, arch: alias, envSuffix, extension }),
    );
    const candidates = files.filter((name) => expected.includes(name));
    if (mode === "release" && candidates.length !== 1)
      throw new Error(`Expected one ${extension} installer, found ${candidates.length}`);
    if (mode !== "release" && candidates.length < 1)
      throw new Error(`Expected at least one ${extension} installer, found ${candidates.length}`);
    for (const name of candidates) {
      const path = join(root, name);
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty installer: ${name}`);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      assets.push({ name, size: info.size, sha256: hash.digest("hex") });
    }
  }
  return assets;
}

async function git(cwd, ...args) {
  return (await exec("git", args, { cwd })).stdout.trim();
}

/**
 * 生成并写入来源清单。返回 manifest；调用方负责记录到日志/summary。
 * mode=release 额外要求 sourceCommit 与 RELEASE_COMMIT 逐字一致（构建期间源码不得漂移）。
 */
export async function recordInstallerProvenance({
  root = join("packages", "desktop", "dist"),
  cwd = process.cwd(),
  platform,
  os,
  arch,
  mode,
  env = process.env,
  sourceTag = "",
  expectedCommit = "",
  workflowCommit = env.GITHUB_WORKFLOW_SHA ?? "",
  runUrl = env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : "",
  versionVerification = null,
}) {
  if (!["preview", "release", "build-only"].includes(mode))
    throw new Error(`Unsupported provenance mode: ${mode}`);
  const distRoot = resolve(cwd, root);
  const version = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version;
  const identity = resolveDesktopProductIdentity(env);
  const envSuffix = resolveDesktopArtifactSuffix(env);
  // 身份与路由必须自洽：production 清单不能描述 Preview 包，反之亦然。
  if (mode === "release" && identity.flavor !== "production")
    throw new Error(`Release manifest requires production identity, got ${identity.flavor}`);
  if (mode === "preview" && identity.flavor !== "preview")
    throw new Error(`Preview manifest requires preview identity, got ${identity.flavor}`);
  if (mode === "build-only" && identity.flavor !== "production")
    throw new Error(`Build-only manifest requires production identity, got ${identity.flavor}`);

  const assets = await selectInstallerAssets({
    root: distRoot,
    mode,
    productName: identity.productName,
    version,
    os,
    arch,
    envSuffix,
  });

  const sourceCommit = await git(cwd, "rev-parse", "HEAD");
  const sourceTree = await git(cwd, "rev-parse", "HEAD^{tree}");
  if (mode === "release") {
    if (!expectedCommit) throw new Error("Release manifest requires RELEASE_COMMIT");
    if (sourceCommit !== expectedCommit) throw new Error("Source changed during build");
  }
  if (mode === "build-only") {
    if (!/^[0-9a-f]{40}$/.test(expectedCommit))
      throw new Error("Build-only manifest requires a full 40-hex source commit");
    if (sourceCommit !== expectedCommit)
      throw new Error(
        `Build-only checkout ${sourceCommit} does not match source ${expectedCommit}`,
      );
  }

  const [upstreamVersion, revision] = version.split("+openzwork.");
  const releaseRevision = revision ?? "0";
  const manifest = {
    mode,
    ...(mode === "release" ? { sourceTag } : {}),
    sourceCommit,
    sourceTree,
    workflowCommit,
    runUrl,
    version,
    ...(mode === "release" || mode === "build-only"
      ? {
          upstreamVersion,
          releaseRevision,
          nativeBuildVersion: `${upstreamVersion}.${releaseRevision}`,
        }
      : {}),
    ...(versionVerification ? { versionVerification } : {}),
    platform,
    productName: identity.productName,
    flavor: identity.flavor,
    environment: identity.flavor === "production" ? "production" : "preview",
    artifactEnvSuffix: envSuffix,
    codeSigning: "unsigned",
    assets,
  };
  const fileName =
    mode === "release"
      ? "RELEASE-MANIFEST.json"
      : mode === "preview"
        ? "PREVIEW-MANIFEST.json"
        : "BUILD-MANIFEST.json";
  await writeFile(join(distRoot, fileName), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, fileName };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
    const key = arg.replace(/^--/, "").split("=")[0];
    if (key === "mode") options.mode = value;
    else if (key === "platform") options.platform = value;
    else if (key === "os") options.os = value;
    else if (key === "arch") options.arch = value;
    else if (key === "root") options.root = value;
    else if (key === "source-commit") options.expectedCommit = value;
    else if (key === "source-tag") options.sourceTag = value;
  }
  if (!options.mode || !options.platform || !options.os || !options.arch) {
    console.error(
      "usage: node scripts/installer-provenance.mjs --mode <preview|release|build-only> --platform <id> --os <mac|win|linux> --arch <arm64|x64> [--source-commit <40hex>] [--source-tag <tag>] [--root <dir>]",
    );
    process.exit(2);
  }
  const { manifest, fileName } = await recordInstallerProvenance(options);
  console.log(JSON.stringify({ fileName, manifest }, null, 2));
}
