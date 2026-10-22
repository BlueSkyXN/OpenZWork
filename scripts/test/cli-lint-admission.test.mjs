import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { classifyLintDiagnostics, parseLintCommand, resolvePnpmInvocation } from "../cli-lint-admission.mjs";

test("原生可执行入口不会被当成 JavaScript，脚本路径与空格参数原样传递", async () => {
  const execute = async (entry, args) => {
    const invocation = resolvePnpmInvocation(entry, args);
    return promisify(execFile)(invocation.command, invocation.args, { encoding: "utf8" });
  };
  assert.equal((await execute(process.execPath, ["--version"])).stdout.trim(), process.version);
  const directory = await mkdtemp(join(tmpdir(), "pnpm entry "));
  try {
    const entry = join(directory, "entry.cjs");
    await writeFile(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const args = ["exec", "oxlint", "path with spaces", "--format", "json"];
    assert.deepEqual(JSON.parse((await execute(entry, args)).stdout), args);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("只接纳原样上游的行数诊断，其他错误与修改过的文件仍阻断", () => {
  const diagnostics = [
    { filename: "src/original.ts", code: "eslint(max-lines)", severity: "error" },
    { filename: "src/edited.ts", code: "eslint(max-lines)", severity: "error" },
    { filename: "src/original.ts", code: "typescript(no-explicit-any)", severity: "error" },
    { filename: "src/original.ts", code: "eslint(no-unused-vars)", severity: "warning" },
  ];
  const result = classifyLintDiagnostics(diagnostics, {
    relativeDirectory: "apps/zcode-cli/packages/example",
    pristine: new Set(["apps/zcode-cli/packages/example/src/original.ts"]),
  });
  assert.deepEqual(result.accepted, [diagnostics[0]]);
  assert.deepEqual(result.errors, diagnostics.slice(1, 3));
  assert.deepEqual(result.warnings, [diagnostics[3]]);
});

test("保留包原有参数；不默默绕过未知或复合命令", () => {
  assert.deepEqual(parseLintCommand("oxlint src tests --no-ignore"), [
    "src",
    "tests",
    "--no-ignore",
  ]);
  for (const command of [
    "tsc --noEmit",
    "oxlint src && echo done",
    "oxlint 'src path'",
    "oxlint --format text src",
  ])
    assert.throws(() => parseLintCommand(command), /不支持/);
});
