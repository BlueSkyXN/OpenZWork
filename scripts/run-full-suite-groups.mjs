#!/usr/bin/env node
// 全量历史套件按包分组执行：任一组超时或崩溃，其余组的 JSON 仍完整落盘。
// 修复原因：原单条 vitest 命令跑全部包时，被取消/超时后 --reporter=json 不落任何文件，
// 扩展检查只剩 Actions 日志可用（2026-10-19 两个候选的六个 full-suite job 均如此）。
// 分组后每组独立进程、独立 JSON、独立时限；组间串行，超时组记录 cancelled 标记后继续。

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GROUPS = [
  {
    name: "shared-and-rpc",
    filter: [
      "packages/shared",
      "packages/rpc",
      "packages/client",
      "packages/model-option-map",
    ],
  },
  { name: "services", filter: ["packages/services"] },
  { name: "provider", filter: ["packages/provider", "packages/provider-node"] },
  { name: "server", filter: ["packages/server", "packages/zcode-server-cli"] },
  // desktop 传 test 与 src：test 覆盖大多数用例，src 覆盖架构治理放在模块目录内的
  // contract.test.ts 与源码旁回归（config include 的第二条）。
  {
    name: "desktop",
    filter: ["packages/desktop/test", "packages/desktop/src"],
  },
  { name: "ui-and-web", filter: ["packages/ui", "packages/web"] },
  // 根配置 unit include 里还有源码旁的 GenUI 用例（config 另列的两个 .test.mjs 文件
  // 在净化后已不存在，vitest 对缺失 include 是 no-op，无需分组）。补进末组保证分组
  // 全集等于原全量命令的发现范围。
  {
    name: "root-scripts",
    filter: [
      "packages/shared/src/node/genUiPaths.test.ts",
      "packages/services/src/gen-ui",
    ],
  },
];

// 每组给足包体量对应的时限（分钟）；到点 SIGTERM，JSON 写不出时以组级 cancelled 标记兜底。
const GROUP_MINUTES = {
  "shared-and-rpc": 12,
  services: 20,
  provider: 12,
  server: 12,
  desktop: 30,
  "ui-and-web": 30,
  "root-scripts": 10,
};

const outDir = resolve(process.cwd(), ".run-logs/full-groups");
mkdirSync(outDir, { recursive: true });

const summary = { groups: [], anyFailed: false };
for (const group of GROUPS) {
  const jsonPath = resolve(outDir, `${group.name}.json`);
  const args = [
    "run",
    // 位置参数是路径过滤器，与根配置 projects 的 include 取交集，e2e 始终不会进组。
    ...group.filter,
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${jsonPath}`,
  ];
  const res = spawnSync("pnpm", ["exec", "vitest", ...args], {
    stdio: "inherit",
    timeout: (GROUP_MINUTES[group.name] ?? 15) * 60_000,
    env: process.env,
  });
  const cancelled = res.error && res.error.code === "ETIMEDOUT";
  if (cancelled)
    writeFileSync(`${jsonPath}.cancelled`, new Date().toISOString());
  const failed = res.status !== 0;
  summary.groups.push({
    group: group.name,
    status: cancelled ? "cancelled" : failed ? "failed" : "passed",
    exit: res.status,
  });
  if (failed || cancelled) summary.anyFailed = true;
}

writeFileSync(
  resolve(outDir, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log("\nfull suite groups:", JSON.stringify(summary, null, 2));
process.exitCode = summary.anyFailed ? 1 : 0;
