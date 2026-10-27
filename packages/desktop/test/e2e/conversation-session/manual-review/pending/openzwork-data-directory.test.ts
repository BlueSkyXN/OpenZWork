import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_SETTINGS_DATA_BASE_DIR_BROWSE,
  TID_SETTINGS_DATA_BASE_DIR_INPUT,
  TID_SETTINGS_DATA_BASE_DIR_SAVE,
  TID_SETTINGS_DATA_BASE_DIR_STATUS,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  readSettings,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../../../helpers/e2e-runtime-paths.js";
import { reloadElectronSessionPreservingBrowserProfile } from "../../../helpers/e2e-electron-reload.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";

const CASE_MARKER = "E2E_OPENZWORK_DATA_DIRECTORY";
const paths = getE2EAppDataPaths();
const target = resolveE2ERuntimePath("openzwork-data-directory", "target");
const canary = "openzwork-directory-canary.txt";

// CDD01/03：不发模型请求；SQLite 内容与旧根不变由 dataDirectoryMigration.test.ts 验证。
describe(CASE_MARKER, () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    // 目标也在隔离 HOME 内，由 runner 停止进程后统一删除，避免 Windows 仍占用数据库。
  });

  it("saves a plan and transfers writes made after saving during the next full startup", async function () {
    this.timeout(180_000);
    await skipOccupationOnboardingIfPresent();
    await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 30_000 });
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const before = await readSettings();
    await writeFile(join(paths.appDataDir, canary), "before-save");
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
    await waitForTestIdByDom(TID_SETTINGS_PAGE, { timeout: 15_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), { timeout: 15_000 });
    const picker = await browser.electron.mock("dialog", "showOpenDialog");
    await picker.mockResolvedValueOnce({ canceled: false, filePaths: [target] });
    await clickTestIdByDom(TID_SETTINGS_DATA_BASE_DIR_BROWSE, { timeout: 15_000 });
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_SETTINGS_DATA_BASE_DIR_INPUT}"]`).getValue()) === target,
      { timeout: 15_000 },
    );
    const oldPid = await browser.electron.execute(() => process.pid);
    await clickTestIdByDom(TID_SETTINGS_DATA_BASE_DIR_SAVE, { timeout: 15_000 });
    await browser.waitUntil(
      async () =>
        (await $(`[data-testid="${TID_SETTINGS_DATA_BASE_DIR_STATUS}"]`).getAttribute(
          "data-state",
        )) === "saved",
      { timeout: 30_000 },
    );
    const pending = await readSettings();
    expect(pending.dataBaseDir).toBe(before.dataBaseDir);
    expect(pending.pendingDataBaseDirMigration?.targetBaseDir).toBe(target);
    await expect(stat(join(target, ".openzwork"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(paths.appDataDir, canary), "after-save");
    await mkdir(join(paths.storageRoot, "security"), { recursive: true });
    await writeFile(join(paths.storageRoot, "security", canary), CASE_MARKER);
    await browser.electron.restoreAllMocks();
    await reloadElectronSessionPreservingBrowserProfile(browser);
    await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 60_000 });
    expect(await browser.electron.execute(() => process.pid)).not.toBe(oldPid);
    const completed = await readSettings();
    expect(completed.dataBaseDir).toBe(target);
    expect(completed.pendingDataBaseDirMigration).toBeUndefined();
    expect(await readFile(join(target, ".openzwork/v2", canary), "utf8")).toBe("after-save");
    expect(await readFile(join(paths.appDataDir, canary), "utf8")).toBe("after-save");
    expect(await readFile(join(target, ".openzwork/security", canary), "utf8")).toBe(CASE_MARKER);
    expect((await stat(join(target, ".openzwork/v2/tasks-index.sqlite"))).isFile()).toBe(true);
    expect((await stat(join(target, ".openzwork/cli/db/db.sqlite"))).isFile()).toBe(true);
  });
});
