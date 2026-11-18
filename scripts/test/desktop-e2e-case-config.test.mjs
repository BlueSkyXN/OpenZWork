import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const desktop = new URL("../../packages/desktop/", import.meta.url);

test("only E2E windows opt into sizes beyond the macOS work area", async () => {
  // OW-P029：核心检查守住主窗口选项的启用范围，真实尺寸由页面工具和双端会话 E2E 验证。
  const source = await readFile(new URL("src/main/desktopWindowChrome.ts", desktop), "utf8");
  assert.ok(
    /enableLargerThanScreen:\s*Boolean\(process\.env\.ZCODE_E2E_RUN_ID\?\.trim\(\)\)/.test(source),
    "the main window must opt in only during an E2E run",
  );
});

test("long session cases register their deadlines before WDIO invokes the body", async () => {
  // OW-P030：读取真实 Mocha Runnable 的预算，加载用例时不启动 Electron 或模型。
  const loadCases = `
    import Mocha from "mocha";
    const mocha = new Mocha({ timeout: 120_000 });
    for (const file of process.argv.slice(1)) mocha.addFile(file);
    await mocha.loadFilesAsync();
    const deadlines = [];
    mocha.suite.eachTest((runnable) => deadlines.push(runnable.timeout()));
    console.log(JSON.stringify(deadlines));
  `;
  const directory = "test/e2e/conversation-session/session-control/manual-review/pending";
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      loadCases,
      `${directory}/app-control-long-turn-retry.test.ts`,
      `${directory}/app-control-session-lifecycle.test.ts`,
    ],
    { cwd: desktop },
  );
  assert.deepEqual(JSON.parse(stdout), [900_000, 900_000]);
});
