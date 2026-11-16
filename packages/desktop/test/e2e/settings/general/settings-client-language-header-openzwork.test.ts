// OpenZWork 自有验收（OZ-D008 裁剪后合同）：界面语言实时切换 + 帮助配置零远端请求。
// 上游 spec settings-client-language-header.test.ts 断言的 /api/v1/client/configs 远端拉取
// 与灰度预热已随官方服务移除（packages/shared/src/helpAppConfig.ts、web/communityUrl.ts
// 明示「帮助配置只走本地打包默认值」），其 5 个 case 在 OpenZWork 不可能成立——上游 spec
// 原文保留为历史；本文件承接当前仍然成立的保留行为：
// ① 语言切换在 UI 实时生效（帮助菜单标签跟随界面语言）；
// ② 反向合同：把 endpoint 指向观测 server 后，client/configs 全程零请求（远端拉取已删除）。
//
// 已核实的实现差异（记录为缺口，不在本 spec 断言，见 2026-11-16 收据）：
// - 上游 spec 的 uiLocale/uiLocalePreference 落盘形态与当前实现不符：UI setLocalePreference
//   经 settingService.update 写 {locale, localePreference}（IntlProvider.tsx:194-199），
//   E2E 实测 15s 内 setting.json 未出现 uiLocale 字段——上游持久化合同在当前代码未复现，
//   是否保留该合同待产品裁决。
// - openCommunity 的本地配置读取在 unpackaged 环境（E2E/dev）解析 packages/desktop/config/
//   default.json（不存在，desktopCommandHandlers.ts:136），仅打包形态（resources/config/
//   default.json，PK01 结构核验覆盖）可用——dev/E2E 断言 openExternal 属环境限制而非合同。
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
});
