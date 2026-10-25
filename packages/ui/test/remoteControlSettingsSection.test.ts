// @vitest-environment jsdom

import type { WebRemoteControlStatus } from "@zcode/shared";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteControlSettingsSection,
  isSameWebRemoteControlTarget,
  isReusableWebRemoteControlSession,
  getWebRemoteControlStatusTagLabel,
} from "@/web-remote-control/index.js";

vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/dialog.js", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogContent: ({
    children,
    className,
    showCloseButton: _showCloseButton,
    ...props
  }: {
    children?: ReactNode;
    className?: string;
    showCloseButton?: boolean;
    [key: string]: unknown;
  }) => createElement("section", { className, ...props }, children),
  DialogDescription: ({ children }: { children?: ReactNode }) => createElement("p", null, children),
  DialogHeader: ({ children, className }: { children?: ReactNode; className?: string }) =>
    createElement("header", { className }, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
}));

const feedbackMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  toast: vi.fn(),
  requestLoginEntry: vi.fn(),
  confirm: vi.fn(async () => true),
  resolvedSession: vi.fn<() => string | null>(() => null),
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: feedbackMocks.toast }));

vi.mock("@/BotsDialog.js", () => ({
  BotsDialog: ({ embedded, entryProvider }: { embedded: boolean; entryProvider?: string }) =>
    createElement("div", {
      "data-testid": "bots-settings",
      "data-embedded": embedded,
      "data-provider": entryProvider,
    }),
}));

vi.mock("@/hooks/useResolvedRemoteWorkspaceSessionId.js", () => ({
  useResolvedRemoteWorkspaceSessionId: feedbackMocks.resolvedSession,
}));
vi.mock("@/settings/SettingsHeaderBreadcrumb.js", () => ({
  SettingsBreadcrumbReporter: ({ onSectionSelect }: { onSectionSelect?: () => void }) =>
    onSectionSelect
      ? createElement("button", {
          "data-testid": "back-to-remote-control",
          onClick: onSectionSelect,
        })
      : null,
}));

vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => feedbackMocks.confirm }));

const platformMock = vi.hoisted(() => ({
  getWebRemoteControlStatus: vi.fn(
    async (): Promise<WebRemoteControlStatus> => ({ status: "idle" }),
  ),
  startWebRemoteControl: vi.fn(async () => ({ status: "running" })),
  stopWebRemoteControl: vi.fn(async () => {}),
  refreshWebRemoteControlPairing: vi.fn(async () => ({ status: "running" })),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => platformMock,
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (
    selector: (state: {
      theme: string;
      requestLoginEntry: typeof feedbackMocks.requestLoginEntry;
    }) => unknown,
  ) => selector({ theme: "zai-dark", requestLoginEntry: feedbackMocks.requestLoginEntry }),
}));

const intlMock = vi.hoisted(() => ({
  intl: {
    formatMessage: ({ id }: { id: string }) => id,
  },
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => intlMock,
}));

vi.mock("@/logger.js", () => ({
  logger: {
    error: feedbackMocks.error,
    info: feedbackMocks.info,
  },
}));

describe("RemoteControlSettingsSection layout", () => {
  afterEach(() => {
    cleanup();
    feedbackMocks.resolvedSession.mockReset().mockReturnValue(null);
    platformMock.getWebRemoteControlStatus.mockClear();
    platformMock.startWebRemoteControl.mockClear();
    platformMock.stopWebRemoteControl.mockClear();
    platformMock.refreshWebRemoteControlPairing.mockClear();
    feedbackMocks.confirm.mockClear();
    feedbackMocks.error.mockClear();
    feedbackMocks.info.mockClear();
    feedbackMocks.toast.mockClear();
  });

  it("treats native start cancellation as idle without failure UI", async () => {
    platformMock.startWebRemoteControl.mockResolvedValueOnce({ status: "cancelled" });

    const view = render(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/tmp/project",
      }),
    );

    await waitFor(() =>
      expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(false),
    );
    expect(platformMock.startWebRemoteControl).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId("web-remote-start"));
    await waitFor(() => expect(platformMock.startWebRemoteControl).toHaveBeenCalledOnce());
    expect(view.getByTestId("web-remote-start")).toBeTruthy();
    expect(feedbackMocks.toast).not.toHaveBeenCalled();
    expect(feedbackMocks.error).not.toHaveBeenCalled();
  });

  it("仅在 workspace 与 remoteSessionId 都匹配时复用远控状态", () => {
    expect(
      isSameWebRemoteControlTarget(
        {
          status: "running",
          sessionId: "sid-1",
          workspacePath: "/tmp/workspace-a",
        },
        "/tmp/workspace-b",
      ),
    ).toBe(false);

    expect(
      isSameWebRemoteControlTarget(
        {
          status: "running",
          sessionId: "sid-1",
          workspacePath: "/tmp/workspace-a",
          remoteSessionId: "remote-a",
        },
        "/tmp/workspace-a",
        undefined,
        "remote-b",
      ),
    ).toBe(false);

    expect(
      isSameWebRemoteControlTarget(
        {
          status: "running",
          sessionId: "sid-1",
          workspacePath: "/tmp/workspace-a",
          workspaceIdentity: "ssh://host/repo",
          remoteSessionId: "remote-a",
        },
        "/tmp/any-local-path",
        "ssh://host/repo",
        "remote-a",
      ),
    ).toBe(true);
  });

  it("复用已有 window 级远控会话时不要求 workspace 匹配", () => {
    expect(
      isReusableWebRemoteControlSession({
        status: "active",
        sessionId: "sid-1",
        mobileConnected: true,
        workspacePath: "/tmp/workspace-a",
      }),
    ).toBe(true);

    expect(
      isReusableWebRemoteControlSession({
        status: "idle",
      }),
    ).toBe(false);

    expect(
      isReusableWebRemoteControlSession({
        status: "error",
        sessionId: "sid-1",
        mobileConnected: true,
        workspacePath: "/tmp/workspace-a",
      }),
    ).toBe(false);

    expect(
      isReusableWebRemoteControlSession({
        status: "running",
        sessionId: "sid-1",
        mobileConnected: false,
        workspacePath: "/tmp/workspace-a",
      }),
    ).toBe(false);
  });

  it("只在用户点击开启后连接，并提交所选模式", async () => {
    const view = render(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/tmp/project",
      }),
    );
    await waitFor(() =>
      expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(false),
    );
    expect(platformMock.startWebRemoteControl).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId("web-remote-mode-official"));
    fireEvent.click(view.getByTestId("web-remote-start"));
    await waitFor(() =>
      expect(platformMock.startWebRemoteControl).toHaveBeenCalledWith(
        expect.objectContaining({ connection: expect.objectContaining({ mode: "official" }) }),
      ),
    );
  });

  it("renders phone QR and bot channel entry cards in settings", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/tmp/project",
      }),
    );

    expect(html).toContain('data-testid="web-remote-control-main-grid"');
    expect(html).toContain("webRemoteControl.mobileQr.title");
    expect(html).toContain("webRemoteControl.botChannel.title");
    expect(html).toContain("webRemoteControl.botChannel.weixin.title");
    expect(html).toContain("webRemoteControl.botChannel.feishu.title");
    expect(html).toContain("webRemoteControl.botChannel.lark.title");
    expect(html).toContain("webRemoteControl.botChannel.telegram.title");
    expect(html).toContain("bots.regionTag.mainland");
    expect(html).toContain("bots.regionTag.international");
    expect(html).toContain('data-testid="web-remote-control-open-bots"');
    expect(html).toContain("webRemoteControl.botChannel.manageBots");

    const larkIndex = html.indexOf("webRemoteControl.botChannel.lark.title");
    const larkTagIndex = html.indexOf("bots.regionTag.international");
    const telegramIndex = html.indexOf("webRemoteControl.botChannel.telegram.title");
    const openBotsIndex = html.indexOf('data-testid="web-remote-control-open-bots"');
    expect(larkTagIndex).toBeGreaterThan(larkIndex);
    expect(larkTagIndex).toBeLessThan(telegramIndex);
    expect(telegramIndex).toBeGreaterThan(larkIndex);
    expect(openBotsIndex).toBeGreaterThan(telegramIndex);
  });

  it("未开启时不展示空二维码和不可用的连接操作", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteControlSettingsSection, { workspacePath: "/tmp/project" }),
    );
    expect(html).toContain('data-testid="remote-control-settings"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('data-testid="web-remote-control-copy-link-row"');
    expect(html).not.toContain('data-testid="web-remote-control-qr"');
  });

  it("运行连接在设置页展示复制和重新配对，离开页面不停止", async () => {
    platformMock.getWebRemoteControlStatus.mockResolvedValueOnce({ status: "running" });
    const view = render(
      createElement(RemoteControlSettingsSection, { workspacePath: "/tmp/project" }),
    );
    await waitFor(() => expect(view.getByTestId("web-remote-control-copy-link-row")).toBeTruthy());
    expect(view.container.textContent).toContain("webRemoteControl.refreshQr");
    expect(view.container.textContent).toContain("webRemoteControl.copyLink");
    view.unmount();
    expect(platformMock.stopWebRemoteControl).not.toHaveBeenCalled();
  });

  it.each([
    { workspacePath: "/local", initialTaskId: "local-task" },
    {
      workspacePath: "/remote",
      workspaceIdentity: "remote-a",
      remoteSessionId: "session-a",
      initialTaskId: "remote-task",
    },
  ])("重新配对沿用运行连接的完整目标，不混入设置页最近工作区：%j", async (target) => {
    platformMock.getWebRemoteControlStatus.mockResolvedValueOnce({ status: "running", ...target });
    feedbackMocks.resolvedSession.mockReturnValue("session-other");
    const view = render(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/other",
        workspaceIdentity: "remote-other",
        remoteSessionId: "session-other",
        initialTaskId: "task-other",
      }),
    );
    await waitFor(() => expect(view.getByTestId("web-remote-control-copy-link-row")).toBeTruthy());
    fireEvent.click(view.getByText("webRemoteControl.refreshQr"));
    await waitFor(() =>
      expect(platformMock.refreshWebRemoteControlPairing).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: target.workspacePath,
          workspaceIdentity: "workspaceIdentity" in target ? target.workspaceIdentity : undefined,
          remoteSessionId: "remoteSessionId" in target ? target.remoteSessionId : undefined,
          initialTaskId: target.initialTaskId,
        }),
      ),
    );
    expect(feedbackMocks.confirm).toHaveBeenCalledOnce();
  });

  it("Bot 管理在设置页内打开，并能返回保留连接草稿的卡片页", async () => {
    const view = render(
      createElement(RemoteControlSettingsSection, { workspacePath: "/tmp/project" }),
    );
    await waitFor(() =>
      expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(view.getByTestId("web-remote-mode-official"));
    fireEvent.click(view.getByTestId("web-remote-control-open-bots"));
    expect(view.queryByTestId("web-remote-control-main-grid")).toBeNull();
    expect(view.getByTestId("bots-settings").getAttribute("data-embedded")).toBe("true");
    fireEvent.click(view.getByTestId("back-to-remote-control"));
    expect(view.getByTestId("web-remote-mode-official").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(view.getByTestId("web-remote-bot-feishu"));
    expect(view.getByTestId("bots-settings").getAttribute("data-provider")).toBe("feishu");
    expect(platformMock.startWebRemoteControl).not.toHaveBeenCalled();
    expect(platformMock.stopWebRemoteControl).not.toHaveBeenCalled();
  });

  it("开启使用最近 workspace identity 和 resolver 的存活 session", async () => {
    feedbackMocks.resolvedSession.mockReturnValue("live-session");
    const view = render(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/tmp/project",
        workspaceIdentity: "remote:ssh:host:22:user:/tmp/project",
        remoteSessionId: "stale-session",
        initialTaskId: "task-a",
      }),
    );
    await waitFor(() =>
      expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(view.getByTestId("web-remote-start"));
    await waitFor(() =>
      expect(platformMock.startWebRemoteControl).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: "/tmp/project",
          workspaceIdentity: "remote:ssh:host:22:user:/tmp/project",
          remoteSessionId: "live-session",
          initialTaskId: "task-a",
        }),
      ),
    );
  });

  it("远端重连期间丢弃 stale session，保留 identity 和窗口远控入口", async () => {
    feedbackMocks.resolvedSession.mockReturnValue(null);
    const view = render(
      createElement(RemoteControlSettingsSection, {
        workspacePath: "/tmp/project",
        workspaceIdentity: "remote:ssh:host:22:user:/tmp/project",
        remoteSessionId: "stale-session",
      }),
    );
    await waitFor(() =>
      expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(view.getByTestId("web-remote-start"));
    await waitFor(() =>
      expect(platformMock.startWebRemoteControl).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceIdentity: "remote:ssh:host:22:user:/tmp/project",
          remoteSessionId: undefined,
        }),
      ),
    );
  });

  it("没有工作区时禁止开启，Bot 管理仍可进入", async () => {
    const view = render(createElement(RemoteControlSettingsSection, { workspacePath: "" }));
    await waitFor(() => expect(platformMock.getWebRemoteControlStatus).toHaveBeenCalled());
    expect(view.getByTestId("web-remote-start").hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByTestId("web-remote-start"));
    expect(platformMock.startWebRemoteControl).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId("web-remote-control-open-bots"));
    expect(view.getByTestId("bots-settings")).toBeTruthy();
  });

  it("uses the paired mobile device name for the status tag instead of session id", () => {
    expect(
      getWebRemoteControlStatusTagLabel(
        {
          status: "active",
          sessionId: "sid-12345678",
          mobileConnected: true,
          mobileDeviceInfo: {
            platform: "web",
            version: "1.7.0",
            name: "mobile-browser",
            browserPlatform: "iPhone",
            updatedAt: 1,
          },
        },
        ({ id }: { id: string }) => id,
      ),
    ).toBe("iPhone");
  });
});
