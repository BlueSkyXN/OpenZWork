#!/usr/bin/env node
// 独立 Node 分发（build:zcode tarball）内容检查（CI-FIRST §2.5/F4 同口径）：结构、版本、
// 数据根常量、裁剪域标记、tarball sha256，输出结构化报告供 workflow 上传与 job summary。
// 用法：node scripts/verify-agent-node-dist.mjs --tarball <path> [--report <path>]
// 裁剪标记为 2026-11-15 对已验收 zcode-3.18.2 tarball 实测 0 命中后收录；
// 注意 start-plan/highspeed 不作禁标记：官方套餐/加速卡/闲时任务的**服务与 UI 域**已按
// OZ-D002 删除（含 packages/services/src/coding-plan-subscription 与 highspeed 等目录），
// 但 CLI 内 start-plan 字样命中属通用重试/错误处理的 provider-id 兼容分支
// （streaming-recovery.ts / target-completion-verification.ts 的 busy 重试集合与
// prompt-turn.ts 的 Provider 下架恢复），全词禁用会误伤合法兼容代码；
// 字符串零/非零命中都不反向决定产品套餐能力范围。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, access, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const FORBIDDEN_AGENT_MARKERS = [
  "oauthCredentialRepo",
  "compactLogArchive",
  "useMicrophonePermissionGuide",
];

// tarball 顶层目录名与必备结构（F4 解包核验口径）。
const PACKAGE_DIR = "zcode";
const REQUIRED_ENTRIES = ["agent/zcode.cjs", "package.json", "server", "web"];

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

export async function verifyAgentNodeDist({
  tarball,
  expectedVersion = "",
  forbiddenMarkers = FORBIDDEN_AGENT_MARKERS,
  keepWorkspace = false,
}) {
  const failures = [];
  const tarballSha256 = await sha256(tarball);
  const workspace = await mkdtemp(join(tmpdir(), "openzwork-agent-dist-"));
  try {
    await exec("tar", ["-xzf", resolve(tarball), "-C", workspace]);
    const root = join(workspace, PACKAGE_DIR);
    // 用 fs.access 而非 `test -e`：repo-scripts 在 macOS/Windows/Linux 三平台运行，
    // 命令行的 test 不是 Windows shell 内建。
    const exists = async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };
    for (const entry of REQUIRED_ENTRIES) {
      if (!(await exists(join(root, entry)))) failures.push(`required entry missing: ${entry}`);
    }
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (expectedVersion && pkg.version !== expectedVersion)
      failures.push(`packaged version ${pkg.version} != ${expectedVersion}`);
    const agent = await readFile(join(root, "agent", "zcode.cjs"), "utf8");
    const forbidden = {};
    for (const marker of forbiddenMarkers) {
      forbidden[marker] = countOccurrences(agent, marker);
      if (forbidden[marker] > 0)
        failures.push(`trimmed-domain marker '${marker}' present (${forbidden[marker]} hits)`);
    }
    const dataRootHits = countOccurrences(agent, ".openzwork");
    if (dataRootHits === 0)
      failures.push("data root constant '.openzwork' missing from agent bundle");
    const report = {
      tarball: resolve(tarball),
      tarballSha256,
      version: pkg.version,
      expectedVersion: expectedVersion || null,
      dataRootHits,
      forbiddenMarkers: forbidden,
      requiredEntries: REQUIRED_ENTRIES,
      ok: failures.length === 0,
      failures,
    };
    return report;
  } finally {
    if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parseArgs = (argv) => {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
      if (arg === "--tarball" || arg.startsWith("--tarball=")) options.tarball = value;
      else if (arg === "--expected-version" || arg.startsWith("--expected-version="))
        options.expectedVersion = value;
      else if (arg === "--report" || arg.startsWith("--report=")) options.report = value;
    }
    return options;
  };
  const options = parseArgs(process.argv.slice(2));
  if (!options.tarball) {
    console.error(
      "usage: node scripts/verify-agent-node-dist.mjs --tarball <path> [--expected-version <semver>] [--report <path>]",
    );
    process.exit(2);
  }
  const report = await verifyAgentNodeDist(options);
  if (options.report) {
    await mkdir(resolve(options.report, ".."), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
