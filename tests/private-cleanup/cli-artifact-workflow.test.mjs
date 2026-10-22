import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const bundle = new URL("../../apps/zcode-cli/packages/cli/dist/zcode.cjs", import.meta.url);

test("built CLI parses workflow-mode before rejecting an unknown option", async () => {
  await access(bundle);
  const dataRoot = await mkdtemp(join(tmpdir(), "openzwork-cli-artifact-"));
  try {
    // 修复原因：源文件参数解析通过仍可能被旧 .js 遮蔽；直接执行构建产物。
    // 未知参数在任何模型/会话启动之前终止，不发模型请求。
    await assert.rejects(
      execute(
        process.execPath,
        [fileURLToPath(bundle), "--workflow-mode", "onDemand", "--openzwork-unknown-option"],
        {
          env: { ...process.env, ZCODE_DATA_BASE_DIR: dataRoot },
          timeout: 15_000,
        },
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /openzwork-unknown-option/);
        assert.doesNotMatch(error.stderr, /Unknown option[^\n]*workflow-mode/);
        return true;
      },
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
