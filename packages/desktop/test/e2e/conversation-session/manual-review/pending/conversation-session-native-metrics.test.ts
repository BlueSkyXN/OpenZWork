import { startConversationModelProviderReplayServer } from "../../../helpers/model-provider-replay.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";
import { reloadElectronSessionSafely } from "../../../helpers/e2e-electron-reload.js";
import { clickTestIdByDom } from "../../../helpers/desktop-app.js";
import { openSubagentHostWindow } from "../../../helpers/subagent-host-window.js";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  testId,
} from "@zcode/shared/test-ids";

const BAR = '[data-testid="conversation-metrics-bar"]';
const DETAILS = '[data-testid="conversation-metrics-details"]';
const FIELD_IDS = [
  "statusDuration",
  "speed",
  "firstText",
  "turnTokens",
  "cache",
  "sessionTokens",
  "toolCalls",
];
async function openMetricsSettings() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 30000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "appearance"));
  await $('[data-testid="metrics-display-settings"]').waitForDisplayed();
}
async function chooseFields(selected: string[]) {
  for (const id of FIELD_IDS) {
    const control = $(`[data-testid="metrics-display-field-${id}"]`);
    if (((await control.getAttribute("aria-checked")) === "true") !== selected.includes(id))
      await control.click();
  }
}
async function switchMetricsWindow(handle: string) {
  await browser.switchToWindow(handle);
  (browser.electron as typeof browser.electron & { windowHandle?: string }).windowHandle = handle;
}
async function setMetricsViewport(width: number) {
  await browser.electron.execute(async (electron, width) => {
    const window = electron.BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.isVisible(),
    )!;
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }, width);
  await browser.waitUntil(() => browser.execute((width) => innerWidth === width, width));
}
describe("NCM01/03/07–11 原生指标栏", () => {
  let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>>;
  before(async () => {
    replay = await startConversationModelProviderReplayServer(
      "conversation-session-native-metrics",
      { seedPersonalConfig: true },
    );
  });
  after(async () => {
    await replay?.stop();
  });
  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    const artifact = process.env.ZCODE_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts");
    await browser.saveScreenshot(join(artifact, "native-metrics-failure.png"));
    await writeFile(
      join(artifact, "native-metrics-failure-ui.txt"),
      await browser.execute(() => document.body.innerText),
    );
  });
  it("请求结算、设置选择、多窗口同步、冷恢复及窄屏主题", async function () {
    this.timeout(240_000);
    await skipOccupationOnboardingIfPresent();
    await waitForV4Pane((s) => s.sessionId === "draft", "NCM 初始草稿未就绪", 60000);
    await reloadElectronSessionSafely(browser);
    await skipOccupationOnboardingIfPresent();
    await prepareV4ConversationE2E({ skipProvider: true, skipShellReady: true });
    await sendV4Prompt("E2E_NATIVE_METRICS_FIRST");
    await waitForV4TimelineContaining("NATIVE_METRICS_OK");
    const pane = await waitForV4Pane(
      (s) => Boolean(s.sessionId && s.sessionId !== "draft") && !s.canStop,
      "NCM 请求未完成",
    );
    await $(BAR).waitForDisplayed();
    await browser.waitUntil(async () => (await $(BAR).getText()).includes("120"), {
      timeout: 15_000,
      timeoutMsg: "NCM 未从真实结算投影获得 120 token",
    });
    const more = $(`${BAR} button[aria-expanded]`);
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await $(DETAILS).waitForDisplayed();
    expect(await $(DETAILS).getText()).toContain("80%");
    expect(await $('[data-testid="conversation-metrics-session-total"]').getText()).toBe("120");
    const detailBefore = await $(DETAILS).getText();
    await more.click();
    await $('[data-testid="conversation-turn-metrics"]').click();
    await $(DETAILS).waitForDisplayed();
    expect(await $(DETAILS).getText()).toContain("120");
    await browser.keys("Escape");
    await reloadElectronSessionSafely(browser);
    await selectV4TaskById(pane.sessionId!);
    await $(BAR).waitForDisplayed();
    const reopened = $(`${BAR} button[aria-expanded]`);
    if ((await reopened.getAttribute("aria-expanded")) !== "true") await reopened.click();
    await $(DETAILS).waitForDisplayed();
    expect(await $(DETAILS).getText()).toBe(detailBefore);
    expect(await $('[data-testid="conversation-metrics-session-total"]').getText()).toBe("120");
    const artifact = process.env.ZCODE_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts");
    // 从第二个真实产品窗口修改，第一窗口保持已展开的同一会话。
    const primaryHandle = await browser.getWindowHandle();
    const secondary = await openSubagentHostWindow();
    try {
      await skipOccupationOnboardingIfPresent();
      await openMetricsSettings();
      await browser.execute(() => {
        const actions = (
          window as unknown as {
            __testActions: { setLocale(value: string): void; setTheme(value: string): void };
          }
        ).__testActions;
        actions.setLocale("zh-CN");
        actions.setTheme("zai-light");
      });
      await $('[data-testid="metrics-display-settings"]').saveScreenshot(
        join(artifact, "metrics-settings-default.png"),
      );
      await chooseFields(["speed", "turnTokens"]);
      await $('[data-testid="metrics-display-settings"]').saveScreenshot(
        join(artifact, "metrics-settings-selected.png"),
      );
      await switchMetricsWindow(primaryHandle);
      await browser.waitUntil(
        async () => !(await $(`${BAR} [data-testid="metrics-value-statusDuration"]`).isExisting()),
      );
      expect(await $(`${BAR} [data-testid="metrics-value-speed"]`).isDisplayed()).toBe(true);
      expect(await $(DETAILS).getText()).toContain("80%");
      await switchMetricsWindow(secondary.handle);
      await $('[data-testid="metrics-display-enabled"]').click();
      await switchMetricsWindow(primaryHandle);
      await browser.waitUntil(async () => !(await $(BAR).isExisting()));
      await switchMetricsWindow(secondary.handle);
      await $('[data-testid="metrics-display-enabled"]').click();
      await chooseFields([]);
      await switchMetricsWindow(primaryHandle);
      await browser.waitUntil(async () => !(await $(BAR).isExisting()));
      await switchMetricsWindow(secondary.handle);
      await $('[data-testid="metrics-display-reset"]').click();
      await switchMetricsWindow(primaryHandle);
      await $(BAR).waitForDisplayed();
      expect(await $(`${BAR} [data-testid="metrics-value-statusDuration"]`).isDisplayed()).toBe(
        true,
      );
      await switchMetricsWindow(secondary.handle);
      await chooseFields(["speed", "turnTokens"]);
    } finally {
      await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)?.destroy(),
        secondary.windowId,
      );
      await switchMetricsWindow(primaryHandle);
    }
    await reloadElectronSessionSafely(browser);
    await selectV4TaskById(pane.sessionId!);
    await $(BAR).waitForDisplayed();
    expect(await $(`${BAR} [data-testid="metrics-value-statusDuration"]`).isExisting()).toBe(false);
    expect(await $(`${BAR} [data-testid="metrics-value-speed"]`).isDisplayed()).toBe(true);
    if ((await $(`${BAR} button[aria-expanded]`).getAttribute("aria-expanded")) === "true")
      await $(`${BAR} button[aria-expanded]`).click();
    await setMetricsViewport(390);
    await browser.execute(() =>
      (
        window as unknown as { __testActions: { setLocale(value: string): void } }
      ).__testActions.setLocale("en-US"),
    );
    await browser.execute(() =>
      document.documentElement.style.setProperty("--ui-font-size", "20px"),
    );
    await browser.waitUntil(
      async () =>
        (await $(`${BAR} [data-testid="metrics-value-speed"]`).isDisplayed()) &&
        (await $(`${BAR} [data-testid="metrics-value-turnTokens"]`).isDisplayed()),
    );
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const bar = document.querySelector(
            '[data-testid="conversation-metrics-bar"]',
          ) as HTMLElement;
          const button = bar.querySelector("button[aria-expanded]")!;
          // 桌面侧栏在 resize idle 后自动收起；只校验栏内溢出会提前截到视口外的会话。
          const rect = bar.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth + 1 &&
            bar.scrollWidth <= bar.clientWidth + 1 &&
            button.getBoundingClientRect().right <= rect.right + 1
          );
        }),
      { timeout: 5000, timeoutMsg: "大字号下指标栏或更多入口溢出" },
    );
    await writeFile(
      join(artifact, "metrics-large-font-layout.json"),
      JSON.stringify(
        await browser.execute(() => {
          const bar = document.querySelector(
            '[data-testid="conversation-metrics-bar"]',
          ) as HTMLElement;
          return {
            viewport: innerWidth,
            dpr: devicePixelRatio,
            bar: bar.getBoundingClientRect().toJSON(),
            scrollWidth: bar.scrollWidth,
            button: bar.querySelector("button[aria-expanded]")!.getBoundingClientRect().toJSON(),
          };
        }),
        null,
        2,
      ),
    );
    await browser.saveScreenshot(join(artifact, "metrics-selected-390-large-font-full.png"));
    await $(BAR).saveScreenshot(join(artifact, "metrics-selected-390-large-font.png"));
    await browser.execute(() => document.documentElement.style.removeProperty("--ui-font-size"));
    await setMetricsViewport(1200);
    await openMetricsSettings();
    await chooseFields(FIELD_IDS);
    await setMetricsViewport(390);
    await $('[data-testid="metrics-display-settings"]').scrollIntoView();
    await $('[data-testid="metrics-display-settings"]').saveScreenshot(
      join(artifact, "metrics-settings-390.png"),
    );
    await setMetricsViewport(1200);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await $(BAR).waitForDisplayed();
    await $(`${BAR} button[aria-expanded]`).click();
    await $(DETAILS).waitForDisplayed();
    try {
      for (const width of [1200, 390]) {
        await setMetricsViewport(width);
        for (const locale of ["en-US", "zh-CN"])
          for (const theme of ["zai-light", "zai-dark"]) {
            await browser.execute(
              (locale, theme) => {
                const actions = (
                  window as unknown as Window & {
                    __testActions: {
                      setLocale(value: string): void;
                      setTheme(value: string): void;
                    };
                  }
                ).__testActions;
                actions.setLocale(locale);
                actions.setTheme(theme);
              },
              locale,
              theme,
            );
            await browser.waitUntil(() => browser.execute((width) => innerWidth === width, width));
            expect(
              await browser.execute(() => {
                const bar = document.querySelector('[data-testid="conversation-metrics-bar"]')!;
                return bar.scrollWidth <= bar.clientWidth + 1;
              }),
            ).toBe(true);
            await browser.saveScreenshot(
              join(artifact, `native-metrics-${width}-${locale}-${theme}.png`),
            );
            await $(`${BAR} button[aria-expanded]`).click();
            await $(`${BAR} [data-testid="metrics-summary-row"] > span`).moveTo();
            await browser.saveScreenshot(
              join(artifact, `native-metrics-collapsed-${width}-${locale}-${theme}.png`),
            );
            await $(BAR).saveScreenshot(
              join(artifact, `metrics-bar-${width}-${locale}-${theme}.png`),
            );
            await $(`${BAR} button[aria-expanded]`).click();
          }
      }
    } finally {
      await browser.electron.execute(async (electron) => {
        const window = electron.BrowserWindow.getAllWindows().find(
          (w) => !w.isDestroyed() && w.isVisible(),
        );
        if (window?.webContents.debugger.isAttached())
          await window.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
      });
    }
  });
});
