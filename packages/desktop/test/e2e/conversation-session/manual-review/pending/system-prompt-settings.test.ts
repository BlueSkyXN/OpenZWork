import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SystemPromptSettings } from "@zcode/shared";
import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForTestIdByDom,
  setCurrentElectronRendererContentSize,
} from "../../../helpers/desktop-app.js";

const marker = "E2E_SYSTEM_PROMPT_SETTINGS";
const artifactDir = resolve(
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/system-prompt-settings",
);
const settingsFile = join(getE2EAppDataPaths().appDataDir, "setting.json");
async function readSettings() {
  return JSON.parse(await readFile(settingsFile, "utf8")) as {
    memoryEnabled?: boolean;
    systemPromptSettings?: SystemPromptSettings;
  };
}
async function readDefaultRules() {
  // 默认原文改为折叠对照后，先按用户入口展开，再读取真实可见正文。
  const source = $('[data-testid="system-prompt-default-source"]');
  if ((await source.getAttribute("open")) === null) {
    await clickTestIdByDom("system-prompt-default-toggle");
  }
  return $('[data-testid="system-prompt-default"]').getText();
}
async function openSection(section: string) {
  if (!(await $('[data-testid="' + TID_SETTINGS_PAGE + '"]').isExisting())) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await waitForTestIdByDom(TID_SETTINGS_PAGE);
  }
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section));
}
async function chooseOption(trigger: string, labelPattern: string) {
  await clickTestIdByDom(trigger);
  await browser.waitUntil(async () => (await $$('[role="option"]').length) > 0);
  await browser.execute((pattern) => {
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => new RegExp(pattern).test(element.textContent ?? ""),
    );
    if (!option) throw new Error("prompt option missing: " + pattern);
    option.click();
  }, labelPattern);
}
describe(marker + ": 系统提示词设置", () => {
  it("SP14–SP15 动态情景不持久化，整体替换与逐章共用上下文开关", async function () {
    this.timeout(180_000);
    await mkdir(artifactDir, { recursive: true });
    await skipOccupationOnboardingIfPresent();
    await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 45_000 });
    await openSection("systemPrompt");
    await waitForTestIdByDom("system-prompt-editor", { timeout: 45_000 });
    await clickTestIdByDom("system-prompt-chapter-desktop_context");
    const rules = await readDefaultRules();
    expect(rules).not.toContain("This Desktop host supports Gen UI");
    expect(rules).not.toContain("/example/views");
    await chooseOption("system-prompt-chapter-mode", "替换本章规则|Replace section rules");
    expect(await $('[data-testid="system-prompt-chapter-content"]').getValue()).toBe(rules);
    await chooseOption("system-prompt-scenario", "可视化不可用|visualization unavailable");
    const preview = $('[data-testid="system-prompt-preview"]');
    expect(await preview.getText()).toContain("Gen UI is unavailable");
    expect(await preview.getText()).not.toContain("This Desktop host supports Gen UI");
    await browser.saveScreenshot(join(artifactDir, "dynamic-desktop-unavailable.png"));
    await chooseOption("system-prompt-scenario", "终端会话|Terminal session");
    expect(await preview.getText()).not.toContain(rules);
    await clickTestIdByDom("system-prompt-save");
    await browser.waitUntil(
      async () =>
        (await readSettings()).systemPromptSettings?.sections.desktop_context?.content === rules,
    );
    const persisted = (await readSettings()).systemPromptSettings!;
    expect(Object.keys(persisted).sort()).toEqual([
      "customSections",
      "mode",
      "replacement",
      "sections",
      "version",
    ]);
    expect(JSON.stringify(persisted)).not.toContain("/example/views");
    await openSection("memory");
    await openSection("systemPrompt");
    await clickTestIdByDom("system-prompt-chapter-desktop_context");
    expect(await $('[data-testid="system-prompt-chapter-content"]').getValue()).toBe(rules);
    expect(await preview.getText()).toContain("This Desktop host supports Gen UI");
    await clickTestIdByDom("system-prompt-mode-replace");
    await $('[data-testid="system-prompt-replacement"]').setValue(marker + "_DYNAMIC");
    await clickTestIdByDom("system-prompt-context-env_info");
    await clickTestIdByDom("system-prompt-save");
    await browser.waitUntil(
      async () =>
        (await readSettings()).systemPromptSettings?.sections.env_info?.mode === "disabled",
    );
    await browser.saveScreenshot(join(artifactDir, "dynamic-whole-replacement.png"));
    await clickTestIdByDom("system-prompt-mode-sections");
    await clickTestIdByDom("system-prompt-chapter-env_info");
    expect(await preview.getAttribute("data-preview-state")).toBe("excluded");
    await clickTestIdByDom("system-prompt-reset-chapter");
    await clickTestIdByDom("system-prompt-chapter-desktop_context");
    await clickTestIdByDom("system-prompt-reset-chapter");
    await clickTestIdByDom("system-prompt-save");
    await browser.waitUntil(
      async () => (await readSettings()).systemPromptSettings?.mode === "sections",
    );
    await clickTestIdByDom("system-prompt-chapter-role");
  });
  it("SP06 保存角色定制、重新打开回读并恢复默认；SP08 窄屏和主题", async function () {
    this.timeout(180_000);
    await mkdir(artifactDir, { recursive: true });
    await skipOccupationOnboardingIfPresent();
    // 全局提示词设置不依赖项目或模型；等待它自己的公开入口。
    try {
      await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
    } catch (error) {
      await browser.saveScreenshot(join(artifactDir, "startup-failure.png"));
      await writeFile(
        join(artifactDir, "startup-page.txt"),
        await browser.execute(() => document.body.innerText),
      );
      throw error;
    }
    await openSection("systemPrompt");
    await waitForTestIdByDom("system-prompt-editor", { timeout: 45_000 });
    const before = await readSettings();
    await clickTestIdByDom("system-prompt-mode-sections");
    await clickTestIdByDom("system-prompt-chapter-role");
    const defaultContent = await readDefaultRules();
    expect(defaultContent).toContain("interactive ZCode agent");
    await clickTestIdByDom("system-prompt-chapter-mode");
    await browser.waitUntil(async () => (await $$('[role="option"]').length) > 0);
    await browser.execute(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (element) => /替换本章|Replace section/.test(element.textContent ?? ""),
      );
      if (!target) throw new Error("replace option missing");
      target.click();
    });
    const input = $('[data-testid="system-prompt-chapter-content"]');
    await input.waitForExist();
    await input.setValue(marker + ": 用中文说明结论、依据和可执行动作。");
    expect(await $('[data-testid="system-prompt-preview"]').getText()).toContain(marker);
    await clickTestIdByDom("system-prompt-save");
    await browser.waitUntil(
      async () =>
        (await readSettings()).systemPromptSettings?.sections?.role?.content.includes(marker) ===
        true,
    );
    await openSection("memory");
    await openSection("systemPrompt");
    await waitForTestIdByDom("system-prompt-chapter-content");
    expect(await $('[data-testid="system-prompt-chapter-content"]').getValue()).toContain(marker);
    expect((await readSettings()).memoryEnabled).toBe(before.memoryEnabled);
    await browser.saveScreenshot(join(artifactDir, "prompt-settings-desktop.png"));

    await setCurrentElectronRendererContentSize(480, 900);
    await browser.saveScreenshot(join(artifactDir, "prompt-settings-narrow.png"));
    const overflow = await browser.execute(() => {
      const page = document.querySelector('[data-testid="system-prompt-editor"]');
      return page ? page.scrollWidth > page.clientWidth + 1 : true;
    });
    expect(overflow).toBe(false);
    await setCurrentElectronRendererContentSize(1400, 980);
    await browser.execute(() => {
      document.documentElement.classList.remove("theme-zai-light", "light");
      document.documentElement.classList.add("theme-zai-dark", "dark");
    });
    await browser.saveScreenshot(join(artifactDir, "prompt-settings-dark.png"));

    await clickTestIdByDom("system-prompt-reset-chapter");
    await clickTestIdByDom("system-prompt-save");
    await browser.waitUntil(
      async () => !(await readSettings()).systemPromptSettings?.sections?.role,
    );
    await writeFile(
      join(artifactDir, "prompt-settings-facts.json"),
      JSON.stringify(
        {
          case: marker,
          persisted: true,
          reopened: true,
          restored: true,
          memoryUnchanged: true,
          narrowOverflow: overflow,
          providerRequests: "none required",
        },
        null,
        2,
      ),
    );
  });
});
