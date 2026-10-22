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

vi.mock("@/ControlHintTooltip.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ControlHintTooltip.js")>()),
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
});
