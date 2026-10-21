import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostMessageTypes, HostResponseTypes } from "@zcode/shared";
import {
  disposeHostProcess,
  disposeHostProcessAndWait,
  listDisposingHostProcesses,
  loadWindow,
  spawnHostProcess,
} from "../src/main/desktopHostProcess.js";

vi.mock("../src/main/databaseStartupRelay.js", () => ({
  bindDatabaseStartupRelay: (_win: unknown, _child: unknown, startupId: string) => ({
    receive: vi.fn(),
    startupId,
  }),
}));

const electronMock = vi.hoisted(() => ({
  fork: vi.fn(),
  isPackaged: false,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  electronMock.isPackaged = false;
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/zcode-test"),
    get isPackaged() {
      return electronMock.isPackaged;
    },
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  MessageChannelMain: class {
    port1 = {};
    port2 = {};
  },
  utilityProcess: {
    fork: electronMock.fork,
  },
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}));

class MockUtilityProcess extends EventEmitter {
  pid: number | undefined = 12345;
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}

describe("desktopHostProcess loadWindow", () => {
  it("生产包忽略继承的开发服务器地址并加载内置页面", async () => {
    electronMock.isPackaged = true;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5174");
    const window = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
    };

    await loadWindow(window as never);

    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledOnce();
  });
});

describe("desktopHostProcess CUA operation state routing", () => {
  it("routes schema-validated Agent exceptions without changing task or process registration", () => {
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const onAgentProcessException = vi.fn();
    spawnHostProcess(
      { id: 7, webContents: { id: 11, postMessage: vi.fn() } } as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "/repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
        onAgentProcessException,
      },
    );
    const event = {
      type: "agent-process-exception",
      pid: 123,
      provider: "glm",
      workspacePath: "/repo",
      runtimeGeneration: 1,
      runtimeInstanceId: "agent-test",
      diagnostic: {
        version: 1,
        errorId: "1f51b7dc-c52a-46ad-bc97-d2f984e6e3de",
        kind: "uncaughtException",
        origin: "uncaughtException",
        name: "Error",
        message: "probe",
        occurredAt: 123,
      },
    };
    const init = child.postMessage.mock.calls[0]![0];
    expect(init.databaseStartupId).toEqual(expect.any(String));
    child.emit("message", { ...event, diagnostic: { ...event.diagnostic, version: 2 } });
    expect(onAgentProcessException).not.toHaveBeenCalled();
    child.emit("message", event);
    expect(onAgentProcessException).toHaveBeenCalledExactlyOnceWith(event);
    child.emit("exit", 0);
  });
});

describe("desktopHostProcess local media preview authorization", () => {
  it("returns the canonical path produced by Main to the requesting Host", async () => {
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const authorizeLocalMediaPreviewPath = vi.fn(async () => "/real/video.mp4");
    const win = {
      id: 7,
      webContents: {
        id: 11,
        postMessage: vi.fn(),
      },
    };

    spawnHostProcess(
      win as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "/repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
        authorizeLocalMediaPreviewPath,
      },
    );

    child.emit("message", {
      type: HostResponseTypes.LocalMediaPreviewPathAuthorizeRequest,
      requestId: "preview-request-1",
      path: "/linked/video.mp4",
    });

    await vi.waitFor(() => {
      expect(authorizeLocalMediaPreviewPath).toHaveBeenCalledWith("/linked/video.mp4");
      expect(child.postMessage).toHaveBeenCalledWith({
        type: HostMessageTypes.LocalMediaPreviewPathAuthorizeResult,
        requestId: "preview-request-1",
        ok: true,
        path: "/real/video.mp4",
      });
    });
  });
});

describe("desktopHostProcess disposeHostProcessAndWait", () => {
  it("fire-and-forget 回收中的 Host 保留到 exit，供 app barrier 接管", () => {
    const child = new MockUtilityProcess();
    const timers = new WeakMap();
    const logger = { info: vi.fn(), warn: vi.fn() };

    disposeHostProcess(child as never, "window-closed", timers, logger, 10_000);
    expect(listDisposingHostProcesses()).toContain(child);

    child.emit("exit", 0);
    expect(listDisposingHostProcesses()).not.toContain(child);
  });

  it("运行中的 Electron UtilityProcess 没有 exitCode 时仍会发送 Dispose 并等待退出", async () => {
    const child = new MockUtilityProcess();
    const timers = new WeakMap();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    let resolved = false;

    const promise = disposeHostProcessAndWait(child as never, "app-before-quit-1", timers, logger, {
      forceKillDelayMs: 10_000,
      waitTimeoutMs: 10_000,
    }).then(() => {
      resolved = true;
    });

    expect(child.postMessage).toHaveBeenCalledTimes(1);
    expect(child.postMessage).toHaveBeenCalledWith({ type: HostMessageTypes.Dispose });

    await Promise.resolve();
    expect(resolved).toBe(false);

    child.pid = undefined;
    child.emit("exit", 0);

    await promise;
    expect(resolved).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("已观察到退出的 Electron UtilityProcess 不再重复发送 Dispose", async () => {
    const child = new MockUtilityProcess();

    const timers = new WeakMap();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const firstDispose = disposeHostProcessAndWait(child as never, "first-dispose", timers, logger);

    child.pid = undefined;
    child.emit("exit", 0);
    await firstDispose;

    await disposeHostProcessAndWait(child as never, "already-exited", timers, logger);

    expect(child.postMessage).toHaveBeenCalledTimes(1);
  });
});
