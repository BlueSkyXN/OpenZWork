// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import { WorkspaceSidebarFooter } from "@/WorkspaceSidebarFooter.js";
import { consumePendingSettingsSection } from "@/lib/settingsNavigation.js";
import { WebRemoteControlFeatureProvider } from "@/WebRemoteControlFeatureProvider.js";

afterEach(cleanup);

const mockFooterSettings = vi.hoisted(() => ({
  current: {
    modelProviderFamilySelectedKeys: {} as Record<string, string>,
    providerFamilyDomain: undefined as "zai" | "bigmodel" | undefined,
  },
}));

vi.mock("@/ControlHintTooltip.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ControlHintTooltip.js")>()),
  ControlHintTooltip: ({ children, title }: { children: unknown; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    executeDesktopCommand: vi.fn(),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
    openExternal: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }) => zhCN[id] ?? id,
    },
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (state: { isRestoringOAuthSession: boolean }) => unknown) =>
    selector({ isRestoringOAuthSession: false }),
}));

vi.mock("@/hooks/useModelProviders.js", () => ({
  useModelProviders: () => ({
    modelProviders: [],
    loading: false,
  }),
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: mockFooterSettings.current,
    update: vi.fn(),
  }),
}));

vi.mock("@/hooks/useUsageEntitlement.js", () => ({
  useUsageEntitlement: () => ({
    snapshot: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js", () => ({
  useEnterpriseCodingPlanProducts: () => ({
    snapshot: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

describe("WorkspaceSidebarFooter web remote control tooltip", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockFooterSettings.current = {
      modelProviderFamilySelectedKeys: {},
      providerFamilyDomain: undefined,
    };
  });

  it("keeps the local profile label constrained inside the footer row", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebarFooter, {
        theme: "dark",
        localeMenuValue: "zh-CN",
        onLocaleChange: () => {},
        onThemeChange: () => {},
        onSettingsButtonClick: () => {},
      }),
    );

    expect(html).toContain("本地用户");
    expect(html).not.toContain("sidebar.profile.");
    expect(enUS["sidebar.profile.localUser"]).toBe("Local user");
    expect(html).toContain("min-w-0 flex-1");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("text-left");
    expect(html).toContain("truncate text-ui-base font-semibold");
  });

  it("provides a shortcut to the existing settings page without restoring the old dialog", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebarFooter, {
        theme: "dark",
        localeMenuValue: "zh-CN",
        onLocaleChange: () => {},
        onThemeChange: () => {},
        onSettingsButtonClick: () => {},
        isDesktop: true,
      }),
    );

    expect(html).toContain('data-testid="task-settings-button"');
    expect(html).toContain('data-testid="sidebar-remote-control-button"');
    expect(html).not.toContain("web-remote-control-trigger");
    expect(html).not.toContain('data-tooltip-title="webRemoteControl.trigger"');
  });

  it("提交远控导航意图后才打开设置，复用既有回调", () => {
    const openSettings = vi.fn(() => {
      expect(consumePendingSettingsSection()).toBe("remoteControl");
    });
    render(
      createElement(WorkspaceSidebarFooter, {
        theme: "light",
        localeMenuValue: "zh-CN",
        onLocaleChange: () => {},
        onThemeChange: () => {},
        onSettingsButtonClick: openSettings,
        isDesktop: true,
      }),
    );
    expect(openSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "远程控制" }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("remote-control-settings")).toBeNull();
  });

  it.each([
    { isDesktop: false, settingsButtonMode: "settings" as const, enabled: true },
    { isDesktop: true, settingsButtonMode: "back" as const, enabled: true },
    { isDesktop: true, settingsButtonMode: "settings" as const, enabled: false },
  ])("不在 Web、设置返回模式或关闭功能时展示快捷入口：%j", (props) => {
    render(
      createElement(
        WebRemoteControlFeatureProvider,
        { enabled: props.enabled },
        createElement(WorkspaceSidebarFooter, {
          theme: "light",
          localeMenuValue: "zh-CN",
          onLocaleChange: () => {},
          onThemeChange: () => {},
          onSettingsButtonClick: vi.fn(),
          isDesktop: props.isDesktop,
          settingsButtonMode: props.settingsButtonMode,
        }),
      ),
    );
    expect(screen.queryByTestId("sidebar-remote-control-button")).toBeNull();
  });
});
