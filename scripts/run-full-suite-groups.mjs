#!/usr/bin/env node
// 每组独立进程、JSON 和期限；分片之间由 Actions 并行，分片内部保持串行。
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
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
  const groups = selectFullSuiteGroups(shard, env.EXTENDED_TEST_PLATFORM);
  const outDir = resolve(cwd, ".run-logs/full-groups");
  await mkdir(outDir, { recursive: true });
  // 本地重复执行或 job 重跑不能把上一次成功报告当成本次结果；source.json 由 checkout 记录。
  await rm(resolve(outDir, "summary.json"), { force: true });
  const summary = { groups: [], anyFailed: false };
  for (const group of groups) {
    const jsonPath = resolve(outDir, `${group.name}.json`);
    await rm(jsonPath, { force: true });
    await rm(`${jsonPath}.cancelled`, { force: true });
    let scope;
    if (group.vitestShard) {
      // 原生 discovery 与 run 使用同一过滤器；汇总按实际报告验证两半覆盖完整。
      const discoveryDir = await mkdtemp(resolve(cwd, ".run-logs/discovery-"));
      try {
        const output = resolve(discoveryDir, "all.json");
        // Vitest list --filesOnly 不应用 --shard；只取全组清单，实际分片文件由测试 JSON 提供。
        const result = execute(
          "pnpm",
          ["exec", "vitest", "list", ...group.filter, "--filesOnly", `--json=${output}`],
          {
            cwd,
            env,
            stdio: "inherit",
            timeout: group.minutes * 60_000,
            shell: process.platform === "win32",
          },
        );
        assert.ok(
          result.status === 0 && !result.error && !result.signal,
          "UI shard discovery failed",
        );
        scope = {
          root: cwd,
          all: JSON.parse(await readFile(output, "utf8"))
            .map(({ file }) => relative(cwd, file).split(sep).join("/"))
            .sort(),
        };
        assert.ok(scope.all.length > 0, "UI shard discovery is empty");
        assert.equal(new Set(scope.all).size, scope.all.length, "Duplicate UI discovery file");
      } finally {
        await rm(discoveryDir, { recursive: true, force: true });
      }
    }
    const args = [
      "exec",
      "vitest",
      "run",
      ...group.filter,
      ...(group.vitestShard ? [`--shard=${group.vitestShard}`] : []),
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
      ...(group.vitestShard ? { vitestShard: group.vitestShard, scope } : {}),
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
