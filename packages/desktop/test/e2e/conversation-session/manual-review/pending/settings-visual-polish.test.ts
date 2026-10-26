import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IPlatformService } from "@zcode/shared";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  clickTestIdByDom,
  setCurrentElectronRendererContentSize,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";

const marker = "E2E_SETTINGS_VISUAL_POLISH";
const artifacts = resolve(
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/settings-visual-polish",
);
const selector = (id: string) => '[data-testid="' + id + '"]';

async function openSection(section: string) {
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section));
  const sectionIds: Record<string, string> = {
    appearance: "metrics-display-settings",
    systemPrompt: "system-prompt-editor",
    remoteControl: "remote-control-settings",
  };
  const sectionId = sectionIds[section];
  if (sectionId) await waitForTestIdByDom(sectionId, { timeout: 45_000 });
}

async function chooseOption(trigger: string, pattern: string) {
  await clickTestIdByDom(trigger);
  await browser.waitUntil(async () => (await $$('[role="option"]').length) > 0);
  await browser.execute((pattern) => {
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => new RegExp(pattern).test(element.textContent ?? ""),
    );
    if (!option) throw new Error("Settings option missing: " + pattern);
    option.click();
  }, pattern);
}

async function remoteStatus() {
  return browser.execute(
    async () =>
      (await (window as unknown as { zcode: IPlatformService }).zcode.getWebRemoteControlStatus())
        .status,
  );
}

async function appearance(locale: string, theme: string) {
  await browser.execute(
    (locale, theme) => {
      const actions = (
        window as unknown as {
          __testActions: { setLocale(value: string): void; setTheme(value: string): void };
        }
      ).__testActions;
      actions.setLocale(locale);
      actions.setTheme(theme);
    },
    locale,
    theme,
  );
  await browser.waitUntil(() =>
    browser.execute(
      (theme) => document.documentElement.classList.contains("theme-" + theme),
      theme,
    ),
  );
}

async function setViewport(width: number) {
  const targetUrl = await browser.getUrl();
  await browser.electron.execute(async (electron, targetUrl) => {
    const window = electron.BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
    );
    if (!window) throw new Error("Current renderer window missing");
    if (window.webContents.debugger.isAttached()) {
      await window.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
    }
  }, targetUrl);
  // 原生窗口有 480px 下限；390px 只模拟 renderer viewport，不修改产品窗口限制。
  await setCurrentElectronRendererContentSize(Math.max(480, width), 800);
  if (width < 480) {
    await browser.electron.execute(
      async (electron, targetUrl, width) => {
        const window = electron.BrowserWindow.getAllWindows().find(
          (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
        );
        if (!window) throw new Error("Current renderer window missing");
        if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
        await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        });
      },
      targetUrl,
      width,
    );
  }
  await browser.waitUntil(() => browser.execute((width) => innerWidth === width, width));
}

describe(marker, () => {
  it("SVP01–03/05–06 原有设置风格、首页导航和窄屏交互", async function () {
    this.timeout(240_000);
    await mkdir(artifacts, { recursive: true });
    await skipOccupationOnboardingIfPresent();
    await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 60_000 });
    if (await $(selector(TID_SETTINGS_PAGE)).isExisting()) {
      await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    }
    await setViewport(1400);
    await appearance("zh-CN", "zai-light");
    await waitForTestIdByDom("sidebar-remote-control-button");
    const statusBefore = await remoteStatus();
    await browser.saveScreenshot(join(artifacts, "workspace-shortcut.png"));
    await clickTestIdByDom("sidebar-remote-control-button");
    await waitForTestIdByDom("remote-control-settings");
    expect(await remoteStatus()).toBe(statusBefore);
    // 工作区在设置层下保持挂载以保留草稿；检查设置页没有副本，后台入口不可交互。
    expect(
      await $(
        selector(TID_SETTINGS_PAGE) + " " + selector("sidebar-remote-control-button"),
      ).isExisting(),
    ).toBe(false);
    expect(await $(selector("sidebar-remote-control-button")).isClickable()).toBe(false);
    expect(await $(selector("web-remote-start")).isExisting()).toBe(true);
    for (const provider of ["weixin", "feishu", "lark", "telegram"]) {
      expect(await $(selector("web-remote-bot-" + provider)).isDisplayed()).toBe(true);
    }
    await clickTestIdByDom("web-remote-mode-self-hosted");
    expect(await $(selector("web-remote-relay-url")).isDisplayed()).toBe(true);
    await clickTestIdByDom("web-remote-mode-direct");

    await openSection("appearance");
    await clickTestIdByDom("metrics-display-reset");
    const toolField = $(selector("metrics-display-field-toolCalls"));
    expect(await toolField.getAttribute("aria-checked")).toBe("false");
    await toolField.click();
    expect(await toolField.getAttribute("aria-checked")).toBe("true");
    expect(await $(selector("metrics-display-preview")).getText()).toContain("工具");
    await clickTestIdByDom("metrics-display-enabled");
    expect(
      await $(
        selector("metrics-display-preview") + " " + selector("metrics-value-speed"),
      ).isExisting(),
    ).toBe(false);
    await clickTestIdByDom("metrics-display-reset");

    await openSection("systemPrompt");
    await clickTestIdByDom("system-prompt-chapter-role");
    const original = $(selector("system-prompt-default-source"));
    expect(await original.getAttribute("open")).toBeNull();
    expect(await $(selector("system-prompt-preview")).getText()).toContain(
      "interactive ZCode agent",
    );
    await clickTestIdByDom("system-prompt-default-toggle");
    expect(await $(selector("system-prompt-default")).getText()).toContain(
      "interactive ZCode agent",
    );
    await chooseOption("system-prompt-chapter-mode", "追加|Append");
    await $(selector("system-prompt-chapter-content")).setValue(marker + "_DRAFT");
    expect(await $(selector("system-prompt-preview")).getText()).toContain(marker);
    await setViewport(390);
    await $(selector("system-prompt-chapter-select")).waitForDisplayed();
    await chooseOption("system-prompt-chapter-select", "安全|Security");
    await chooseOption("system-prompt-chapter-select", "角色|Role");
    expect(await $(selector("system-prompt-chapter-content")).getValue()).toBe(marker + "_DRAFT");
    expect(await original.getAttribute("open")).toBeNull();
    await browser.execute(() => {
      const cancel = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-testid="system-prompt-editor"] button'),
      ).find((button) => /取消修改|Discard/.test(button.textContent ?? ""));
      if (!cancel) throw new Error("Prompt discard action missing");
      cancel.click();
    });
    expect(await $(selector("system-prompt-chapter-content")).isExisting()).toBe(false);

    const facts: Array<{
      width: number;
      locale: string;
      theme: string;
      section: string;
      overflow: boolean;
    }> = [];
    try {
      for (const width of [1400, 390]) {
        await setViewport(width);
        for (const locale of ["zh-CN", "en-US"]) {
          for (const theme of ["zai-light", "zai-dark"]) {
            await appearance(locale, theme);
            for (const section of ["appearance", "systemPrompt", "remoteControl", "usage"]) {
              await openSection(section);
              const overflow = await browser.execute((id) => {
                const page = document.querySelector<HTMLElement>('[data-testid="' + id + '"]');
                return !page || page.scrollWidth > page.clientWidth + 1;
              }, TID_SETTINGS_PAGE);
              expect(overflow).toBe(false);
              if (section === "systemPrompt" && width >= 768) {
                const chapterLayout = await browser.execute(() => {
                  const nav = document.querySelector<HTMLElement>(
                    '[data-testid="system-prompt-chapter-list"]',
                  )!;
                  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"));
                  return {
                    overflow: nav.scrollWidth > nav.clientWidth + 1,
                    overlap: buttons.some((button, index) => {
                      const next = buttons[index + 1];
                      return (
                        next &&
                        button.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 1
                      );
                    }),
                    clippedText: buttons.some(
                      (button) => button.scrollHeight > button.clientHeight + 1,
                    ),
                  };
                });
                expect(chapterLayout).toEqual({
                  overflow: false,
                  overlap: false,
                  clippedText: false,
                });
              }
              facts.push({ width, locale, theme, section, overflow });
              await browser.saveScreenshot(
                join(artifacts, [section, width, locale, theme].join("-") + ".png"),
              );
            }
          }
        }
      }
      await browser.execute(() =>
        document.documentElement.style.setProperty("--ui-font-size", "18px"),
      );
      await openSection("systemPrompt");
      expect(await $(selector("system-prompt-chapter-select")).isDisplayed()).toBe(true);
      const largeFontLayout = await browser.execute(() => {
        const editor = document.querySelector<HTMLElement>('[data-testid="system-prompt-editor"]')!;
        const bounds = editor.getBoundingClientRect();
        return {
          overflow: editor.scrollWidth > editor.clientWidth + 1,
          modesVisible: Array.from(
            editor.querySelectorAll<HTMLButtonElement>('[data-testid^="system-prompt-mode-"]'),
          ).every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          }),
        };
      });
      expect(largeFontLayout).toEqual({ overflow: false, modesVisible: true });
      await browser.saveScreenshot(join(artifacts, "prompt-390-large-font.png"));
      expect(await remoteStatus()).toBe(statusBefore);
      await writeFile(
        join(artifacts, "settings-layout-facts.json"),
        JSON.stringify(
          {
            marker,
            shortcutNavigated: true,
            connectionUnchanged: true,
            draftPreserved: true,
            providerRequests: "none required",
            largeFontLayout,
            layouts: facts,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.execute(() => document.documentElement.style.removeProperty("--ui-font-size"));
      await setViewport(1400);
      await appearance("zh-CN", "zai-light");
      await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
      await waitForTestIdByDom("sidebar-remote-control-button");
    }
  });
});
