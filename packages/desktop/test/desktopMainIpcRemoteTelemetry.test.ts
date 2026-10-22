import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalChannels, PlatformChannels, type RemoteTarget } from "@zcode/shared";
import { isAllowedExternalOpenUrl } from "../src/main/desktopMainIpcRemote.js";

type IpcHandler = (...args: unknown[]) => unknown;
type RemoteIpcOptions = Parameters<
  typeof import("../src/main/desktopMainIpcRemote.js").registerRemoteIpcHandlers
>[0];

const h = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  listeners: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn(),
  registerWebRemoteControlIpcHandlers: vi.fn(),
  shellOpenExternal: vi.fn(),
  shellOpenPath: vi.fn(),
  configureRemoteUsageArmsTelemetry: vi.fn(),
  reportRemoteConnectResultToArms: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: h.fromWebContents,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => h.handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => h.listeners.set(channel, handler)),
  },
  shell: {
    openExternal: h.shellOpenExternal,
    openPath: h.shellOpenPath,
  },
}));

vi.mock("../src/main/desktopNotifications.js", () => ({
  dispatchTaskNotification: vi.fn(),
}));

vi.mock("../src/main/desktopOAuthDeepLink.js", () => ({
  clearOAuthRoutesForWindow: vi.fn(),
  deliverPendingDeepLink: vi.fn(() => false),
  parseOAuthStateRegistration: vi.fn(),
  registerOAuthState: vi.fn(),
}));

vi.mock("../src/main/desktopArmsCustomEvent.js", () => ({
  createFinalArmsCustomEventE2EController: vi.fn(),
  dispatchFinalArmsCustomEvent: vi.fn(),
}));

vi.mock("../src/main/desktopWebRemoteControlIpc.js", () => ({
  registerWebRemoteControlIpcHandlers: h.registerWebRemoteControlIpcHandlers,
}));

vi.mock("../src/main/desktopRemoteUsageArmsTelemetry.js", () => ({
  configureRemoteUsageArmsTelemetry: h.configureRemoteUsageArmsTelemetry,
  reportRemoteConnectResultToArms: h.reportRemoteConnectResultToArms,
}));

function createOptions(overrides?: Partial<RemoteIpcOptions>): RemoteIpcOptions {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    appTelemetryRuntime: {
      onRendererReady: vi.fn(),
      syncRendererContext: vi.fn(),
      onOAuthCallbackHandled: vi.fn(),
    },
    appTelemetryCore: {
      reportEvent: vi.fn(async () => {}),
    },
    reportRemoteUsageEvent: vi.fn(),
    armsCustomContext: {
      deviceMid: "device-mid",
      platform: "darwin",
      appVersion: "1.0.0",
      armsEnv: "test",
    },
    webRemoteControlManager: {
      notifyAuthStateChanged: vi.fn(),
      authorizeStart: vi.fn(),
      startAuthorized: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(),
    },
    createRemoteWorkspaceSession: vi.fn(async () => "remote-session-1"),
    disposeRemoteWorkspaceSession: vi.fn(),
    cancelPendingRemoteWorkspaceSessionsForWindow: vi.fn(),
    bindRemoteWorkspaceSessionContext: vi.fn(),
    confirmRendererAttachmentReady: vi.fn(),
    getRemoteConnectionStats: vi.fn(() => ({
      activeSessionCount: 0,
      activeTargetCount: 0,
    })),
    isDockerDaemonAvailable: vi.fn(async () => true),
    listAvailableWSLDistros: vi.fn(async () => []),
    listAvailableDockerContainers: vi.fn(async () => []),
    listSSHConfigAliases: vi.fn(async () => []),
    ...overrides,
  };
}

async function registerHarness(overrides?: Partial<RemoteIpcOptions>) {
  const { registerRemoteIpcHandlers } = await import("../src/main/desktopMainIpcRemote.js");
  const options = createOptions(overrides);
  registerRemoteIpcHandlers(options);
  const handler = h.handlers.get(PlatformChannels.ConnectRemote);
  expect(handler).toBeDefined();
  return { handler: handler!, options };
}

describe("remote workspace connect telemetry IPC", () => {
  it("只允许 Web URL 和 file URL 交给系统浏览器", () => {
    expect(isAllowedExternalOpenUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalOpenUrl("file:///tmp/report.html")).toBe(true);
    expect(isAllowedExternalOpenUrl("file:///tmp/report.txt")).toBe(true);
    expect(isAllowedExternalOpenUrl("file:///etc/passwd")).toBe(true);
    expect(isAllowedExternalOpenUrl("data:text/html,hello")).toBe(false);
  });

  beforeEach(() => {
    h.handlers.clear();
    h.listeners.clear();
    h.fromWebContents.mockReset();
    h.fromWebContents.mockReturnValue({ id: 17 });
    h.registerWebRemoteControlIpcHandlers.mockReset();
    h.shellOpenExternal.mockReset().mockResolvedValue(undefined);
    h.shellOpenPath.mockReset().mockResolvedValue("");
    h.configureRemoteUsageArmsTelemetry.mockReset();
    h.reportRemoteConnectResultToArms.mockReset();
  });

  it("只允许 main 进程打开 http/https/file URL", async () => {
    const { registerRemoteIpcHandlers } = await import("../src/main/desktopMainIpcRemote.js");
    const options = createOptions();
    registerRemoteIpcHandlers(options);
    const listener = h.listeners.get(PlatformChannels.OpenExternal);
    expect(listener).toBeDefined();

    listener?.({}, "https://example.com/docs");
    listener?.({}, "http://localhost:3000/index.html");
    const filePath = join(tmpdir(), "secret");
    listener?.({}, pathToFileURL(filePath).href);
    listener?.({}, "javascript:alert(1)");
    listener?.({}, "not a url");

    expect(h.shellOpenExternal).toHaveBeenCalledTimes(2);
    expect(h.shellOpenExternal).toHaveBeenCalledWith("https://example.com/docs");
    expect(h.shellOpenExternal).toHaveBeenCalledWith("http://localhost:3000/index.html");
    await vi.waitFor(() => expect(h.shellOpenPath).toHaveBeenCalledWith(filePath));
    expect(options.logger.warn).toHaveBeenCalledTimes(2);
  });

  it("把 renderer attachment-ready ACK 转发给对应窗口 session manager", async () => {
    const confirmRendererAttachmentReady = vi.fn();
    await registerHarness({ confirmRendererAttachmentReady });
    const listener = h.listeners.get(InternalChannels.ScopedServicePortReady);

    listener?.(
      { sender: { id: 73 } },
      { sessionId: "remote-session-1", attachmentId: "attachment-b" },
    );

    expect(confirmRendererAttachmentReady).toHaveBeenCalledWith(73, {
      sessionId: "remote-session-1",
      attachmentId: "attachment-b",
    });
  });

  it("returns structured bind failures across Electron invoke", async () => {
    const bindError = Object.assign(new Error("workspace migration conflict"), {
      code: "workspace-task-identity-conflict",
      retryable: false,
    });
    await registerHarness({
      bindRemoteWorkspaceSessionContext: vi.fn(async () => {
        throw bindError;
      }),
    });
    const handler = h.handlers.get(PlatformChannels.BindRemoteWorkspaceSessionContext);

    await expect(
      handler?.(
        { sender: { id: 73 } },
        {
          remoteSessionId: "remote-session-1",
          workspacePath: "/workspace/demo",
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: "workspace migration conflict",
      reasonCode: "workspace-task-identity-conflict",
      retryable: false,
    });
  });

  it("does not expose an unregistered prefixed reason code to Renderer", async () => {
    const internalError = Object.assign(new Error("internal bind detail"), {
      code: "source-server-private-debug",
      retryable: true,
    });
    await registerHarness({
      bindRemoteWorkspaceSessionContext: vi.fn(async () => {
        throw internalError;
      }),
    });
    const handler = h.handlers.get(PlatformChannels.BindRemoteWorkspaceSessionContext);

    await expect(
      handler?.(
        { sender: { id: 73 } },
        { remoteSessionId: "remote-session-1", workspacePath: "/workspace/demo" },
      ),
    ).resolves.toEqual({ success: false, error: "internal bind detail" });
  });

  it("只透传本次连接实际复用的目标，后续新连接不继承复用信息", async () => {
    const target: RemoteTarget = { kind: "ssh", host: "active.example.com", username: "dev" };
    let reused = true;
    const { handler } = await registerHarness({
      createRemoteWorkspaceSession: vi.fn(
        async (_window, _target, _requestId, _context, lifecycle) => {
          lifecycle?.onConnected?.({
            remoteSessionId: "remote-session-1",
            target,
            generation: 1,
            ...(reused ? { reusedConnectionTarget: target } : {}),
          });
          return "remote-session-1";
        },
      ),
    });
    expect(await handler({ sender: { id: 73 } }, { target, requestId: "reused" })).toMatchObject({
      reusedConnectionTarget: target,
    });
    reused = false;
    expect(await handler({ sender: { id: 73 } }, { target, requestId: "new" })).toEqual({
      success: true,
      sessionId: "remote-session-1",
    });
  });

  it.each([
    ["ssh", { kind: "ssh", host: "dev.example.com", username: "root" }],
    ["wsl", { kind: "wsl", distro: "Ubuntu" }],
    ["docker", { kind: "docker", container: "dev-container" }],
    ["server", { kind: "server", url: "https://studio.example.com", serverId: "studio" }],
  ] satisfies Array<[RemoteTarget["kind"], RemoteTarget]>)(
    "%s 新建连接保留工作区身份并返回结果",
    async (remoteKind, target) => {
      const reportRemoteUsageEvent = vi.fn();
      const { handler, options } = await registerHarness({ reportRemoteUsageEvent });

      const result = await handler(
        { sender: { id: 73 } },
        {
          target,
          requestId: "connect-request-1",
          workspacePath: "/workspace/demo",
          workspaceIdentity: `remote:${remoteKind}:identity:/workspace/demo`,
        },
      );

      expect(result).toEqual({ success: true, sessionId: "remote-session-1" });
      expect(options.createRemoteWorkspaceSession).toHaveBeenCalledWith(
        expect.anything(),
        target,
        "connect-request-1",
        {
          workspacePath: "/workspace/demo",
          workspaceIdentity: `remote:${remoteKind}:identity:/workspace/demo`,
        },
        expect.objectContaining({
          onConnected: expect.any(Function),
        }),
      );
    },
  );

  it("reconnect 连接失败保留原错误", async () => {
    const error = Object.assign(new Error("password rejected"), {
      code: "AUTH_FAILED",
    });
    const reportRemoteUsageEvent = vi.fn();
    const { handler } = await registerHarness({
      reportRemoteUsageEvent,
      createRemoteWorkspaceSession: vi.fn(async () => {
        throw error;
      }),
    });

    const result = await handler(
      { sender: { id: 74 } },
      {
        target: { kind: "ssh", host: "dev.example.com", username: "root" },
        connectTrigger: "reconnect",
      },
    );

    expect(result).toEqual({
      success: false,
      error: "password rejected",
      reasonCode: "remote-connection-unknown",
    });
  });

  it("preserves migration conflict semantics in connect results", async () => {
    const error = Object.assign(new Error("workspace migration conflict"), {
      code: "workspace-task-identity-conflict",
      retryable: false,
    });
    const { handler } = await registerHarness({
      createRemoteWorkspaceSession: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(
      handler(
        { sender: { id: 74 } },
        { target: { kind: "ssh", host: "dev.example.com", username: "root" } },
      ),
    ).resolves.toEqual({
      success: false,
      error: "workspace migration conflict",
      reasonCode: "workspace-task-identity-conflict",
      retryable: false,
    });
  });

  it.each(["source-server-upgrade-required", "source-server-install-required"])(
    "%s 的实际 Profile 和 WSL 身份透传到平台结果",
    async (code) => {
      const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
      const resolved = { resolvedWslTarget: { kind: "wsl", distro: "Ubuntu", user: "dev" } };
      const { handler } = await registerHarness({
        createRemoteWorkspaceSession: vi.fn(async () => {
          throw Object.assign(new Error("upgrade required"), {
            code,
            retryable: false,
            profileId,
            ...resolved,
          });
        }),
      });
      await expect(handler({ sender: { id: 74 } }, { target: { kind: "wsl" } })).resolves.toEqual({
        success: false,
        error: "upgrade required",
        reasonCode: code,
        retryable: false,
        profileId,
        ...resolved,
      });
    },
  );
});
