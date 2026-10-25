import { TID_CHAT_MODEL_SELECT_TRIGGER } from "@zcode/shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";

// CPE03：仅配置选择，不发送模型请求；人工 review 前保留 pending。
describe("模型菜单选择后的连续调档", () => {
  before(async () => {
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("选择其他模型和重复选择当前模型后都保留菜单", async () => {
    const trigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
    for (const selected of [false, true]) {
      await trigger.waitForClickable({ timeout: 15000 });
      await trigger.click();
      const option = $(
        `[data-testid^="chat-model-select-item-"]${selected ? '[data-checked="true"]' : ':not([data-checked="true"])'}:not([data-model-option-locked])`,
      );
      await option.waitForClickable({ timeout: 15000 });
      const value = (await option.getAttribute("data-testid"))!.slice(
        "chat-model-select-item-".length,
      );
      await option.click();
      await browser.waitUntil(
        async () =>
          (await trigger.getAttribute("data-model-current-value")) === value &&
          (await trigger.getAttribute("aria-expanded")) === "true",
        { timeout: 15000, timeoutMsg: "模型选择后没有保留已更新的菜单" },
      );
      await browser.keys("Escape");
      await browser.waitUntil(
        async () => (await trigger.getAttribute("aria-expanded")) !== "true",
        {
          timeout: 5000,
        },
      );
    }
  });
});
