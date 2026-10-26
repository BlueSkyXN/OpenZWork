#!/usr/bin/env node
// 每组独立进程、JSON 和期限；分片之间由 Actions 并行，分片内部保持串行。
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { selectFullSuiteGroups } from "./full-suite-plan.mjs";

export function parseShardArgs(args) {
  if (args.length === 0) return undefined;
  if (args.length !== 1 || !args[0].startsWith("--shard=")) {
    throw new Error("Usage: node scripts/run-full-suite-groups.mjs [--shard=<name>]");
  }
  const shard = args[0].slice("--shard=".length);
  selectFullSuiteGroups(shard);
  return shard;
}

export async function runFullSuiteGroups({
  shard,
  cwd = process.cwd(),
  env = process.env,
  execute = spawnSync,
} = {}) {
  const groups = selectFullSuiteGroups(shard);
  const outDir = resolve(cwd, ".run-logs/full-groups");
  await mkdir(outDir, { recursive: true });
  // 本地重复执行或 job 重跑不能把上一次成功报告当成本次结果；source.json 由 checkout 记录。
  await rm(resolve(outDir, "summary.json"), { force: true });
  const summary = { groups: [], anyFailed: false };
  for (const group of groups) {
    const jsonPath = resolve(outDir, `${group.name}.json`);
    await rm(jsonPath, { force: true });
    await rm(`${jsonPath}.cancelled`, { force: true });
    const args = [
      "exec",
      "vitest",
      "run",
      ...group.filter,
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${jsonPath}`,
    ];
    // Windows 的 pnpm.CMD 需要 shell；位置参数仍由原 Vitest projects include 过滤。
    const result = execute("pnpm", args, {
      cwd,
      stdio: "inherit",
      timeout: group.minutes * 60_000,
      env,
      shell: process.platform === "win32",
    });
    const cancelled = result.error?.code === "ETIMEDOUT";
    if (cancelled) await writeFile(`${jsonPath}.cancelled`, new Date().toISOString());
    const failed = result.status !== 0 || Boolean(result.error) || Boolean(result.signal);
    summary.groups.push({
      group: group.name,
      status: cancelled ? "cancelled" : failed ? "failed" : "passed",
      exit: result.status,
    });
    if (failed || cancelled) summary.anyFailed = true;
  }
  await writeFile(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("\nfull suite groups:", JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const summary = await runFullSuiteGroups({ shard: parseShardArgs(process.argv.slice(2)) });
  process.exitCode = summary.anyFailed ? 1 : 0;
}
