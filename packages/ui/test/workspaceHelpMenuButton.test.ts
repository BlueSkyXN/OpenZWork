import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopCommandIds } from "@zcode/shared";
import { TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER } from "@zcode/shared/test-ids";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
    locale: "zh-CN",
  }),
}));

const captured = vi.hoisted(() => ({
  zsrcUrl: null as string | null,
  loading: false,
  openExternal: vi.fn(),
  exportLogs: vi.fn(async () => ({ success: true })),
  toast: vi.fn(() => 7),
  dismissToast: vi.fn(),
  menuItems: [] as Array<{
    label: string;
    testId?: string;
    disabled?: boolean;
    onSelect: (() => void | Promise<void>) | undefined;
  }>,
  updateMenu: {
    visible: true,
    disabled: false,
    labelId: "titleBar.menu.help.checkForUpdates",
    labelValues: undefined,
  },
  executeDesktopCommand: vi.fn(async () => undefined),
}));

vi.mock("@/components/ui/dropdown-menu.js", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    "data-testid": testId,
  }: {
    children: ReactNode;
    onSelect?: () => void | Promise<void>;
    disabled?: boolean;
    "data-testid"?: string;
  }) => {
    const label = Array.isArray(children)
      ? children.filter((child) => typeof child === "string").join("")
      : typeof children === "string"
        ? children
        : "";
    captured.menuItems.push({ label, testId, onSelect, disabled });
    return createElement("div", { "data-testid": testId }, children);
  },
  DropdownMenuSeparator: () => createElement("hr"),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: captured.toast,
  dismissToast: captured.dismissToast,
}));

vi.mock("@/feedback/feedbackStore.js", () => ({
  useFeedbackStore: (
    selector: (state: {
      openSubmit: (draft?: unknown) => void;
      openFeatureRequest: () => void;
    }) => unknown,
  ) => selector({ openSubmit: vi.fn(), openFeatureRequest: vi.fn() }),
}));

vi.mock("@/hooks/useDesktopUpdateMenu.js", () => ({
  useDesktopUpdateMenu: (isDesktop: boolean) => ({
    ...captured.updateMenu,
    visible: isDesktop && captured.updateMenu.visible,
    checkForUpdates: () => captured.executeDesktopCommand(DesktopCommandIds.CheckForUpdates),
  }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    captureWindowScreenshot: vi.fn(async () => null),
    executeDesktopCommand: captured.executeDesktopCommand,
    exportLogs: captured.exportLogs,
    openCommunity: vi.fn(async () => undefined),
    openExternal: captured.openExternal,
  }),
}));

vi.mock("@/hooks/useVulnerabilityReportUrl.js", () => ({
  useVulnerabilityReportUrl: () => ({ url: captured.zsrcUrl, loading: captured.loading }),
}));

describe("WorkspaceHelpMenuButton", () => {
  async function render(isDesktop: boolean | undefined) {
    captured.menuItems = [];
    captured.executeDesktopCommand.mockClear();
    captured.exportLogs.mockClear();
    captured.toast.mockClear();
    captured.dismissToast.mockClear();
    const { WorkspaceHelpMenuButton } = await import("@/WorkspaceHelpMenuButton.js");
    return renderToStaticMarkup(createElement(WorkspaceHelpMenuButton, { isDesktop }));
  }

  it("桌面端渲染资源管理器项，点击走 OpenResourceManager 命令", async () => {
    // 原因：Windows/Linux 没有原生菜单栏，自绘箭头菜单也已下线，问号菜单是资源管理器唯一入口。
    const html = await render(true);

    expect(html).toContain("titleBar.menu.help.resourceManager");
    const item = captured.menuItems.find(
      (entry) => entry.testId === TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
    );
    expect(item).toBeDefined();
    await item!.onSelect?.();
    expect(captured.executeDesktopCommand).toHaveBeenCalledWith(
      DesktopCommandIds.OpenResourceManager,
    );
  });

  it("Web 端（isDesktop 缺省 / false）不渲染资源管理器项", async () => {
    for (const isDesktop of [undefined, false]) {
      const html = await render(isDesktop);
      expect(html).not.toContain("titleBar.menu.help.resourceManager");
      expect(
        captured.menuItems.some(
          (entry) => entry.testId === TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
        ),
      ).toBe(false);
    }
  });

  it("桌面端关于项位于最后，点击复用 ShowAbout", async () => {
    await render(true);
    const index = captured.menuItems.findIndex(
      (entry) => entry.label === "titleBar.menu.help.about",
    );
    expect(index).toBeGreaterThan(0);
    expect(index).toBe(captured.menuItems.length - 1);
    await captured.menuItems[index]?.onSelect?.();
    expect(captured.executeDesktopCommand).toHaveBeenCalledExactlyOnceWith(
      DesktopCommandIds.ShowAbout,
    );
  });

  it("Web 和手机远控不显示桌面关于入口", async () => {
    for (const isDesktop of [undefined, false]) {
      expect(await render(isDesktop)).not.toContain("titleBar.menu.help.about");
    }
  });

  it("Web 与 Preview 不显示检查更新", async () => {
    expect(await render(false)).not.toContain("titleBar.menu.help.checkForUpdates");
    captured.updateMenu.visible = false;
    try {
      expect(await render(true)).not.toContain("titleBar.menu.help.checkForUpdates");
    } finally {
      captured.updateMenu.visible = true;
    }
  });

  it("Web 和手机远控不显示本地导出日志入口", async () => {
    for (const isDesktop of [undefined, false]) {
      expect(await render(isDesktop)).not.toContain("titleBar.menu.help.exportLogs");
      expect(captured.exportLogs).not.toHaveBeenCalled();
    }
  });

  it("桌面分隔社区与本机工具，Web 仅显示社区", async () => {
    for (const desktop of [true, false]) {
      const html = await render(desktop);
      expect(captured.menuItems.map((item) => item.label)).toEqual([
        "workspaceHeader.help.community",
        ...(desktop
          ? [
              "titleBar.menu.help.resourceManager",
              "titleBar.menu.help.about",
            ]
          : []),
      ]);
      expect((html.match(/<hr/g) ?? []).length).toBe(desktop ? 1 : 0);
    }
  });

  it("桌面端与 Web 端都保留原有帮助项", async () => {
    for (const isDesktop of [true, false]) {
      const html = await render(isDesktop);
      for (const id of [
        "workspaceHeader.help.community",
      ]) {
        expect(html).toContain(id);
      }
    }
  });
});
