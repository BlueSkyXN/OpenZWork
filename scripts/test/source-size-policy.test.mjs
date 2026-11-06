import ts from "typescript";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

for (const binary of [
  "node_modules/oxlint/bin/oxlint",
  "apps/zcode-cli/node_modules/oxlint/bin/oxlint",
])
  test(`${binary}: 800 行为默认阻断阈值，包内已接纳的大文件仅降级行数诊断`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zcode-size-policy-"));
    try {
      const { config } = ts.parseConfigFileTextToJson(
        ".oxlintrc.json",
        await readFile(join(root, ".oxlintrc.json"), "utf8"),
      );
      // 此处对比两个锁定版本的规则匹配；包入口与语料排除另由 cli-lint-admission 实际执行验证。
      config.ignorePatterns = [];
      await writeFile(join(cwd, ".oxlintrc.json"), JSON.stringify(config));
      const regular = "packages/example/src/new.ts";
      const accepted = [
        "apps/zcode-cli/packages/adapters/src/model/runner-stream.ts",
        "apps/zcode-cli/packages/adapters/src/mcp/index.ts",
        "apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts",
        "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts",
        "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/v4-bridge.ts",
        "apps/zcode-cli/packages/bootstrap/src/app/create-app.ts",
        "apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/v4-gateway.ts",
      ];
      async function lint(file, lines) {
        await mkdir(dirname(join(cwd, file)), { recursive: true });
        await writeFile(
          join(cwd, file),
          Array.from({ length: lines }, (_, i) => `export const value${i} = ${i};`).join("\n"),
        );
        const packageRoot =
          binary.startsWith("apps/") && file.startsWith("apps/zcode-cli/")
            ? file.split("/").slice(0, 4).join("/")
            : ".";
        const target = packageRoot === "." ? file : file.slice(packageRoot.length + 1);
        const result = await exec(
          process.execPath,
          [
            join(root, binary),
            ...(binary.startsWith("apps/") ? ["--no-ignore"] : []),
            "--format",
            "json",
            target,
          ],
          { cwd: join(cwd, packageRoot) },
        ).catch((error) => error);
        return JSON.parse(result.stdout).diagnostics;
      }
      assert.equal(
        (await lint(regular, 800)).filter((x) => x.code === "eslint(max-lines)").length,
        0,
      );
      assert.equal(
        (await lint(regular, 801)).find((x) => x.code === "eslint(max-lines)")?.severity,
        "error",
      );
      for (const file of accepted) {
        assert.equal(
          (await lint(file, 801)).find((x) => x.code === "eslint(max-lines)")?.severity,
          "warning",
          file,
        );
      }
      assert.equal(
        (await lint("apps/zcode-cli/packages/bootstrap/src/new.ts", 801)).find(
          (x) => x.code === "eslint(max-lines)",
        )?.severity,
        "error",
        "包内未登记的新文件仍使用默认阈值",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
