import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const desktop = new URL("../../packages/desktop/", import.meta.url);

test("only E2E windows opt into sizes beyond the macOS work area", async () => {
  // OW-P029：核心检查守住主窗口选项的启用范围，真实尺寸由页面工具和双端会话 E2E 验证。
  const source = await readFile(new URL("src/main/desktopWindowChrome.ts", desktop), "utf8");
  assert.ok(
    /enableLargerThanScreen:\s*Boolean\(process\.env\.ZCODE_E2E_RUN_ID\?\.trim\(\)\)/.test(source),
    "the main window must opt in only during an E2E run",
  );
});

test("long session and mobile recovery cases register their deadlines before WDIO invokes the body", async () => {
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
      "test/e2e/conversation-session/remote/mobile/conversation-session-web-remote-recovery.test.ts",
    ],
    { cwd: desktop },
  );
  assert.deepEqual(
    JSON.parse(stdout),
    [
      900_000, 900_000, 300_000, 300_000, 240_000, 240_000, 180_000, 180_000, 180_000, 180_000,
      180_000, 180_000,
    ],
  );
});

test("a navigation after the native visibility check preserves the observed foreground event", async (t) => {
  // OW-P032：在可见性已确认后切换文档，旧上下文不能再读取，仍应保存这次前台事实。
  const { chromium } = await import("playwright-core");
  const { tsImport } = await import("tsx/esm/api");
  const { createWebRemoteVisibilityBrowser } = await tsImport(
    "../../packages/desktop/test/e2e/helpers/web-remote-visibility-browser.ts",
    import.meta.url,
  );
  const dir = await mkdtemp(join(tmpdir(), "openzwork-visibility-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const page = {
    on() {},
    setDefaultTimeout() {},
    async bringToFront() {},
    waitForFunction: t.mock.fn(async () => {}),
    async evaluate() {
      throw new Error("Execution context was destroyed");
    },
  };
  t.mock.method(chromium, "launch", async () => ({
    newContext: async () => ({ newPage: async () => page, close: async () => {} }),
    close: async () => {},
  }));
  const native = await createWebRemoteVisibilityBrowser(dir);
  try {
    await native.show();
    assert.equal(page.waitForFunction.mock.callCount(), 1);
    assert.equal(page.waitForFunction.mock.calls[0].arguments[1], "visible");
    const event = JSON.parse(await readFile(join(dir, "MRO03-native-stages.jsonl"), "utf8"));
    assert.deepEqual(event, { stage: "native-foreground", detail: { visibility: "visible" } });
  } finally {
    await native.close();
  }
});

test("the replay server answers each design cross-session prompt", async (t) => {
  const { tsImport } = await import("tsx/esm/api");
  const { startUpstreamReplayServer } = await tsImport(
    "../../packages/desktop/test/e2e/helpers/upstream-replay-server.ts",
    import.meta.url,
  );
  const dir = await mkdtemp(join(tmpdir(), "openzwork-design-replay-"));
  const fixture = new URL(
    "test/e2e/fixtures/upstream/browser/browser-design-mode-cross-session.json",
    desktop,
  );
  const server = await startUpstreamReplayServer({
    artifactPath: join(dir, "network.json"),
    fixturePaths: [fileURLToPath(fixture)],
  });
  t.after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });
  for (const marker of [
    "E2E_DESIGN_CROSS_SESSION_A",
    "E2E_DESIGN_CROSS_SESSION_B",
    "E2E_DESIGN_AMBIENT_DESKTOP",
  ]) {
    const response = await fetch(server.baseUrl + "/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: marker + ': Reply with exactly "upstream-e2e-ok".' }],
      }),
    });
    assert.equal(response.status, 200, marker);
    assert.match(await response.text(), /upstream-e2e-ok/);
  }
});

test("local preview readiness follows the active browser tab across navigation", async () => {
  // OW-P034：后台标签的旧标题和未提交导航的前台标签均不能放行页面读取。
  const { JSDOM } = await import("jsdom");
  const { tsImport } = await import("tsx/esm/api");
  const { readActiveBrowserTabTitle } = await tsImport(
    "../../packages/desktop/test/e2e/helpers/browser-side-pane.ts",
    import.meta.url,
  );
  const dom = new JSDOM(`
    <div data-side-pane-tab-id="browser:previous" data-state="inactive"><span data-side-pane-tab-title>Preview</span></div>
    <div data-side-pane-tab-id="browser:current" data-state="active"><span data-side-pane-tab-title>Browser</span></div>
  `);
  try {
    const { document } = dom.window;
    assert.equal(readActiveBrowserTabTitle(document), "Browser");
    document.querySelector('[data-state="active"] [data-side-pane-tab-title]').textContent =
      "Preview";
    assert.equal(readActiveBrowserTabTitle(document), "Preview");
    document.querySelector('[data-state="active"]').remove();
    assert.equal(readActiveBrowserTabTitle(document), null);
  } finally {
    dom.window.close();
  }
});

test("browser navigation submits the verified address to the input that was edited", async (t) => {
  // OW-P034：焦点可在 tab 恢复时变化，全局回车或提交被重写的地址均不符合用户操作。
  const { tsImport } = await import("tsx/esm/api");
  const { submitBrowserAddress } = await tsImport(
    "../../packages/desktop/test/e2e/helpers/browser-side-pane.ts",
    import.meta.url,
  );
  const url = "https://example.test/preview";
  const calls = [];
  const input = {
    click() {
      calls.push("focus");
    },
    addValue(value) {
      calls.push(value);
    },
    getValue() {
      return url;
    },
  };
  const previous = globalThis.browser;
  globalThis.browser = {
    keys(keys) {
      calls.push(keys);
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.browser;
    else globalThis.browser = previous;
  });
  await submitBrowserAddress(input, url);
  assert.deepEqual(calls, [
    "focus",
    [process.platform === "darwin" ? "Meta" : "Control", "a"],
    url,
    "\uE007",
  ]);
  calls.length = 0;
  await assert.rejects(
    submitBrowserAddress({ ...input, getValue: () => "about:blank" }, url),
    /地址栏/,
  );
  assert.ok(!calls.includes("\uE007"));
});

test("the mobile dev server prebundles the diff worker before a paired page sends its first task", async () => {
  // OW-P035：冷缓存下首次渲染任务会发现这个动态 worker；启动阶段须已登记该依赖。
  const { loadConfigFromFile } = await import("vite");
  const root = fileURLToPath(new URL("../web/", desktop));
  const result = await loadConfigFromFile(
    { command: "serve", mode: "development", isPreview: false, isSsrBuild: false },
    join(root, "vite.config.ts"),
    root,
    "silent",
  );
  assert.ok(result?.config.optimizeDeps?.include?.includes("@pierre/diffs/worker/worker.js"));
});

test("project batch checks wait for all changed rows and preserve unrelated removals", async () => {
  // OW-P051：用回放中读到的中间状态验证批量撤销的完成条件。
  const { tsImport } = await import("tsx/esm/api");
  const { projectDeletionFlagsMatch } = await tsImport(
    "../../packages/desktop/test/e2e/helpers/project-sidebar.ts",
    import.meta.url,
  );
  const expected = { missing: 0, idle: 0, empty: 0, previouslyRemoved: 1 };
  assert.equal(projectDeletionFlagsMatch({ ...expected, empty: 1 }, expected), false);
  assert.equal(projectDeletionFlagsMatch({ ...expected, previouslyRemoved: 0 }, expected), false);
  assert.equal(projectDeletionFlagsMatch({ idle: 0 }, expected), false);
  assert.equal(projectDeletionFlagsMatch({ ...expected, pinned: 0 }, expected), true);
});
