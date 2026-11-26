import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setRendererViewport, clearRendererViewport } from "#e2e/helpers/renderer-viewport";
import { clearAppData, getE2EAppDataPaths, setInputValueByTestIdDom } from "#e2e/helpers/desktop-app";
import { resolveE2EToolPath } from "#e2e/helpers/e2e-runtime-paths";
import {
  getV4ComposerText,
  isV4ComposerFocused,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import {
  PLUGIN_LIFECYCLE_ID,
  PLUGIN_LIFECYCLE_MARKETPLACE_ID,
  addLifecycleMarketplaceThroughUi,
  addMarketplaceSourceThroughUi,
  assertPluginStoreFitsViewport,
  capturePluginManualReview,
  clickPluginControl,
  createInvalidOfficialCollisionFixture,
  createPluginLifecycleFixture,
  getPluginControlText,
  getPluginOverview,
  hasPluginControl,
  installPluginThroughUi,
  openPluginManagementSettings,
  openPluginSettings,
  openSourcesDialog,
  requirePluginManualReview,
  setPluginPresentation,
  waitForPluginControl,
  waitUntilPluginOverview,
} from "#e2e/helpers/plugin-management-lifecycle";

describe("PLM-LC-018/019/020 本地化与插件创建入口", () => {
  after(async () => {
    await clearRendererViewport();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  it("两处添加菜单分别创建真实 skill 草稿并保留来源添加与中文管理搜索", async function () {
    this.timeout(300000);
    requirePluginManualReview();
    const fixture = await createPluginLifecycleFixture();
    await openPluginSettings();
    await setPluginPresentation({ locale: "zh-CN", theme: "zai-light", width: 1440, height: 800 });
    await setRendererViewport(1440, 1000);
    await addLifecycleMarketplaceThroughUi(fixture);
    const countMarketCards = () =>
      browser.execute(
        (marketplace) =>
          [...document.querySelectorAll<HTMLElement>('[data-testid="plugin-store-card"]')].filter(
            (card) => card.dataset.pluginId?.endsWith(`@${marketplace}`),
          ).length,
        PLUGIN_LIFECYCLE_MARKETPLACE_ID,
      );
    expect(await countMarketCards()).toBe(8);
    await capturePluginManualReview("PLM-LC-001", "all-plugins-expanded");
    const groupKey = `marketplace:${PLUGIN_LIFECYCLE_MARKETPLACE_ID}`;
    await clickPluginControl("plugin-store-group-toggle", { groupKey });
    expect(await countMarketCards()).toBe(6);
    await clickPluginControl("plugin-store-group-toggle", { groupKey });
    expect(await countMarketCards()).toBe(8);
    await installPluginThroughUi(PLUGIN_LIFECYCLE_ID);
    for (const query of ["shengmingzhouqi", "SMZQ"]) {
      await setInputValueByTestIdDom("plugin-store-search", query);
      await waitForPluginControl("plugin-store-card", { pluginId: PLUGIN_LIFECYCLE_ID });
    }
    await setInputValueByTestIdDom("plugin-store-search", "");
    await openAddMenu("plugin-store-create");
    expect(await getPluginControlText("plugin-add-menu")).toContain("创建插件");
    expect(await getPluginControlText("plugin-add-menu")).not.toContain("录制");
    await clickPluginControl("plugin-create-menu-item");
    await expectCreatorDraft();
    await capturePluginManualReview("PLM-LC-019", "store-creator-draft");
    await openPluginManagementSettings();
    await clickPluginControl("settings-back-button");
    await expectCreatorDraft(false);
    await openPluginManagementSettings();
    await waitForPluginControl("plugin-settings-plugin-row", { pluginId: PLUGIN_LIFECYCLE_ID });
    expect(
      await getPluginControlText("plugin-settings-plugin-row", { pluginId: PLUGIN_LIFECYCLE_ID }),
    ).toContain("生命周期测试插件");
    for (const query of ["生命周期测试插件", "shengmingzhouqi", "smzq"]) {
      await setInputValueByTestIdDom("plugin-settings-search", query);
      await waitForPluginControl("plugin-settings-plugin-row", { pluginId: PLUGIN_LIFECYCLE_ID });
    }
    await setInputValueByTestIdDom("plugin-settings-search", "");
    await openAddMenu("plugin-settings-add");
    await clickPluginControl("plugin-create-menu-item");
    await expectCreatorDraft();
    await openPluginManagementSettings();
    await openAddMenu("plugin-settings-add");
    await clickPluginControl("plugin-store-add-source-menu-item");
    await waitForPluginControl("plugin-store-add-source-dialog");
    expect(
      await browser.execute(() => document.querySelector('[data-testid="settings-page"]') === null),
    ).toBe(true);
    const invalidSource = resolveE2EToolPath("plugin-creator", "missingmarketplace".repeat(8));
    await setInputValueByTestIdDom("plugin-store-add-source-input", invalidSource);
    await clickPluginControl("plugin-store-add-source-risk-acknowledgement");
    await clickPluginControl("plugin-store-add-source-submit");
    await waitForPluginControl("plugin-store-add-source-error");
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLInputElement>('[data-testid="plugin-store-add-source-input"]')
            ?.value,
      ),
    ).toBe(invalidSource);
    await browser.keys("Escape");
    await clearRendererViewport();
    await setPluginPresentation({ locale: "en-US", theme: "zai-dark", width: 480, height: 800 });
    await setRendererViewport(390, 844);
    // 添加来源失败后仍停留在默认公开分段；本地 fixture 属于个人来源，搜索只覆盖当前分段。
    await clickPluginControl("plugin-store-segment-personal");
    await setInputValueByTestIdDom("plugin-store-search", "smzq");
    await waitForPluginControl("plugin-store-card", { pluginId: PLUGIN_LIFECYCLE_ID });
    await openAddMenu("plugin-store-create");
    const text = await getPluginControlText("plugin-add-menu");
    expect(text).toContain("Create plugin");
    expect(text).toContain("Add plugin marketplace");
    await capturePluginManualReview("PLM-LC-020", "en-dark-narrow-add-menu");
    await assertPluginStoreFitsViewport();
    await browser.keys("Escape");
    for (const presentation of [
      { locale: "zh-CN" as const, theme: "zai-light" as const, width: 390 },
      { locale: "en-US" as const, theme: "zai-dark" as const, width: 1280 },
      { locale: "zh-CN" as const, theme: "zai-light" as const, width: 1280 },
    ]) {
      await clearRendererViewport();
      await setPluginPresentation({
        ...presentation,
        width: Math.max(480, presentation.width),
        height: 844,
      });
      await setRendererViewport(presentation.width, 844);
      // 长路径必须完整保留并换行，不能用截断或隐藏溢出来通过窄屏验收。
      expect(await getPluginControlText("plugin-store-error")).toContain(invalidSource);
      await assertPluginStoreFitsViewport();
      await capturePluginManualReview(
        "PLM-LC-020",
        `${presentation.locale}-${presentation.theme}-${presentation.width}-error`,
      );
    }
  });

  it("插件市场 #79：添加菜单、默认来源和保留名称提示", async function () {
    this.timeout(120000);
    requirePluginManualReview();
    const collision = await createInvalidOfficialCollisionFixture();
    // 其他用例复用生命周期市场。用独立市场 ID 验证这次重试确实新增了来源。
    const regularMarketId = "e2e-marketplace-79";
    const englishReservedNameHint =
      "This source uses a marketplace name reserved by OpenZWork. Add another compatible marketplace source.";
    const regularSource = join(dirname(collision), "marketplace-79-regular.json");
    await writeFile(regularSource, JSON.stringify({ name: regularMarketId, plugins: [] }));

    await openPluginSettings();
    await setPluginPresentation({ locale: "zh-CN", theme: "zai-light", width: 1200, height: 800 });
    expect(await getPluginControlText("plugin-store-create")).toBe("添加");
    // OpenZWork(OZ-C014)：随包目录提供中文名称和说明，即使其 ID 不在可刷新来源中。
    const sheet = { pluginId: "spreadsheets@zcode-plugins-official" };
    await clickPluginControl("plugin-store-segment-public");
    await setInputValueByTestIdDom("plugin-store-search", "电子表格");
    await waitForPluginControl("plugin-store-card", sheet);
    expect(await getPluginControlText("plugin-store-card", sheet)).toContain("电子表格");
    await clickPluginControl("plugin-store-card", sheet);
    await waitForPluginControl("plugin-store-detail", sheet);
    expect(await getPluginControlText("plugin-store-description")).toContain("创建、编辑与审阅电子表格");
    await clickPluginControl("plugin-store-detail-back");
    await setInputValueByTestIdDom("plugin-store-search", "");
    await openSourcesDialog();
    await waitForPluginControl("plugin-store-source-row", { marketplaceId: "claude-plugins-official" });
    const before = await getPluginOverview();
    expect(before.marketplaces.some(({ id }) => id === regularMarketId)).toBe(false);
    await browser.keys("Escape");

    await openPluginManagementSettings();
    await waitForPluginControl("plugin-settings-add");
    expect(await getPluginControlText("plugin-settings-add")).toBe("添加");
    await openAddMenu("plugin-settings-add");
    await clickPluginControl("plugin-store-add-source-menu-item");
    await waitForPluginControl("plugin-store-add-source-dialog");
    await setInputValueByTestIdDom("plugin-store-add-source-input", collision);
    await clickPluginControl("plugin-store-add-source-risk-acknowledgement");
    await clickPluginControl("plugin-store-add-source-submit");
    await waitForPluginControl("plugin-store-add-source-error");
    expect(await getPluginControlText("plugin-store-add-source-error")).toBe(
      "此来源使用了 OpenZWork 内置市场的保留名称。请添加其他兼容的市场源。",
    );
    expect((await getPluginOverview()).marketplaces).toEqual(before.marketplaces);
    await capturePluginManualReview("PLUGIN-MARKETPLACE-79", "zh-light-reserved-name");

    // OpenZWork(OZ-C014): 模拟跨窗口语言更新，当前弹窗保留输入并刷新提示。
    await setPluginPresentation({ locale: "en-US", theme: "zai-dark", width: 480, height: 800 });
    expect(await getPluginControlText("plugin-store-add-source-dialog")).toContain("Add marketplace");
    expect(await getPluginControlText("plugin-store-add-source-error")).toBe(englishReservedNameHint);
    expect(
      await browser.$('[data-testid="plugin-store-add-source-input"]').getValue(),
    ).toBe(collision);
    await capturePluginManualReview("PLUGIN-MARKETPLACE-79", "reserved-name-after-locale-change");
    await browser.keys("Escape");
    expect(await getPluginControlText("plugin-store-error")).toBe(englishReservedNameHint);

    await setRendererViewport(390, 844);
    expect(await getPluginControlText("plugin-store-create")).toBe("Add");
    await addMarketplaceSourceThroughUi(collision);
    await waitForPluginControl("plugin-store-add-source-error");
    expect(await getPluginControlText("plugin-store-add-source-error")).toBe(englishReservedNameHint);
    expect(
      await browser.$('[data-testid="plugin-store-add-source-input"]').getValue(),
    ).toBe(collision);
    await capturePluginManualReview("PLUGIN-MARKETPLACE-79", "en-dark-narrow-reserved-name");

    const missingSource = join(dirname(collision), "marketplace-79-missing.json");
    await setInputValueByTestIdDom("plugin-store-add-source-input", missingSource);
    await clickPluginControl("plugin-store-add-source-submit");
    await browser.waitUntil(
      async () => (await getPluginControlText("plugin-store-add-source-error")).includes(missingSource),
      { timeout: 15000, timeoutMsg: "普通来源错误没有显示原始消息" },
    );

    await setInputValueByTestIdDom("plugin-store-add-source-input", regularSource);
    await clickPluginControl("plugin-store-add-source-submit");
    await waitUntilPluginOverview(
      (overview) => overview.marketplaces.some(({ id }) => id === regularMarketId),
      "更换来源后未能添加普通市场",
    );
    await browser.waitUntil(async () => !(await hasPluginControl("plugin-store-add-source-dialog")));
    expect(await hasPluginControl("plugin-store-error")).toBe(false);
    await clearRendererViewport();
  });

  it("非官方市场必须确认风险才能添加，关闭后重新确认", async function () {
    this.timeout(120000);
    requirePluginManualReview();
    // 同一套件的首例已经登记生命周期市场。使用独立清单，才能验证按 Enter 没有添加来源。
    const marketId = "e2e-marketplace-consent";
    const catalogDir = join(getE2EAppDataPaths().homeDir, "fixtures", marketId);
    await mkdir(catalogDir, { recursive: true });
    const source = join(catalogDir, "marketplace.json");
    await writeFile(source, JSON.stringify({ name: marketId, plugins: [] }));
    await openPluginSettings();
    await setPluginPresentation({ locale: "zh-CN", theme: "zai-light", width: 1200, height: 800 });
    await openAddMenu("plugin-store-create");
    await clickPluginControl("plugin-store-add-source-menu-item");
    await waitForPluginControl("plugin-store-add-source-dialog");
    await setInputValueByTestIdDom("plugin-store-add-source-input", source);
    expect((await getPluginOverview()).marketplaces.some(({ id }) => id === marketId)).toBe(false);
    const acknowledgement = browser.$(
      '[data-testid="plugin-store-add-source-risk-acknowledgement"]',
    );
    const submit = browser.$('[data-testid="plugin-store-add-source-submit"]');
    expect(await acknowledgement.getAttribute("aria-checked")).toBe("false");
    expect(await submit.isEnabled()).toBe(false);
    expect(await getPluginControlText("plugin-store-add-source-risk-warning")).toContain(
      "恶意插件",
    );
    await browser.$('[data-testid="plugin-store-add-source-input"]').click();
    await browser.keys("Enter");
    expect(
      (await getPluginOverview()).marketplaces.some(
        (marketplace) => marketplace.id === marketId,
      ),
    ).toBe(false);
    await clickPluginControl("plugin-store-add-source-risk-acknowledgement");
    expect(await submit.isEnabled()).toBe(true);
    await capturePluginManualReview("PLM-LC-020", "zh-light-risk-confirmation");
    await clickPluginControl("plugin-store-add-source-submit");
    await waitUntilPluginOverview(
      (overview) =>
        overview.marketplaces.some(
          (marketplace) => marketplace.id === marketId,
        ),
      "确认风险后未添加市场",
    );
    await browser.waitUntil(
      async () => !(await hasPluginControl("plugin-store-add-source-dialog")),
    );
    await openAddMenu("plugin-store-create");
    await clickPluginControl("plugin-store-add-source-menu-item");
    await waitForPluginControl("plugin-store-add-source-dialog");
    expect(await acknowledgement.getAttribute("aria-checked")).toBe("false");
    expect(await submit.isEnabled()).toBe(false);
    await clickPluginControl("plugin-store-add-source-risk-acknowledgement");
    await browser.keys("Escape");
    await openAddMenu("plugin-store-create");
    await clickPluginControl("plugin-store-add-source-menu-item");
    await waitForPluginControl("plugin-store-add-source-dialog");
    expect(await acknowledgement.getAttribute("aria-checked")).toBe("false");
  });
});
async function openAddMenu(testId: string) {
  await waitForPluginControl(testId);
  await browser.execute((id) => {
    document
      .querySelector<HTMLElement>(`[data-testid="${id}"]`)
      ?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
  }, testId);
  await waitForPluginControl("plugin-add-menu");
  expect(
    await browser.execute(
      () => document.querySelectorAll('[data-testid="plugin-add-menu"] [role="menuitem"]').length,
    ),
  ).toBe(2);
}
async function expectCreatorDraft(checkFocus = true) {
  // 旧草稿仍挂载在设置页背后，必须先等创建请求真正关闭设置，避免读到上次草稿。
  await browser.waitUntil(
    async () => browser.execute(() => !document.querySelector('[data-testid="settings-page"]')),
    { timeout: 30000 },
  );
  await waitForV4Pane((s) => s.sessionId === "draft", "创建插件未进入新草稿");
  await browser.waitUntil(
    async () => (await getV4ComposerText())?.includes("$plugin-creator") === true,
    { timeout: 30000 },
  );
  const text = await getV4ComposerText();
  expect(text).toContain("/SKILL.md)");
  expect(text?.endsWith(" ")).toBe(true);
  if (checkFocus)
    await browser.waitUntil(isV4ComposerFocused, {
      timeout: 15000,
      timeoutMsg: "创建插件后输入框未获得焦点",
    });
  await waitForV4Pane(
    (snapshot) => snapshot.sessionId === "draft" && snapshot.rowCount === 0 && !snapshot.canStop,
    "创建入口自动发送了任务",
  );
}
