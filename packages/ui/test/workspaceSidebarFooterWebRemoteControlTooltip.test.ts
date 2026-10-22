import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebarFooter } from "@/WorkspaceSidebarFooter.js";

const mockFooterSettings = vi.hoisted(() => ({
  current: {
    modelProviderFamilySelectedKeys: {} as Record<string, string>,
    providerFamilyDomain: undefined as "zai" | "bigmodel" | undefined,
  },
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children, title }: { children: unknown; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

vi.mock("@/WorkspaceWebRemoteControlTrigger.js", () => ({
  WorkspaceWebRemoteControlTrigger: () =>
    createElement("button", {
      "data-testid": "web-remote-control-trigger",
    }),
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
      formatMessage: ({ id }: { id: string }) => id,
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
    mockFooterSettings.current = {
      modelProviderFamilySelectedKeys: {},
      providerFamilyDomain: undefined,
    };
  });

  it("keeps long profile names constrained inside the footer row", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebarFooter, {
        theme: "dark",
        localeMenuValue: "zh-CN",
        onLocaleChange: () => {},
        onThemeChange: () => {},
        onSettingsButtonClick: () => {},
        user: {
          id: "user-long-name",
          username: "very-very-very-very-very-very-long-user-name",
          displayName: "VeryVeryVeryVeryVeryVeryVeryVeryLongDisplayName",
        },
      }),
    );

    expect(html).toContain("min-w-0 flex-1");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("text-left");
    expect(html).toContain("truncate text-ui-base font-semibold");
  });

  it("does not wrap the remote control trigger in a second tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebarFooter, {
        theme: "dark",
        localeMenuValue: "zh-CN",
        onLocaleChange: () => {},
        onThemeChange: () => {},
        onSettingsButtonClick: () => {},
        workspacePath: "/tmp/project",
        isDesktop: true,
      }),
    );

    expect(html).toContain('data-testid="web-remote-control-trigger"');
    expect(html).not.toContain('data-tooltip-title="webRemoteControl.trigger"');
  });

  it("shows desktop zoom commands under an interface zoom submenu", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ui/src/WorkspaceSidebarFooter.tsx"),
      "utf8",
    );

    expect(source).toContain("{isDesktop ? (");
    expect(source).toContain('id: "sidebar.settings.interfaceZoom"');
    expect(source).toContain("<DropdownMenuSubContent");
    expect(source).toContain("DesktopCommandIds.ZoomIn");
    expect(source).toContain("DesktopCommandIds.ZoomOut");
    expect(source).toContain("DesktopCommandIds.ResetZoom");
    expect(source).toContain('id: "titleBar.menu.view.zoomIn"');
    expect(source).toContain('id: "titleBar.menu.view.zoomOut"');
    expect(source).toContain('id: "titleBar.menu.view.actualSize"');
  });

  it("keeps the interface zoom submenu gated to desktop mode", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ui/src/WorkspaceSidebarFooter.tsx"),
      "utf8",
    );

    expect(source).toContain("{isDesktop ? (");
    expect(source).toContain(") : null}");
  });

  it("keeps language theme and desktop zoom in order", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ui/src/WorkspaceSidebarFooter.tsx"),
      "utf8",
    );

    const localeIndex = source.indexOf('id: "settings.locale"');
    const themeIndex = source.indexOf('id: "settings.themeMode"');
    const zoomIndex = source.indexOf('id: "sidebar.settings.interfaceZoom"');
    expect(localeIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeGreaterThan(localeIndex);
    expect(zoomIndex).toBeGreaterThan(themeIndex);

  });

  it("keeps duplicated help actions out of the profile menu", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ui/src/WorkspaceSidebarFooter.tsx"),
      "utf8",
    );

    expect(source).not.toContain('id: "titleBar.menu.help.feedback"');
    expect(source).not.toContain('id: "sidebar.menu.community"');
    expect(source).not.toContain('id: "titleBar.menu.help.exportLogs"');
    expect(source).not.toContain("<DropdownMenuItem onSelect={onSettingsButtonClick}>");
    expect(source).not.toContain("runExportLogsAction");
  });
});
