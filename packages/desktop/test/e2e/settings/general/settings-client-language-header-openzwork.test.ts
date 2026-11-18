// OpenZWork 自有验收（OZ-D008 裁剪后合同）：界面语言实时切换 + 持久化兼容 + 帮助配置零远端请求。
// 上游 spec settings-client-language-header.test.ts 断言的 /api/v1/client/configs 远端拉取
// 与灰度预热已随官方服务移除（packages/shared/src/helpAppConfig.ts、web/communityUrl.ts
// 明示「帮助配置只走本地打包默认值」），其 5 个 case 在 OpenZWork 不可能成立——上游 spec
// 原文保留为历史；本文件承接当前仍然成立的保留行为：
// ① 语言切换在 UI 实时生效（帮助菜单标签跟随界面语言）；
// ② 反向合同：把 endpoint 指向观测 server 后，client/configs 全程零请求（远端拉取已删除）；
// ③ OZ-CLH-02（2026-11-17 J1 补齐）：UI 选非中英语言后，setting.json 按上游兼容合同落盘
//   （旧字段只写中英、真实选择写 uiLocale/uiLocalePreference；合同见
//   docs/specs/settings-locale-persistence-openzwork.md / OZ-C012）。
//
// 历史缺口处置：
// - uiLocale 落盘差异（2026-11-16 记录）已定性为 v3.18.0 merge 4d263563 冲突裁决丢失的
//   合同回归并于 J1 修复（settingService writeSettingsAt 恢复 toPersistedSettingsLocaleFields），
//   由 OZ-CLH-02 与 packages/services/test/settingsLocalePersistence.test.ts 共同承接。
// - E2E 已知自动化限制（2026-11-17 实测留档）：设置页语言下拉对「非前两项」语言项
//   （ja/ru/ko）的合成点击确定性不生效（html lang 无任何变化；连 pointerType=mouse 的
//   完整 pointer 事件序列亦然），而 en/zh 项可靠生效；应用代码路径对 locale 无差别
//   （settingsPageHelpers 的 SUPPORTED_LOCALES 循环 + IntlProvider 无 per-locale 分支）。
//   因此 UI 写链用 en/zh 项验证；ja/ru/ko 的落盘与冷恢复由工程回归
//   （真实服务全语言矩阵）与 OZ-CLH-02 的 seed+重启读链覆盖。
// - openCommunity 的本地配置读取在 unpackaged 环境（E2E/dev）解析 packages/desktop/config/
//   default.json（不存在，desktopCommandHandlers.ts:136），仅打包形态（resources/config/
//   default.json，PK01 结构核验覆盖）可用——dev/E2E 断言 openExternal 属环境限制而非合同；
//   该结论的路径证据由 packages/desktop/test/communityLocalConfig.test.ts 受控回归固定
//   （dev 形态解析仓库根 config/default.json、packaged 形态按 electron-builder 布局）。
// 仅本地链路，不访问官方服务。
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_LOCALE_SELECT_ITEM,
  TID_SETTINGS_LOCALE_SELECT_TRIGGER,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  quitElectronAppGracefully,
  readSettings,
  seedSettings,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "#e2e/helpers/desktop-app";
import { startHelpConfigFixture } from "#e2e/helpers/help-client-config-fixture";

const HELP_MENU_TRIGGER = 'button[data-testid="workspace-help-menu-trigger"]';

async function selectLocaleInSettings(locale: "zh-CN" | "en-US") {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "没有找到设置入口按钮",
  });
  await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), {
    timeout: 15000,
    timeoutMsg: "设置页没有出现通用分区入口",
  });
  await clickTestIdByWebDriver(TID_SETTINGS_LOCALE_SELECT_TRIGGER, {
    timeout: 15000,
    timeoutMsg: "界面语言下拉触发器没有出现",
  });
  await clickTestIdByDom(testId(TID_SETTINGS_LOCALE_SELECT_ITEM, locale), {
    timeout: 15000,
    timeoutMsg: `界面语言下拉项没有出现: ${locale}`,
  });
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15000,
    timeoutMsg: "设置页没有返回按钮",
  });
}

describe("OpenZWork 语言切换与本地帮助配置（OZ-D008 裁剪后合同）", () => {
  const servers: Array<Awaited<ReturnType<typeof startHelpConfigFixture>>> = [];

  after(async () => {
    for (const server of servers) await server.close();
    await clearAppData();
  });

  it("OZ-CLH-01: 语言切换 UI 实时生效，且 client/configs 全程零请求", async function () {
    this.timeout(150_000);
    // 观测 server 只作「零请求」反向合同：OZ-D008 已删除 client/configs 远端拉取与
    // 灰度预热，全程不得有任何请求到达（上游 CLH-01 等待预热请求的形态在此反转）。
    const server = await startHelpConfigFixture({
      community_urls: {
        "zh-CN": "https://example.invalid/OZ_CLH_LOCAL_ZH",
        "en-US": "https://example.invalid/OZ_CLH_LOCAL_EN",
      },
    });
    servers.push(server);
    await seedSettings({ zcodeEndpointOrigin: server.origin });
    await waitForDefaultWorkspaceReady(30000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);

    // 默认中文：帮助菜单标签为「帮助」。
    await expect($(HELP_MENU_TRIGGER)).toHaveAttribute("aria-label", "帮助");
    // 切到英文后实时生效（不重启、不刷新）。
    await selectLocaleInSettings("en-US");
    await expect($(HELP_MENU_TRIGGER)).toHaveAttribute("aria-label", "Help");
    // 反向合同：全程无 client/configs 请求到达观测 server。
    expect(server.requests).toEqual([]);
  });

  it("OZ-CLH-02: UI 写链产出兼容落盘格式，冷恢复按 uiLocale 读回真实语言", async function () {
    this.timeout(180_000);
    // 写链：经真实设置页切换语言（en/zh 项在此 E2E 环境选择可靠），断言 setting.json
    // 出现 uiLocale/uiLocalePreference 四字段格式。修复前（merge 4d263563 起的直写回归）
    // 文件只有 {locale, localePreference}，无 uiLocale 字段——本断言即区分。
    await seedSettings({});
    await waitForDefaultWorkspaceReady(30000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await selectLocaleInSettings("zh-CN");
    await expect($(HELP_MENU_TRIGGER)).toHaveAttribute("aria-label", "帮助");
    await browser.waitUntil(
      async () => {
        const raw = (await readSettings()) as Record<string, unknown>;
        return (
          raw.locale === "zh-CN" &&
          raw.localePreference === "zh-CN" &&
          raw.uiLocale === "zh-CN" &&
          raw.uiLocalePreference === "zh-CN"
        );
      },
      { timeout: 20000, timeoutMsg: "setting.json 未在超时内出现兼容合同的语言字段" },
    );

    // 冷恢复（读链）：以兼容格式种入日文（旧字段中英、真实选择在 uiLocale），
    // 重启后界面必须按 uiLocale 显示日文——证明新格式读取/优先级合同在真实启动成立。
    // 注：不通过设置页下拉选 ja/ru/ko——本 E2E 环境对非前两项的合成点击存在确定性
    // 不生效问题（详见文件头注释），UI 写链由上面的 en/zh 切换覆盖。
    await quitElectronAppGracefully();
    // uiLocale/uiLocalePreference 是落盘专有字段（内存 AppSettings 无此键），种盘时按原始 JSON 合并。
    const seeded = await seedSettings({
      locale: "en-US",
      localePreference: "en-US",
      lastWorkspaceSession: [
        { kind: "local", workspacePath: DEFAULT_WORKSPACE, workspacePurpose: "project" },
      ],
      lastActiveTabIndex: 0,
    });
    await seedSettings({
      ...(seeded as Record<string, unknown>),
      uiLocale: "ja-JP",
      uiLocalePreference: "ja-JP",
    } as Parameters<typeof seedSettings>[0]);
    await browser.reloadSession();
    await waitForDefaultWorkspaceReady(30000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await expect($(HELP_MENU_TRIGGER)).toHaveAttribute("aria-label", "ヘルプ");
    const htmlLang = await browser.execute(() => document.documentElement.lang);
    expect(htmlLang).toBe("ja-JP");
  });
});
