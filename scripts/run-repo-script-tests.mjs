#!/usr/bin/env node
// OpenZWork(OZ-F012)：执行仓库 Node 脚本回归（scripts/test/*.test.mjs），并自动排除由 Vitest
// 工程套件（scripts/engineering-test-files.json）承接的 .test.mjs 文件（例如上游 v4.0.0 新增的
// scripts/test/audit-conversation-session-json-out.test.mjs），同时兼容 POSIX shell 展开与 Windows 原始 glob。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function toPosixRelative(filePath) {
  const rel = relative(REPO_ROOT, resolve(REPO_ROOT, filePath));
  return rel.split("\\").join(posix.sep);
}

const engineeringTests = new Set(
  JSON.parse(readFileSync(resolve(REPO_ROOT, "scripts/engineering-test-files.json"), "utf8")).map(
    (entry) => toPosixRelative(entry),
  ),
);

const flags = [];
const rawTargets = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("-")) flags.push(arg);
  else rawTargets.push(arg);
}

const expanded = [];
for (const target of rawTargets.length > 0 ? rawTargets : ["scripts/test/*.test.mjs"]) {
  if (target.includes("*")) {
    expanded.push(...globSync(target, { cwd: REPO_ROOT }).map((item) => toPosixRelative(item)));
  } else {
    expanded.push(toPosixRelative(target));
  }
}

const selected = [...new Set(expanded)].filter((file) => !engineeringTests.has(file)).sort();
if (selected.length === 0) {
  console.error("No Node repo-script test files selected.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...flags, ...selected], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
