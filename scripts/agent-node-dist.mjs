#!/usr/bin/env node
// 独立 Node 分发（build:zcode tarball）的 CI 参数解析与产物选择（CI-FIRST §2.5/H4）。
//
// 三类事件的下载基地址来源必须显式，不允许空串或临时 fallback 冒充正式地址：
// - workflow_dispatch：用 zcode_dist_base_url 输入；为空直接失败（不静默用占位）。
// - tag / push：没有 dispatch 输入，只能取仓库变量 ZCODE_DIST_BASE_URL；缺失即失败。
// 占位地址（example.invalid）只用于验收构建，清单里以 baseUrlKind=placeholder 标出，
// 不会被当成正式分发配置。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 明确的占位域名：仅用于验收构建，正式分发必须替换。 */
export const PLACEHOLDER_HOSTS = ["example.invalid", "example.com"];

export function isPlaceholderBaseUrl(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PLACEHOLDER_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * 解析本次运行的下载基地址。
 * eventName 为 GitHub 事件名（push/tag 都以 push 事件到达，用 refType 区分）。
 */
export function resolveAgentDistBaseUrl({
  eventName,
  refType = "branch",
  inputs = {},
  vars = {},
  env = process.env,
}) {
  const fromInput = String(inputs.zcode_dist_base_url ?? "").trim();
  const fromVars = String(vars.ZCODE_DIST_BASE_URL ?? "").trim();
  const dispatch = eventName === "workflow_dispatch";

  if (dispatch) {
    if (!fromInput) {
      throw new Error(
        "workflow_dispatch requires the zcode_dist_base_url input (empty is not a valid download base)",
      );
    }
    return { baseUrl: normalizeBaseUrl(fromInput), source: "dispatch-input" };
  }
  if (eventName !== "push") {
    throw new Error(`agent node dist is not supported for event ${eventName}`);
  }
  // tag 与分支 push 都没有 dispatch 输入：只能取已批准的仓库变量。
  if (!fromVars) {
    throw new Error(
      `push/tag runs require the repository variable ZCODE_DIST_BASE_URL (${refType}); no fallback is used`,
    );
  }
  return { baseUrl: normalizeBaseUrl(fromVars), source: "repository-variable" };
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * 从 releases 目录选出与本次版本对应的唯一 tarball。
 * 不用 `find ... | head -1`：多产物（旧版本残留、多平台）必须显式失败。
 */
export async function selectAgentDistTarball({ releaseRoot, version }) {
  const expected = `zcode-${version}.tar.gz`;
  let entries;
  try {
    entries = await readdir(releaseRoot, { withFileTypes: true });
  } catch {
    throw new Error(`agent dist release directory missing: ${releaseRoot}`);
  }
  const matches = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === expected) {
      matches.push(join(releaseRoot, entry.name));
    }
  }
  if (matches.length !== 1) {
    const found = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    throw new Error(
      `Expected exactly one ${expected} in ${releaseRoot}, found ${matches.length} (files: ${found.join(", ") || "none"})`,
    );
  }
  return matches[0];
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * 写 AGENT-DIST-MANIFEST.json：实际 tarball 与本次源码/工具链/平台的对应关系。
 * 与 AGENT-DIST-REPORT.json（内容核验）分开，一个证明「包对」，一个证明「来源对」。
 */
export async function writeAgentDistManifest({
  releaseRoot,
  tarball,
  version,
  platform,
  baseUrl,
  baseUrlSource,
  sourceCommit,
  sourceTree,
  workflowCommit,
  nodeVersion,
  pnpmVersion,
}) {
  const manifest = {
    version,
    platform,
    tarball: basename(tarball),
    tarballSha256: await sha256(tarball),
    tarballSize: (await readFile(tarball)).length,
    baseUrl,
    baseUrlKind: isPlaceholderBaseUrl(baseUrl) ? "placeholder" : "configured",
    baseUrlSource,
    sourceCommit,
    sourceTree,
    workflowCommit,
    toolchain: { node: nodeVersion, pnpm: pnpmVersion },
  };
  const path = join(releaseRoot, "AGENT-DIST-MANIFEST.json");
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
  return { path, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
    const key = arg.replace(/^--/, "").split("=")[0];
    if (key === "event") options.eventName = value;
    else if (key === "ref-type") options.refType = value;
    else if (key === "release-root") options.releaseRoot = value;
    else if (key === "version") options.version = value;
    else if (key === "tarball") options.tarball = value;
  }
  if (options.eventName) {
    // 只解析地址：供 workflow 在 build 步骤前取 --base-url，缺失即非零退出。
    const resolved = resolveAgentDistBaseUrl({
      eventName: options.eventName,
      refType: options.refType ?? "branch",
      inputs: { zcode_dist_base_url: process.env.INPUT_ZCODE_DIST_BASE_URL ?? "" },
      vars: { ZCODE_DIST_BASE_URL: process.env.VARS_ZCODE_DIST_BASE_URL ?? "" },
    });
    console.log(resolved.baseUrl);
  } else if (options.releaseRoot && options.version) {
    const tarball = await selectAgentDistTarball({
      releaseRoot: resolve(options.releaseRoot),
      version: options.version,
    });
    console.log(tarball);
  } else {
    console.error(
      "usage: node scripts/agent-node-dist.mjs --event <push|workflow_dispatch> [--ref-type <branch|tag>] | --release-root <dir> --version <ver>",
    );
    process.exit(2);
  }
}
