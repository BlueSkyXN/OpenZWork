import {
  installHandoffRpcProbe,
  callHandoffHost,
} from "../../../helpers/remote-project-handoff-probe.js";
import { ServiceChannels } from "@zcode/shared";
import { join } from "node:path";
import { startConversationModelProviderReplayServer } from "../../../helpers/model-provider-replay.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import { reloadElectronSessionSafely } from "../../../helpers/e2e-electron-reload.js";
import {
  clickTestIdByDom,
  readModelProviders,
  seedSettings,
} from "../../../helpers/desktop-app.js";
import {
  clickFirstV4Fork,
  waitForV4Fork,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import {
  setCurrentRendererViewport,
  clearCurrentRendererViewport,
} from "../../../helpers/renderer-viewport.js";
import { UPSTREAM_PROVIDER_ID } from "../../../helpers/upstream-provider.js";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_MODEL_PROVIDER_NAV_ITEM,
  testId,
} from "@zcode/shared/test-ids";

const caseName = "conversation-session-model-discovery-usage";
const artifact = () => process.env.ZCODE_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts");
async function section(id: string) {
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, id));
}
async function appearance(theme: string, locale = "zh-CN") {
  await browser.execute(
    (theme, locale) => {
      const actions = (
        window as unknown as {
          __testActions: { setLocale(value: string): void; setTheme(value: string): void };
        }
      ).__testActions;
      actions.setLocale(locale);
      actions.setTheme(theme);
    },
    theme,
    locale,
  );
}

describe("MD01 / PU03–04 / UX01 模型拉取与用量", () => {
  let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>>;
  before(async () => {
    replay = await startConversationModelProviderReplayServer(caseName, {
      seedPersonalConfig: true,
    });
    await seedSettings({ toolSearchMode: "off" });
  });
  after(async () => {
    await replay?.stop();
  });
  afterEach(clearCurrentRendererViewport);
  it("真实模型列表添加、统计筛选及 QueryUsage Host 往返", async function () {
    this.timeout(240_000);
    await skipOccupationOnboardingIfPresent();
    await waitForV4Pane((state) => state.sessionId === "draft", "初始草稿未就绪", 60_000);
    await reloadElectronSessionSafely(browser);
    await skipOccupationOnboardingIfPresent();
    await prepareV4ConversationE2E({ skipProvider: true, skipShellReady: true });
    await sendV4Prompt("E2E_MODEL_USAGE_INITIAL");
    await waitForV4TimelineContaining("MODEL_USAGE_READY");
    const before = await waitForV4Pane(
      (state) => !!state.sessionId && state.sessionId !== "draft" && !state.canStop,
      "合成请求未完成",
    );
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await appearance("zai-light");
    await section("modelProvider");
    await clickTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, `custom:${UPSTREAM_PROVIDER_ID}`));
    await clickTestIdByDom("provider-model-discovery-open");
    const dialog = $('[data-testid="provider-model-discovery-dialog"]');
    await dialog.waitForDisplayed();
    const candidate = $('[role="checkbox"][aria-label="e2e-discovery-added"]');
    await candidate.waitForDisplayed();
    expect(await $$('[role="checkbox"][aria-label="e2e-discovery-added"]').length).toBe(1);
    expect(
      await $('[role="checkbox"][aria-label="deepseek-v4-flash"]').getAttribute("data-disabled"),
    ).not.toBeNull();
    await browser.saveScreenshot(join(artifact(), "model-discovery-list.png"));
    await candidate.click();
    await clickTestIdByDom("provider-model-discovery-add");
    await dialog.waitForExist({ reverse: true });
    await browser.waitUntil(
      async () =>
        (await readModelProviders()).some(
          (provider) =>
            provider.id === UPSTREAM_PROVIDER_ID &&
            provider.models.some((model) => model.id === "e2e-discovery-added"),
        ),
      { timeout: 15_000 },
    );
    await browser.saveScreenshot(join(artifact(), "model-discovery-saved.png"));
    await section("usage");
    await $('[data-testid="usage-project-filter"]').waitForDisplayed();
    await $('[data-testid="usage-details-open"]').waitForDisplayed({ timeout: 30_000 });
    expect(await $('[data-testid="usage-session-details"]').isExisting()).toBe(false);
    await browser.saveScreenshot(join(artifact(), "project-usage-light.png"));
    const scrollBefore = await browser.execute(() => {
      const main = document.querySelector('[data-testid="usage-details-open"]')!.closest("main")!;
      main.scrollTop = 80;
      return main.scrollTop;
    });
    await clickTestIdByDom("usage-details-open");
    await $('[data-testid="usage-session-details"]').waitForDisplayed({ timeout: 30_000 });
    expect(await $('[data-testid="settings-breadcrumb-section"]').getText()).toBe("使用统计");
    expect(await $('[data-testid="usage-session-table"] tbody tr td:last-child').getText()).toBe(
      "120",
    );
    expect(await browser.execute(() => document.activeElement?.textContent)).toBe("会话明细");
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="usage-session-details"]')!.closest("main")!
            .scrollTop,
      ),
    ).toBe(0);
    await browser.saveScreenshot(join(artifact(), "project-usage-sessions.png"));
    await clickTestIdByDom("usage-details-back");
    await $('[data-testid="usage-details-open"]').waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(
      async () =>
        await browser.execute((scroll) => {
          const entry = document.querySelector('[data-testid="usage-details-open"]')!;
          return (
            Math.abs(entry.closest("main")!.scrollTop - scroll) <= 1 &&
            document.activeElement === entry
          );
        }, scrollBefore),
      { timeout: 10_000, timeoutMsg: "返回未恢复滚动或焦点" },
    );
    await appearance("zai-light", "en-US");
    await clickTestIdByDom("usage-project-filter");
    await browser.execute(() => {
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (x) => x.textContent?.trim() === "Unassigned",
      );
      if (!option) throw new Error("Unassigned scope missing");
      option.click();
    });
    await browser.waitUntil(async () =>
      (await $('[data-testid="usage-project-filter"]').getText()).includes("Unassigned"),
    );
    await $('[data-testid="usage-details-open"]').waitForDisplayed({ timeout: 30_000 });
    await setCurrentRendererViewport(480, 844);
    await appearance("zai-dark", "en-US");
    await browser.saveScreenshot(join(artifact(), "project-usage-narrow-dark.png"));
    await clickTestIdByDom("usage-details-open");
    await $('[data-testid="usage-session-list"]').waitForDisplayed({ timeout: 30_000 });
    expect(await $('[data-testid="usage-session-table"]').isDisplayed()).toBe(false);
    expect(await $('[data-testid="usage-session-list-totals"]').getText()).toContain("120");
    await browser.saveScreenshot(join(artifact(), "project-usage-sessions-narrow.png"));
    expect(
      await browser.execute(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
    await clickTestIdByDom("usage-details-back");
    await $('[data-testid="usage-details-open"]').waitForDisplayed({ timeout: 30_000 });
    expect(await $('[data-testid="usage-project-filter"]').getText()).toContain("Unassigned");
    await clearCurrentRendererViewport();
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    const after = await waitForV4Pane(
      (state) => state.sessionId === before.sessionId,
      "设置返回改变了会话身份",
    );
    expect(after.sessionId).toBe(before.sessionId);
    await sendV4Prompt("E2E_USAGE_TOOL");
    await waitForV4TimelineContaining("USAGE_QUERY_OK");
    await waitForV4Pane((state) => !state.canStop, "QueryUsage 后请求未结算");
    await browser.saveScreenshot(join(artifact(), "usage-tool-result.png"));
    await installHandoffRpcProbe();
    try {
      await waitForV4Fork();
      expect(await clickFirstV4Fork()).toBe(true);
      const fork = await waitForV4Pane(
        (state) =>
          !!state.sessionId && state.sessionId !== before.sessionId && state.sessionId !== "draft",
        "fork 未创建独立会话",
      );
      await browser.waitUntil(
        async () => {
          const tree = await callHandoffHost<{ tasks: Array<{ taskId: string }> }>(
            ServiceChannels.Project,
            "readTree",
          );
          return (
            tree.tasks.some((task) => task.taskId === fork.sessionId) &&
            tree.tasks.some((task) => task.taskId === before.sessionId)
          );
        },
        { timeout: 30_000, timeoutMsg: "fork 未进入 Host 独立任务列表" },
      );
    } finally {
      await browser.execute(() => window.__remoteProjectHandoffRpc?.restore());
    }
  });
});
