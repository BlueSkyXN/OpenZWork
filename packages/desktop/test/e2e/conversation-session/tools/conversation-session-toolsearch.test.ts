import { clearAppData } from "#e2e/helpers/desktop-app";
import { setupToolSearchDesktop, TOOLSEARCH_PLAN_PROVIDER } from "#e2e/helpers/toolsearch-desktop";
import { restartIntoWorkspace } from "#e2e/helpers/model-provider-restart";
import {
  switchV4Model,
  sendV4Prompt,
  waitForV4TimelineContaining,
  getV4PaneSnapshot,
  selectV4TaskById,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import {
  readToolSearchRequests,
  TOOLSEARCH_DEFERRED_TOOL,
  TOOLSEARCH_TODO_CALL_ID,
  TOOLSEARCH_DONE,
} from "#e2e/helpers/toolsearch-provider";
import { expectToolSearchDisabled } from "#e2e/helpers/toolsearch-desktop";

describe("ToolSearch Desktop 默认关闭与冷恢复", () => {
  const providerId = TOOLSEARCH_PLAN_PROVIDER;
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TS01/TS04: Personal Provider 默认完整目录，直接执行 TodoWrite 后冷恢复保持关闭", async function () {
    this.timeout(180_000);
    // 当前产品使用 Personal Provider，继续验证完整目录及冷恢复，不依赖账号套餐。
    await setupToolSearchDesktop();
    await switchV4Model(providerId, "GLM-5.3", "");
    await sendV4Prompt(
      `E2E_TOOLSEARCH_INITIAL 请搜索 ${TOOLSEARCH_DEFERRED_TOOL}，然后读取当前待办。`,
    );
    await waitForV4TimelineContaining(TOOLSEARCH_DONE, 60_000);
    const requests = await readToolSearchRequests();
    expectToolSearchDisabled(requests[0]!);
    assertTodoResult(requests);
    await waitForV4Pane((s) => !s.canStop, "搜索轮未结束", 30_000);
    const sessionId = (await getV4PaneSnapshot()).sessionId;
    expect(sessionId).toBeTruthy();
    await restartIntoWorkspace();
    await selectV4TaskById(sessionId!);
    const before = (await readToolSearchRequests()).length;
    await sendV4Prompt("E2E_TOOLSEARCH_COLD 继续验证已加载的工具。");
    await waitForV4TimelineContaining(TOOLSEARCH_DONE, 60_000);
    await browser.waitUntil(async () => (await readToolSearchRequests()).length > before, {
      timeout: 30_000,
    });
    await waitForV4Pane((s) => !s.canStop, "冷恢复轮未结束", 30_000);
    const coldRequests = (await readToolSearchRequests()).slice(before);
    expect(coldRequests).toHaveLength(1);
    const coldRequest = coldRequests[0]!;
    expectToolSearchDisabled(coldRequest);
    assertTodoResult([coldRequest]);
  });
});

function assertTodoResult(requests: Awaited<ReturnType<typeof readToolSearchRequests>>) {
  const result = requests
    .flatMap(({ requestJson }) =>
      requestJson.messages.flatMap((message) =>
        Array.isArray(message.content) ? message.content : [],
      ),
    )
    .find((block) => block.type === "tool_result" && block.tool_use_id === TOOLSEARCH_TODO_CALL_ID);
  expect(result).toBeDefined();
  expect(result?.is_error).not.toBe(true);
  // 新会话没有待办，TodoRead 的真实执行输出是空清单。
  expect(JSON.parse(String(result?.content))).toEqual({ todos: [] });
}
