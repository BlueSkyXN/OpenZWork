import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels, type WebRemoteControlContext } from "@zcode/shared";
import type { WebRemoteControlStartAuthorization } from "../src/main/webRemoteControlManager.js";

type IpcHandler = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: h.fromWebContents },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => h.handlers.set(channel, handler)),
  },
}));
function fixture() {
  const authorization: WebRemoteControlStartAuthorization = {
    token: "ticket-1",
    expiresAt: Date.now() + 30_000,
    windowId: 17,
    workspaceKey: "/workspace/local",
  };
  return {
    authorization,
    manager: {
      authorizeStart: vi.fn(() => authorization),
      startAuthorized: vi.fn(async () => ({ status: "running" as const })),
      resetPairingAuthorized: vi.fn(async () => ({ status: "running" as const })),
      stop: vi.fn(async () => {}),
      getStatus: vi.fn(() => ({ status: "idle" as const })),
    },
  };
}

describe("Web Remote Control HMAC pairing IPC", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.fromWebContents.mockReset();
    h.fromWebContents.mockReturnValue({ id: 17 });
  });
  it("拒绝没有真实窗口的启动和配对刷新", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    const { manager } = fixture();
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: manager });
    h.fromWebContents.mockReturnValue(null);
    for (const channel of [
      PlatformChannels.StartWebRemoteControl,
      PlatformChannels.ResetWebRemoteControlPairing,
    ]) {
      await expect(
        h.handlers.get(channel)!({ sender: { id: 73 } }, { workspacePath: "/workspace/local" }),
      ).rejects.toThrow("未找到当前窗口");
    }
    expect(manager.authorizeStart).not.toHaveBeenCalled();
    expect(manager.startAuthorized).not.toHaveBeenCalled();
    expect(manager.resetPairingAuthorized).not.toHaveBeenCalled();
  });
  it("显式启动绑定发送者窗口和 workspace", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    const { manager, authorization } = fixture();
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: manager });
    const context: WebRemoteControlContext = { workspacePath: "/workspace/local" };
    await expect(
      h.handlers.get(PlatformChannels.StartWebRemoteControl)!({ sender: { id: 73 } }, context),
    ).resolves.toEqual({ status: "running" });
    expect(manager.authorizeStart).toHaveBeenCalledWith(17, context);
    expect(manager.startAuthorized).toHaveBeenCalledWith(17, context, authorization);
    expect(manager.resetPairingAuthorized).not.toHaveBeenCalled();
  });
  it("注册 start/resetPairing/stop/status 四个操作", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: fixture().manager });
    expect([...h.handlers.keys()].sort()).toEqual(
      [
        PlatformChannels.StartWebRemoteControl,
        PlatformChannels.ResetWebRemoteControlPairing,
        PlatformChannels.StopWebRemoteControl,
        PlatformChannels.GetWebRemoteControlStatus,
      ].sort(),
    );
  });
  it("启动失败保留 manager 返回的原错误", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    const { manager } = fixture();
    const error = new Error("relay websocket closed");
    manager.startAuthorized.mockRejectedValue(error);
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: manager });
    await expect(
      h.handlers.get(PlatformChannels.StartWebRemoteControl)!(
        { sender: { id: 75 } },
        { workspacePath: "/workspace/local" },
      ),
    ).rejects.toBe(error);
  });
  it("停止和状态查询使用发送者所属窗口，窗口关闭后返回 idle", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    const { manager } = fixture();
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: manager });
    await h.handlers.get(PlatformChannels.StopWebRemoteControl)!({ sender: { id: 76 } });
    expect(manager.stop).toHaveBeenCalledWith(17);
    expect(
      h.handlers.get(PlatformChannels.GetWebRemoteControlStatus)!({ sender: { id: 76 } }),
    ).toEqual({ status: "idle" });
    expect(manager.getStatus).toHaveBeenCalledWith(17);
    h.fromWebContents.mockReturnValue(null);
    await h.handlers.get(PlatformChannels.StopWebRemoteControl)!({ sender: { id: 76 } });
    expect(manager.stop).toHaveBeenCalledOnce();
    expect(
      h.handlers.get(PlatformChannels.GetWebRemoteControlStatus)!({ sender: { id: 76 } }),
    ).toEqual({ status: "idle" });
  });
  it("配对刷新使用同一目标绑定票据并调用真实 resetPairing 操作", async () => {
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    const { manager, authorization } = fixture();
    registerWebRemoteControlIpcHandlers({ webRemoteControlManager: manager });
    const context: WebRemoteControlContext = { workspacePath: "/workspace/local" };
    await expect(
      h.handlers.get(PlatformChannels.ResetWebRemoteControlPairing)!(
        { sender: { id: 78 } },
        context,
      ),
    ).resolves.toEqual({ status: "running" });
    expect(manager.authorizeStart).toHaveBeenCalledWith(17, context);
    expect(manager.resetPairingAuthorized).toHaveBeenCalledWith(17, context, authorization);
    expect(manager.startAuthorized).not.toHaveBeenCalled();
  });
});
