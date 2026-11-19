import { mkdir, readFile, unlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { seedPersonalProviderConfig } from "#e2e/helpers/model-provider-restart-config";
import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  buildRemoteWorkspaceIdentity,
  type BindRemoteWorkspaceSessionContextIpcResult,
  type BindRemoteWorkspaceSessionContextRequest,
  type IPlatformService,
} from "@zcode/shared";
import { clickTestIdByDom, getE2EAppDataPaths, waitForTestIdByDom } from "#e2e/helpers/desktop-app";
import { skipOccupationOnboardingIfPresent } from "#e2e/helpers/occupation-onboarding";
import { obtainUnreadPairingUrl } from "#e2e/helpers/web-remote-unread";
import { openMobilePairingPage, seedMobileFixtureLogin } from "#e2e/helpers/mobile-pairing";

const tid = (name: string) => $('[data-testid="config-package-' + name + '"]');
async function openSettings() {
  if (!(await $('[data-testid="settings-page"]').isExisting()))
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 30000 });
  await waitForTestIdByDom(TID_SETTINGS_PAGE, { timeout: 30000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "dataSync"), { timeout: 30000 });
}
async function click(name: string) {
  const button = tid(name);
  await button.waitForDisplayed();
  await button.click();
}
async function resizeWindow(width: number) {
  await browser.electron.execute((electron, w) => {
    const win = electron.BrowserWindow.getAllWindows().find((window) => window.isVisible())!;
    win.setMinimumSize(320, 480);
    win.setSize(w, 800);
  }, width);
  await browser.waitUntil(() => browser.execute((w) => innerWidth === w, width), {
    timeout: 10000,
  });
}
async function capture(name: string) {
  const directory = process.env.ZCODE_E2E_ARTIFACT_DIR;
  if (!directory) throw new Error("missing E2E artifact directory");
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(join(directory, name + ".png"));
}
async function language(locale: string, theme: string) {
  await browser.execute(
    (l, t) => {
      const actions = (
        window as unknown as {
          __testActions: { setLocale: (l: string) => void; setTheme: (t: string) => void };
        }
      ).__testActions;
      actions.setLocale(l);
      actions.setTheme(t);
    },
    locale,
    theme,
  );
}
async function dialogFits() {
  return browser.execute(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="config-package-dialog"]');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.right <= innerWidth + 1 &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight + 1 &&
      el.scrollWidth <= el.clientWidth + 1
    );
  });
}

describe("E2E_T4_CONFIG_PACKAGE", () => {
  before(async () => {
    await skipOccupationOnboardingIfPresent();
    await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 60000 });
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
  });

  it("CP-12 在远端工作区打开设置，确认导出、选择覆盖和重启提示均操作本机", async function () {
    this.timeout(180000);
    const { homeDir, storageRoot } = getE2EAppDataPaths();
    const sourceUrl = process.env.ZCODE_E2E_T4_SOURCE_URL,
      remoteRoot = process.env.ZCODE_E2E_T4_SOURCE_HOME;
    if (!sourceUrl || !remoteRoot)
      throw new Error("T4 requires an isolated loopback Source Server");
    const remoteWorkspace = join(remoteRoot, "workspace");
    const target = {
      kind: "server" as const,
      url: sourceUrl,
      token: "t4-loopback-fixture",
      name: "T4 remote",
      serverId: "t4-remote",
      workspacePath: remoteWorkspace,
    };
    const identity = buildRemoteWorkspaceIdentity(remoteWorkspace, target);
    const live = await browser.execute(
      async ({ target, remoteWorkspace, identity }) => {
        const host = window as unknown as {
          zcode: Pick<IPlatformService, "connectRemote"> & {
            bindRemoteWorkspaceSessionContext(
              input: BindRemoteWorkspaceSessionContextRequest,
            ): Promise<BindRemoteWorkspaceSessionContextIpcResult>;
          };
          __zcodeTabStoreE2E: { getState(): { addTab(path: string, options: unknown): string } };
        };
        const conn = await host.zcode.connectRemote(target, "T4-connect", {
          workspacePath: remoteWorkspace,
          workspaceIdentity: identity,
        });
        if (!conn.sessionId || !conn.success)
          throw new Error(conn.reasonCode || conn.error || "remote connect failed");
        const response = await host.zcode.bindRemoteWorkspaceSessionContext({
          remoteSessionId: conn.sessionId,
          workspacePath: remoteWorkspace,
          workspaceIdentity: identity,
        });
        if (!response.success) throw new Error(response.reasonCode ?? response.error);
        const bound = response.result;
        host.__zcodeTabStoreE2E
          .getState()
          .addTab(remoteWorkspace, { ...bound, remoteTarget: target });
        return bound.workspaceIdentity;
      },
      { target, remoteWorkspace, identity },
    );
    expect(live).toBe(identity);
    await browser.waitUntil(
      () =>
        browser.execute((path) => {
          const state = (
            window as unknown as {
              __zcodeTabStoreE2E: { getState(): { activeWorkspacePath: string } };
            }
          ).__zcodeTabStoreE2E.getState();
          return state.activeWorkspacePath === path;
        }, remoteWorkspace),
      { timeout: 30000 },
    );
    const dir = join(storageRoot, "commands");
    await mkdir(dir, { recursive: true });
    const command = join(dir, "T4-local.md"),
      newCommand = join(dir, "T4-new.md"),
      saved = join(homeDir, "transfer.openzwork-config.gz");
    await writeFile(command, "source marker");
    await writeFile(newCommand, "new command marker");
    const remoteCommand = join(remoteRoot, ".openzwork", "commands", "T4-local.md");
    expect(await readFile(remoteCommand, "utf8")).toBe("remote marker");
    const save = await browser.electron.mock("dialog", "showSaveDialog"),
      open = await browser.electron.mock("dialog", "showOpenDialog");
    await language("zh-CN", "zai-light");
    await openSettings();
    await click("export");
    for (const category of [
      "providers",
      "skills",
      "systemPrompt",
      "subagents",
      "mcp",
      "hooks",
      "commands",
    ])
      expect(await tid("category-" + category).isSelected()).toBe(true);
    await click("next");
    for (const term of ["API Key", "环境变量", "请求头", "钩子"])
      expect(await tid("dialog").getText()).toContain(term);
    await resizeWindow(390);
    expect(await dialogFits()).toBe(true);
    await capture("T4-export-zh-390");
    await resizeWindow(1200);
    await save.mockResolvedValueOnce({ canceled: true, filePath: "" });
    await click("save");
    await tid("export").waitForEnabled();
    expect(await stat(saved).catch(() => null)).toBeNull();
    await click("export");
    for (const group of ["providers", "skills", "systemPrompt", "subagents", "mcp", "hooks"])
      await click("category-" + group);
    await click("next");
    await save.mockResolvedValueOnce({ canceled: false, filePath: saved });
    await click("save");
    await tid("exported").waitForDisplayed();
    expect(await tid("exported").getText()).toContain("2");
    const file = JSON.parse(gunzipSync(await readFile(saved)).toString());
    expect(file.sourceHomeDir).toBe(homeDir);
    expect(
      Buffer.from(
        file.categories.commands.payload.items.find((i: { key: string }) => i.key === "/t4-local")
          .content,
        "base64",
      ).toString(),
    ).toBe("source marker");
    await click("close");
    await writeFile(command, "changed marker");
    await unlink(newCommand);
    await open.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await click("import");
    await tid("import").waitForEnabled();
    expect(await readFile(command, "utf8")).toBe("changed marker");
    await expect(stat(newCommand)).rejects.toMatchObject({ code: "ENOENT" });
    await language("en-US", "zai-dark");
    await open.mockResolvedValueOnce({ canceled: false, filePaths: [saved] });
    await click("import");
    const difference = $('[data-testid="config-package-row"][data-key="/t4-local"]');
    await difference.waitForDisplayed();
    expect(await difference.getAttribute("data-status")).toBe("different");
    expect(await difference.$("input").isSelected()).toBe(false);
    const added = $('[data-testid="config-package-row"][data-key="/t4-new"]');
    expect(await added.getAttribute("data-status")).toBe("new");
    expect(await added.$("input").isSelected()).toBe(true);
    await resizeWindow(390);
    expect(await dialogFits()).toBe(true);
    expect(await tid("dialog").getText()).toContain("Different");
    await capture("T4-preview-en-390");
    await difference.$("input").click();
    await click("apply");
    await tid("imported").waitForDisplayed();
    expect(await tid("imported").getText()).toContain("Overwritten");
    expect(await tid("imported").getText()).toContain("Added");
    expect(await tid("dialog").getText()).toContain("Restart");
    expect(await dialogFits()).toBe(true);
    await capture("T4-result-en-390");
    expect(await readFile(command, "utf8")).toBe("source marker");
    expect(await readFile(newCommand, "utf8")).toBe("new command marker");
    expect(await readFile(remoteCommand, "utf8")).toBe("remote marker");
    await click("close");
    await resizeWindow(1200);
  });

  it("CP-12 单独采用默认模型并按匹配条件选择同事件钩子", async function () {
    this.timeout(120000);
    const { homeDir, storageRoot, configFile } = getE2EAppDataPaths();
    const repo = new NodePersonalProviderConfigRepository({
      filePath: configFile,
      pollingIntervalMs: false,
    });
    const originalProviders = await repo.read();
    const cliPath = join(storageRoot, "cli", "config.json");
    const originalCli = await readFile(cliPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const config = JSON.parse(originalCli ?? "{}");
    const pkg = join(homeDir, "model-hooks.openzwork-config.gz");
    const desired = { providerId: "personal:t4-review", modelId: "sample" };
    const localChoice = { ...desired, modelId: "local-choice" };
    const rules = ["Read", "Write"].map((matcher) => ({
      matcher,
      hooks: [{ type: "process", command: "t4-formatter", args: [matcher], enabled: false }],
    }));
    const save = await browser.electron.mock("dialog", "showSaveDialog");
    const open = await browser.electron.mock("dialog", "showOpenDialog");
    try {
      await seedPersonalProviderConfig(configFile, {
        id: desired.providerId,
        label: "T4 Review",
        apiFormat: "openai-responses",
        apiKey: "e2e-fixture",
        baseURL: "https://example.invalid/v1",
        models: [{ id: desired.modelId }, { id: localChoice.modelId }],
      });
      await repo.update((current) => ({ ...current, defaultModelSelection: desired }));
      await mkdir(join(storageRoot, "cli"), { recursive: true });
      await writeFile(
        cliPath,
        JSON.stringify({ ...config, hooks: { events: { PreToolUse: rules } } }),
      );
      await language("zh-CN", "zai-light");
      await openSettings();
      await click("export");
      for (const group of ["skills", "systemPrompt", "subagents", "mcp", "commands"])
        await click("category-" + group);
      await click("next");
      await save.mockResolvedValueOnce({ canceled: false, filePath: pkg });
      await click("save");
      await tid("exported").waitForDisplayed();
      await click("close");
      await repo.update((current) => ({ ...current, defaultModelSelection: undefined }));
      await writeFile(cliPath, JSON.stringify({ ...config, hooks: { events: {} } }));
      const choosePackage = async () => {
        await open.mockResolvedValueOnce({ canceled: false, filePaths: [pkg] });
        await click("import");
        await tid("row").waitForDisplayed();
      };
      const hookRow = (matcher: string) => $("label*=PreToolUse · " + matcher + " · t4-formatter");
      await choosePackage();
      await hookRow("Read").$("input").click();
      await hookRow("Write").$("input").click();
      expect(await tid("default-preview").getText()).toContain(
        desired.providerId + " / " + desired.modelId,
      );
      expect(await tid("apply").getText()).toBe("采用默认模型");
      await click("apply");
      await tid("imported").waitForDisplayed();
      expect(await tid("default-applied").getText()).toContain(
        desired.providerId + " / " + desired.modelId,
      );
      expect(await tid("imported").getText()).not.toContain("没有要新增或覆盖的条目");
      expect((await repo.read()).defaultModelSelection).toMatchObject(desired);
      await capture("T4-default-applied");
      await click("close");
      await choosePackage();
      await hookRow("Read").$("input").click();
      expect(await tid("default-preview").isExisting()).toBe(false);
      await click("apply");
      await tid("imported").waitForDisplayed();
      expect(await tid("imported").getText()).toContain("PreToolUse · Write · t4-formatter");
      expect(JSON.parse(await readFile(cliPath, "utf8")).hooks.events.PreToolUse).toEqual([
        rules[1],
      ]);
      await click("close");
      await repo.update((current) => ({ ...current, defaultModelSelection: undefined }));
      await choosePackage();
      await hookRow("Read").$("input").click();
      await tid("default-preview").waitForDisplayed();
      await repo.update((current) => ({ ...current, defaultModelSelection: localChoice }));
      await click("apply");
      await tid("imported").waitForDisplayed();
      expect(await tid("imported").getText()).toContain("未采用包中的默认模型");
      expect(await tid("imported").getText()).not.toContain("没有要新增或覆盖的条目");
      expect(await tid("default-applied").isExisting()).toBe(false);
      expect((await repo.read()).defaultModelSelection).toMatchObject(localChoice);
      await click("close");
    } finally {
      await repo.update(() => originalProviders);
      repo.dispose();
      if (originalCli !== undefined) await writeFile(cliPath, originalCli);
      else
        await unlink(cliPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
  });

  it("CP-11 已配对的手机 Web 界面没有桌面配置包入口", async function () {
    this.timeout(120000);
    const origin = process.env.ZCODE_E2E_T4_WEB_ORIGIN,
      artifactDir = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (!origin || !artifactDir)
      throw new Error("T4 requires a loopback Web frontend and artifact directory");
    const pairing = await obtainUnreadPairingUrl(origin);
    const chrome = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await chrome.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await seedMobileFixtureLogin(context);
      const page = await context.newPage();
      await openMobilePairingPage(page, pairing, {
        artifactDir,
        caseMarker: "T4",
        phase: "mobile",
        readySelector: '[data-mobile-page="home"]',
      });
      expect(await page.locator('[data-mobile-page="home"]').first().isVisible()).toBe(true);
      const settings = page.locator('[data-testid="' + TID_TASK_SETTINGS_BUTTON + '"]');
      await settings.click();
      await page.locator('[data-testid="' + TID_SETTINGS_PAGE + '"]').waitFor();
      expect(
        await page
          .locator(
            '[data-testid="config-package-export"], [data-testid="config-package-import"], [data-testid="' +
              testId(TID_SETTINGS_SECTION_NAV, "dataSync") +
              '"]',
          )
          .count(),
      ).toBe(0);
      await page.screenshot({ path: join(artifactDir, "T4-mobile.png") });
    } finally {
      await chrome.close();
    }
  });
});
