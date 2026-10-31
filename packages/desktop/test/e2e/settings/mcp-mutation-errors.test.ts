import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_MCP_SERVER_ROW,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_LOCALE_SELECT_TRIGGER,
  TID_SETTINGS_LOCALE_SELECT_ITEM,
  testId,
} from "@zcode/shared/test-ids";
import { clearAppData, clickTestIdByDom, getE2EAppDataPaths } from "#e2e/helpers/desktop-app";
import { skipOccupationOnboardingIfPresent } from "#e2e/helpers/occupation-onboarding";

// MCP-WR-06 / OW-P005：只将隔离 E2E HOME 的 CLI 目录设为只读，真实持久化错误经 UI 返回。
// 目标切换代次由受控 store/刷新函数回归验证；本例不依赖真实 SSH 或模型。
const name = "e2e-mcp-write-failure";
const frame = "[data-settings-content-frame]";
const cliDir = join(getE2EAppDataPaths().storageRoot, "cli");
const configFile = join(cliDir, "config.json");
let originalMode: number | undefined;

async function label(text: string, scope = frame) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (value, selector) => {
          const button = Array.from(document.querySelectorAll<HTMLElement>(selector))
            .flatMap((root) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")))
            .find((item) => item.textContent?.trim() === value && !item.disabled);
          button?.click();
          return Boolean(button);
        },
        text,
        scope,
      ),
    { timeout: 15_000, timeoutMsg: `没有找到按钮：${text}` },
  );
}

async function waitForError() {
  await browser.waitUntil(
    async () => {
      const host = await $("#zcode-toast-host");
      return (
        (await host.isExisting()) && /EACCES|EPERM|permission|不可写/iu.test(await host.getText())
      );
    },
    { timeout: 15_000, timeoutMsg: "MCP 写入失败未显示错误" },
  );
}

async function waitForPreviousErrorToClose() {
  await browser.waitUntil(
    async () => {
      const host = await $("#zcode-toast-host");
      return !(await host.isExisting()) || !(await host.getText()).trim();
    },
    { timeout: 15_000 },
  );
}

async function lockConfig() {
  await waitForPreviousErrorToClose();
  await chmod(cliDir, 0o500);
  return readFile(configFile, "utf8");
}

async function unlockConfig() {
  if (originalMode !== undefined) await chmod(cliDir, originalMode);
}

describe("MCP-WR-06：MCP 写入错误保留界面和磁盘状态", () => {
  after(async () => {
    await unlockConfig();
    await clearAppData();
  });

  it("新增、修改、开关与删除失败均提示错误，恢复写权限后可保存和删除", async function () {
    this.timeout(180_000);
    if (process.platform === "win32" || process.getuid?.() === 0) this.skip();
    await skipOccupationOnboardingIfPresent();
    await mkdir(cliDir, { recursive: true });
    await writeFile(configFile, "{}\n", { flag: "wx", mode: 0o600 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    originalMode = (await stat(cliDir)).mode & 0o777;
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 30_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
    await clickTestIdByDom(TID_SETTINGS_LOCALE_SELECT_TRIGGER);
    await clickTestIdByDom(testId(TID_SETTINGS_LOCALE_SELECT_ITEM, "zh-CN"));
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "mcp"));
    await label("新建 MCP 服务器");
    const nameInput = await $('input[placeholder="my-mcp-server"]');
    const commandInput = await $('input[placeholder="npx"]');
    await nameInput.setValue(name);
    await commandInput.setValue("__openzwork_e2e_missing_mcp__");

    const beforeAdd = await lockConfig();
    await label("保存");
    await waitForError();
    expect(await nameInput.getValue()).toBe(name);
    expect(await readFile(configFile, "utf8")).toBe(beforeAdd);
    await browser.saveScreenshot(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "mcp-save-error.png"));
    await unlockConfig();
    await label("保存");
    const rowSelector = `[data-testid="${testId(TID_MCP_SERVER_ROW, name)}"]`;
    await $(rowSelector).waitForDisplayed({ timeout: 15_000 });
    expect(await readFile(configFile, "utf8")).toContain(name);

    const beforeToggle = await lockConfig();
    const toggle = await $(`${rowSelector} [role="switch"]`);
    const checked = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await waitForError();
    expect(await toggle.getAttribute("aria-checked")).toBe(checked);
    expect(await readFile(configFile, "utf8")).toBe(beforeToggle);
    await unlockConfig();

    await $(rowSelector).click();
    await $('input[placeholder="npx"]').setValue("__openzwork_e2e_changed_mcp__");
    const beforeEdit = await lockConfig();
    await label("保存");
    await waitForError();
    expect(await $('input[placeholder="npx"]').getValue()).toBe("__openzwork_e2e_changed_mcp__");
    expect(await readFile(configFile, "utf8")).toBe(beforeEdit);

    await waitForPreviousErrorToClose();
    await label("删除");
    await label("确认删除", '[role="alertdialog"], [role="dialog"]');
    await waitForError();
    expect(await $('input[placeholder="my-mcp-server"]').getValue()).toBe(name);
    expect(await readFile(configFile, "utf8")).toBe(beforeEdit);
    await unlockConfig();

    await label("删除");
    await label("确认删除", '[role="alertdialog"], [role="dialog"]');
    await browser.waitUntil(async () => !(await readFile(configFile, "utf8")).includes(name), {
      timeout: 15_000,
    });
    expect(await $(rowSelector).isExisting()).toBe(false);
  });
});
