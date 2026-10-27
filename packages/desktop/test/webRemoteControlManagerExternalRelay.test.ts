import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  HostPreparedProjectWorkspace,
  HostProjectWorkspaceNavigationInput,
  WebRemoteControlAppPayload,
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceTarget,
} from "@zcode/shared";
import {
  parseWebRemoteControlAppPayload,
  encodeWebRemoteControlRpcTransportMessage,
} from "@zcode/shared";
import { createWebRemoteControlManager } from "../src/main/webRemoteControlManager.js";
import { createWebRemoteControlFeatureGate } from "../src/main/webRemoteControlFeatureGate.js";

function createFakePort() {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  };
}

type AttachWorkspaceHost = Parameters<
  typeof createWebRemoteControlManager
>[0]["attachWorkspaceHost"];

function createManagerHarness(options?: {
  connectionProvider?: Parameters<typeof createWebRemoteControlManager>[0]["connectionProvider"];
  featureEnabled?: boolean;
  delayReadyMs?: number;
  canSendPayload?: () => boolean;
  storedAuth?: { deviceSid: string; passHash: string };
  registeredAuths?: Array<{ deviceSid: string; passHash: string }>;
  startupRestoreContext?: NonNullable<AppSettings["webRemoteControlLastEnabledContext"]>;
  startupRestoreClearError?: Error;
  loadAuth?: () => Promise<{ deviceSid: string; passHash: string } | undefined>;
  loadStartupRestore?: () => Promise<
    NonNullable<AppSettings["webRemoteControlLastEnabledContext"]> | undefined
  >;
  attachWorkspaceHost?: AttachWorkspaceHost;
  releaseWorkspaceHostAttachment?: (attachmentId: string) => void;
  disposeWorkspaceHostAttachmentsForWindow?: (windowId: number, reason: string) => void;
  disposeWorkspaceHostAttachmentsForRemoteSession?: (
    remoteSessionId: string,
    reason: string,
  ) => void;
  reconnectWorkspace?: (windowId: number, workspaceKey: string) => Promise<void>;
  prepareProjectWorkspace?: (
    windowId: number,
    project: HostProjectWorkspaceNavigationInput,
    requestId: string,
  ) => Promise<HostPreparedProjectWorkspace>;
  onStatusChanged?: Parameters<typeof createWebRemoteControlManager>[0]["onStatusChanged"];
  getEndpointUrls?: Parameters<typeof createWebRemoteControlManager>[0]["getEndpointUrls"];
}) {
  const sentPayloads: WebRemoteControlAppPayload[] = [];
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const settings: AppSettings = { recentProjects: [], locale: "zh-CN" };
  let storedAuth = options?.storedAuth;
  let startupRestoreContext = options?.startupRestoreContext;
  let transportStartCount = 0;
  let deliverPayload: ((payload: WebRemoteControlAppPayload) => void) | undefined;
  let latestTransportOptions:
    | Parameters<
        NonNullable<Parameters<typeof createWebRemoteControlManager>[0]["createDeviceTransport"]>
      >[0]
    | undefined;
  let emitTransportState:
    | Parameters<
        NonNullable<Parameters<typeof createWebRemoteControlManager>[0]["createDeviceTransport"]>
      >[0]["onStateChange"]
    | undefined;
  const disposeTransport = vi.fn();
  const defaultAttachWorkspaceHost = vi.fn(async () => ({
    entryId: "entry-1",
    attachmentId: "attachment-1",
    process: {} as never,
    port: createFakePort() as never,
  }));
  const releaseWorkspaceHostAttachment = options?.releaseWorkspaceHostAttachment ?? vi.fn();
  const disposeWorkspaceHostAttachmentsForWindow =
    options?.disposeWorkspaceHostAttachmentsForWindow ?? vi.fn();
  const disposeWorkspaceHostAttachmentsForRemoteSession =
    options?.disposeWorkspaceHostAttachmentsForRemoteSession ?? vi.fn();
  const manager = createWebRemoteControlManager({
    connectionProvider: options?.connectionProvider,
    relayWsUrl: "ws://relay.test/ws",
    mobileRemoteControlUrl: "https://relay.test/remote/v3",
    getEndpointUrls: options?.getEndpointUrls,
    deviceMid: "mid-1",
    deviceName: "MacBook",
    appVersion: "1.5.0",
    authProvider: {
      createPassword: () => "password",
      createPassHash: () => "hash-1",
      calculateProof: () => "proof",
    },
    authStorageProvider: {
      load: options?.loadAuth ?? (async () => storedAuth),
      save: async (auth) => {
        storedAuth = auth;
        settings.webRemoteControlExternalRelayDevice = { deviceSid: auth.deviceSid };
      },
      clear: async () => {
        storedAuth = undefined;
        settings.webRemoteControlExternalRelayDevice = undefined;
      },
      rotate: async () => {},
    },
    startupRestoreStorageProvider: {
      load: options?.loadStartupRestore ?? (async () => startupRestoreContext),
      save: async (context) => {
        startupRestoreContext = context;
      },
      clear: async () => {
        if (options?.startupRestoreClearError) {
          throw options.startupRestoreClearError;
        }
        startupRestoreContext = undefined;
      },
    },
    featureGate: createWebRemoteControlFeatureGate(options?.featureEnabled ?? true),
    logger,
    platformHandlers: {
      isDockerAvailable: async () => true,
      listWSLDistros: async () => [],
      listDockerContainers: async () => [],
      listSSHConfigAliases: async () => [],
      loadMcpFromUserDirectory: async () => ({ servers: [] }),
      saveMcpToUserDirectory: async () => ({ success: true }),
      migrateLegacyCommonMcp: async () => ({
        servers: {},
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
      }),
    },
    reconnectWorkspace: options?.reconnectWorkspace ?? vi.fn(async () => undefined),
    prepareProjectWorkspace: options?.prepareProjectWorkspace,
    attachWorkspaceHost: options?.attachWorkspaceHost ?? defaultAttachWorkspaceHost,
    releaseWorkspaceHostAttachment,
    disposeWorkspaceHostAttachmentsForWindow,
    disposeWorkspaceHostAttachmentsForRemoteSession,
    onStatusChanged: options?.onStatusChanged,
    createDeviceTransport: (transportOptions) => ({
      start: () => {
        latestTransportOptions = transportOptions;
        transportStartCount += 1;
        emitTransportState = transportOptions.onStateChange;
        const markReady = () => {
          const registeredAuth = options?.registeredAuths?.[transportStartCount - 1] ?? {
            deviceSid: "sid-1",
            passHash: "hash-1",
          };
          deliverPayload = transportOptions.onPayload;
          if (transportOptions.auth.mode === "register") {
            transportOptions.onRegisteredAuth(registeredAuth);
          }
          transportOptions.onStateChange("waiting_terminal");
        };
        if (options?.delayReadyMs !== undefined) {
          setTimeout(markReady, options.delayReadyMs);
          return;
        }
        markReady();
      },
      sendPayload: (payload) => {
        if (options?.canSendPayload && !options.canSendPayload()) {
          return false;
        }
        sentPayloads.push(payload);
        return true;
      },
      measurePayloadBytes: (payload) => JSON.stringify(payload).length,
      sendPayloadResult: (payload) => {
        if (options?.canSendPayload && !options.canSendPayload()) {
          return { kind: "unavailable" as const };
        }
        sentPayloads.push(payload);
        return { kind: "sent" as const, bytes: JSON.stringify(payload).length };
      },
      dispose: disposeTransport,
    }),
  });

  return {
    defaultAttachWorkspaceHost,
    disposeWorkspaceHostAttachmentsForRemoteSession,
    disposeWorkspaceHostAttachmentsForWindow,
    disposeTransport,
    manager,
    logger,
    releaseWorkspaceHostAttachment,
    sentPayloads,
    getStoredAuth: () => storedAuth,
    getStartupRestoreContext: () => startupRestoreContext,
    getLatestTransportOptions: () => latestTransportOptions,
    deliverPayload: (payload: WebRemoteControlAppPayload) => {
      if (!deliverPayload) {
        throw new Error("transport not started");
      }
      deliverPayload(payload);
    },
    emitTransportState: (state: Parameters<NonNullable<typeof emitTransportState>>[0]) => {
      if (!emitTransportState) {
        throw new Error("transport not started");
      }
      emitTransportState(state);
    },
    emitTransportSendReady: (kind: "same-socket" | "reconnected-socket") => {
      if (!latestTransportOptions?.onSendReady) {
        throw new Error("transport not started");
      }
      latestTransportOptions.onSendReady({ kind });
    },
  };
}

const localWorkspace: WebRemoteControlWorkspaceTarget = {
  workspacePath: "/workspace/demo",
  label: "demo",
  kind: "local",
};

const remoteWorkspace: WebRemoteControlWorkspaceTarget = {
  workspacePath: "/workspace/remote",
  workspaceIdentity: "remote:ssh:host:/workspace/remote",
  remoteSessionId: "remote-session-1",
  label: "remote",
  kind: "remote",
  connectionState: "connected",
};

async function createPrimedWorkspaceSyncHarness(
  workspaceOverrides: Partial<WebRemoteControlWorkspaceTarget> = {},
) {
  const harness = createManagerHarness();
  await harness.manager.start(1, { workspacePath: localWorkspace.workspacePath });
  const workspace = { ...remoteWorkspace, ...workspaceOverrides };
  harness.manager.syncAvailableWorkspaces(1, [workspace]);
  harness.sentPayloads.length = 0;
  return { ...harness, workspace };
}

describe("createWebRemoteControlManager external relay", () => {
  it.each(["updatedAt", "createdAt"] as const)(
    "仅 %s 变化时推送最新任务时间与排序，重复投影仍去重",
    async (timeField) => {
      const h = createManagerHarness();
      await h.manager.start(1, { workspacePath: localWorkspace.workspacePath });
      try {
        const taskA: WebRemoteControlTaskTarget = {
          taskId: "task-a",
          title: "任务 A",
          workspacePath: localWorkspace.workspacePath,
          workspaceLabel: localWorkspace.label,
          workspaceKind: "local",
          createdAt: 1,
          updatedAt: 100,
          displayStatus: "running",
          [timeField]: 20,
        };
        const taskB = { ...taskA, taskId: "task-b", title: "任务 B", [timeField]: 10 };
        h.manager.syncAvailableTasks(1, [taskB, taskA]);
        expect(h.sentPayloads).toContainEqual({
          zcode_type: "workspace-list-updated",
          result: expect.objectContaining({ tasks: [taskA, taskB] }),
        });
        h.sentPayloads.length = 0;

        // OW-P009：状态仍为 running 时仅时间变化，旧签名会吞掉这次真实活动。
        const activeB = { ...taskB, [timeField]: 15 };
        h.manager.syncAvailableTasks(1, [activeB, taskA]);
        expect([...h.sentPayloads]).toEqual([
          {
            zcode_type: "workspace-list-updated",
            result: expect.objectContaining({ tasks: [taskA, activeB] }),
          },
        ]);
        h.sentPayloads.length = 0;

        const latestB = { ...taskB, [timeField]: 30 };
        h.manager.syncAvailableTasks(1, [taskA, latestB]);
        expect([...h.sentPayloads]).toEqual([
          {
            zcode_type: "workspace-list-updated",
            result: expect.objectContaining({ tasks: [latestB, taskA] }),
          },
        ]);
        h.sentPayloads.length = 0;
        h.manager.syncAvailableTasks(1, [latestB, { ...taskA }]);
        expect(h.sentPayloads).toEqual([]);

        h.deliverPayload({ zcode_type: "bootstrap-request", requestId: "latest-task-times" });
        expect([...h.sentPayloads]).toContainEqual({
          zcode_type: "bootstrap-response",
          requestId: "latest-task-times",
          success: true,
          result: expect.objectContaining({ tasks: [latestB, taskA] }),
        });
      } finally {
        await h.manager.disposeWindow(1);
      }
    },
  );

  it("returns the desktop's own version before a workspace bridge is attached", async () => {
    const h = createManagerHarness();
    await h.manager.start(1, { workspacePath: localWorkspace.workspacePath });
    h.deliverPayload({ zcode_type: "bootstrap-request", requestId: "version-check" });
    expect(h.sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "bootstrap-response",
        requestId: "version-check",
        result: expect.objectContaining({ desktopAppVersion: "1.5.0" }),
      }),
    );
    expect(h.defaultAttachWorkspaceHost).not.toHaveBeenCalled();
    await h.manager.stop(1);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("授权票据绑定窗口与工作区，并且只能消费一次", async () => {
    const { manager } = createManagerHarness();
    const context = { workspacePath: localWorkspace.workspacePath };
    const authorization = manager.authorizeStart(1, context);

    await manager.startAuthorized(1, context, authorization);
    await expect(manager.startAuthorized(1, context, authorization)).rejects.toThrow(
      "already used",
    );
    await manager.stop(1);
  });

  it("停止窗口远控时会作废尚未消费的授权票据", async () => {
    const { manager } = createManagerHarness();
    const context = { workspacePath: localWorkspace.workspacePath };
    const authorization = manager.authorizeStart(1, context);

    await manager.stop(1);

    await expect(manager.startAuthorized(1, context, authorization)).rejects.toThrow("invalid");
  });

  it("授权票据拒绝窗口或 workspace 目标不匹配", async () => {
    const { manager } = createManagerHarness();
    const context = { workspacePath: localWorkspace.workspacePath };
    const authorization = manager.authorizeStart(1, context);

    await expect(manager.startAuthorized(2, context, authorization)).rejects.toThrow(
      "target mismatch",
    );
    await expect(manager.startAuthorized(1, context, authorization)).rejects.toThrow(
      "already used",
    );
  });

  it("授权票据超过短 TTL 后不可消费", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00Z"));
    const { manager } = createManagerHarness();
    const context = { workspacePath: localWorkspace.workspacePath };
    const authorization = manager.authorizeStart(1, context);

    vi.advanceTimersByTime(30_001);

    await expect(manager.startAuthorized(1, context, authorization)).rejects.toThrow("expired");
  });

  it("远程 shared-host attachment 成功后发送 bridge ready", async () => {
    const attachWorkspaceHost = vi.fn(async () => ({
      entryId: "entry-remote",
      attachmentId: "attachment-remote",
      process: {} as never,
      port: createFakePort() as never,
      remoteKind: "ssh" as const,
    }));
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, {
      workspacePath: remoteWorkspace.workspacePath,
      workspaceIdentity: remoteWorkspace.workspaceIdentity,
      remoteSessionId: remoteWorkspace.remoteSessionId,
    });
    manager.syncAvailableWorkspaces(1, [remoteWorkspace]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "bridge-request-remote",
      bridgeSessionId: "bridge-remote",
      workspaceKey: remoteWorkspace.workspaceIdentity!,
      taskId: "task-1",
    });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          requestId: "bridge-request-remote",
          bridgeSessionId: "bridge-remote",
          bridge: expect.objectContaining({
            kind: "remote",
            workspaceIdentity: remoteWorkspace.workspaceIdentity,
          }),
        }),
      ),
    );
  });

  it("bridge attachment 失败经现有错误响应返回", async () => {
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => {
      throw Object.assign(new Error("secret-host.example.com attach failed"), {
        code: "REMOTE_SESSION_MISSING",
      });
    });
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, { workspacePath: localWorkspace.workspacePath });
    manager.syncAvailableWorkspaces(1, [localWorkspace]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "bridge-request-failed",
      bridgeSessionId: "bridge-failed",
      workspaceKey: localWorkspace.workspacePath,
    });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          requestId: "bridge-request-failed",
          bridgeSessionId: "bridge-failed",
        }),
      ),
    );
  });

  it("matches remote workspace bridge requests by workspace identity and strips legacy bridge fields", async () => {
    const { deliverPayload, manager, sentPayloads } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "remote-session-1",
    });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/demo",
        workspaceIdentity: "remote:ssh:host:/workspace/demo",
        remoteSessionId: "remote-session-1",
        label: "demo",
        kind: "remote",
      },
    ]);

    const status = manager.getStatus(1);
    expect(status.qrUrl).toContain("/remote/v3?");

    sentPayloads.length = 0;
    deliverPayload({
      zcode_type: "workspace-bridge-open" as const,
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      workspaceKey: "remote:ssh:host:/workspace/demo",
    });

    await vi.waitFor(() => {
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridgeSessionId: "bridge-1",
          bridge: expect.objectContaining({
            kind: "remote",
            workspaceKey: "remote:ssh:host:/workspace/demo",
            workspaceIdentity: "remote:ssh:host:/workspace/demo",
            capabilities: { windowProjectDirectory: true },
          }),
        }),
      );
    });
    const readyPayload = sentPayloads.find(
      (payload) => payload.zcode_type === "workspace-bridge-ready",
    );
    expect(JSON.stringify(readyPayload)).not.toContain("bridgeToken");
    expect(JSON.stringify(readyPayload)).not.toContain("wsUrl");
  });

  it("uses the current endpoint resolver for relay and QR URL on each start", async () => {
    const { getLatestTransportOptions, manager } = createManagerHarness({
      // 当前 resolver 由宿主提供，fixture 显式给出保留的 relay 与手机入口。
      getEndpointUrls: () =>
        ({
          relayWsUrl: "ws://localhost:3030/ws",
          remoteUrl: "http://localhost:3030/remote/v3",
        }) as never,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    const status = manager.getStatus(1);

    expect(getLatestTransportOptions()?.relayWsUrl).toBe("ws://localhost:3030/ws");
    expect(status.qrUrl).toContain("http://localhost:3030/remote/v3?");
  });

  it("does not append theme params to the mobile QR URL", async () => {
    const { manager } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      theme: "zai-dark",
    });

    const status = manager.getStatus(1);
    expect(status.qrUrl).not.toContain("theme=");
  });

  it("persists successful enablement and clears it only after an explicit stop", async () => {
    const { getStartupRestoreContext, manager } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "ephemeral-session",
      initialTaskId: "task-1",
      theme: "zai-dark",
    });

    expect(getStartupRestoreContext()).toEqual({
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      initialTaskId: "task-1",
    });

    await manager.suspend(1, "endpoint-changed");
    expect(getStartupRestoreContext()).toEqual({
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      initialTaskId: "task-1",
    });

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "ephemeral-session",
      initialTaskId: "task-1",
    });

    await manager.disposeWindow(1);
    expect(getStartupRestoreContext()).toEqual({
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      initialTaskId: "task-1",
    });

    await manager.stop(1);
    expect(getStartupRestoreContext()).toBeUndefined();
  });

  it("stops the active runtime when clearing startup recovery state fails", async () => {
    const { disposeTransport, disposeWorkspaceHostAttachmentsForWindow, manager } =
      createManagerHarness({
        startupRestoreClearError: new Error("settings write failed"),
      });
    await manager.start(1, { workspacePath: "/workspace/demo" });

    await expect(manager.stop(1)).rejects.toThrow("settings write failed");

    expect(manager.getStatus(1)).toEqual({ status: "idle" });
    expect(disposeTransport).toHaveBeenCalledOnce();
    expect(disposeWorkspaceHostAttachmentsForWindow).toHaveBeenCalledWith(1, "manual-stop");
  });

  it("restores the previous target only after its current workspace context is available", async () => {
    const { getStartupRestoreContext, getLatestTransportOptions, manager } = createManagerHarness({
      startupRestoreContext: {
        workspacePath: "/workspace/demo",
        workspaceIdentity: "remote:ssh:host:/workspace/demo",
        initialTaskId: "task-1",
      },
    });

    await expect(
      manager.restorePreviouslyEnabled(1, [{ workspacePath: "/workspace/other" }]),
    ).resolves.toBe(false);
    expect(manager.getStatus(1)).toEqual({ status: "idle" });

    await expect(
      manager.restorePreviouslyEnabled(1, [
        {
          workspacePath: "/workspace/demo",
          workspaceIdentity: "remote:ssh:host:/workspace/demo",
          remoteSessionId: "current-session",
        },
      ]),
    ).resolves.toBe(true);

    expect(manager.getStatus(1)).toEqual(
      expect.objectContaining({
        status: "running",
        workspaceIdentity: "remote:ssh:host:/workspace/demo",
        remoteSessionId: "current-session",
        initialTaskId: "task-1",
      }),
    );
    expect(getLatestTransportOptions()).toBeDefined();
    expect(getStartupRestoreContext()).toEqual({
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      initialTaskId: "task-1",
    });
  });

  it("does not revive a stopped startup while HMAC storage is loading", async () => {
    let resolveAuth!: (value: { deviceSid: string; passHash: string }) => void;
    const loadAuth = vi.fn(
      () =>
        new Promise<{ deviceSid: string; passHash: string }>((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const f = createManagerHarness({ loadAuth });
    const start = f.manager.start(1, { workspacePath: "/workspace/demo" });
    const rejected = expect(start).rejects.toThrow();
    await vi.waitFor(() => expect(loadAuth).toHaveBeenCalledOnce());
    await f.manager.stop(1);
    resolveAuth({ deviceSid: "old-sid", passHash: "old-hash" });
    await rejected;
    expect(f.manager.getStatus(1)).toEqual({ status: "idle" });
    expect(f.getLatestTransportOptions()).toBeUndefined();
    expect(f.getStartupRestoreContext()).toBeUndefined();
  });

  it("ignores a slow restore read after manual stop", async () => {
    let resolveContext!: (value: { workspacePath: string }) => void;
    const loadStartupRestore = vi.fn(
      () =>
        new Promise<{ workspacePath: string }>((resolve) => {
          resolveContext = resolve;
        }),
    );
    const f = createManagerHarness({ loadStartupRestore });
    const restore = f.manager.restorePreviouslyEnabled(1, [localWorkspace]);
    await f.manager.stop(1);
    resolveContext({ workspacePath: localWorkspace.workspacePath });
    await expect(restore).resolves.toBe(false);
    expect(f.manager.getStatus(1)).toEqual({ status: "idle" });
    expect(f.getLatestTransportOptions()).toBeUndefined();
  });

  it("restores from the latest workspace snapshot after storage completes", async () => {
    let resolveContext!: (value: { workspacePath: string; workspaceIdentity: string }) => void;
    const loadStartupRestore = () =>
      new Promise<{ workspacePath: string; workspaceIdentity: string }>((resolve) => {
        resolveContext = resolve;
      });
    const f = createManagerHarness({ loadStartupRestore });
    const restore = f.manager.restorePreviouslyEnabled(1, [remoteWorkspace]);
    f.manager.syncAvailableWorkspaces(1, [
      { ...remoteWorkspace, remoteSessionId: "latest-session" },
    ]);
    resolveContext({
      workspacePath: remoteWorkspace.workspacePath,
      workspaceIdentity: remoteWorkspace.workspaceIdentity!,
    });
    await expect(restore).resolves.toBe(true);
    expect(f.manager.getStatus(1).remoteSessionId).toBe("latest-session");
    await f.manager.stop(1);
  });

  it("does not restore a workspace removed while storage was loading", async () => {
    let resolveContext!: (value: { workspacePath: string }) => void;
    const loadStartupRestore = () =>
      new Promise<{ workspacePath: string }>((resolve) => {
        resolveContext = resolve;
      });
    const f = createManagerHarness({ loadStartupRestore });
    const restore = f.manager.restorePreviouslyEnabled(1, [localWorkspace]);
    f.manager.syncAvailableWorkspaces(1, []);
    resolveContext({ workspacePath: localWorkspace.workspacePath });
    await expect(restore).resolves.toBe(false);
    expect(f.getLatestTransportOptions()).toBeUndefined();
  });

  it("resets persisted relay auth and returns a new QR URL when refreshing leaked pairing material", async () => {
    const disposeWorkspaceHostAttachmentsForWindow = vi.fn();
    const { disposeTransport, getStoredAuth, manager } = createManagerHarness({
      storedAuth: { deviceSid: "sid-old", passHash: "hash-old" },
      registeredAuths: [
        { deviceSid: "sid-unused", passHash: "hash-unused" },
        { deviceSid: "sid-new", passHash: "hash-new" },
      ],
      disposeWorkspaceHostAttachmentsForWindow,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    const oldStatus = manager.getStatus(1);
    expect(oldStatus.qrUrl).toContain("sid=sid-old");
    expect(oldStatus.qrUrl).toContain("hash=hash-old");

    const refreshed = await manager.resetPairing(1, {
      workspacePath: "/workspace/demo",
    });

    expect(refreshed.qrUrl).toContain("sid=sid-new");
    expect(refreshed.qrUrl).toContain("hash=hash-new");
    expect(refreshed.qrUrl).not.toContain("sid=sid-old");
    expect(refreshed.qrUrl).not.toContain("hash=hash-old");
    expect(getStoredAuth()).toEqual({ deviceSid: "sid-new", passHash: "hash-new" });
    expect(disposeTransport).toHaveBeenCalledTimes(1);
    expect(disposeWorkspaceHostAttachmentsForWindow).toHaveBeenCalledWith(1, "leaked-qr");
  });

  it("does not clear persisted relay auth when refreshing pairing is blocked by the feature gate", async () => {
    const { disposeTransport, getStoredAuth, manager } = createManagerHarness({
      featureEnabled: false,
      storedAuth: { deviceSid: "sid-old", passHash: "hash-old" },
    });

    await expect(manager.resetPairing(1, { workspacePath: "/workspace/demo" })).rejects.toThrow(
      "Web remote control is disabled in this build",
    );

    expect(getStoredAuth()).toEqual({ deviceSid: "sid-old", passHash: "hash-old" });
    expect(disposeTransport).not.toHaveBeenCalled();
  });

  it("releases only the previous attachment when mobile reconnects to the same workspace", async () => {
    let nextAttachmentId = 0;
    const attachWorkspaceHost = vi.fn(async () => ({
      entryId: "entry-1",
      attachmentId: `attachment-${++nextAttachmentId}`,
      process: {} as never,
      port: createFakePort() as never,
    }));
    const releaseWorkspaceHostAttachment = vi.fn();
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
      releaseWorkspaceHostAttachment,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);

    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
      taskId: "task-1",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(expect.objectContaining({ bridgeSessionId: "bridge-1" })),
    );

    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-2",
      bridgeSessionId: "bridge-2",
      workspaceKey: "/workspace/demo",
      taskId: "task-1",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(expect.objectContaining({ bridgeSessionId: "bridge-2" })),
    );

    expect(attachWorkspaceHost).toHaveBeenCalledTimes(2);
    expect(attachWorkspaceHost).toHaveBeenLastCalledWith(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: undefined,
      remoteSessionId: undefined,
      initialTaskId: "task-1",
      kind: "local",
    });
    expect(releaseWorkspaceHostAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("lists disconnected remote workspaces but does not create a bridge before reconnect", async () => {
    const { deliverPayload, manager, sentPayloads } = createManagerHarness();

    await manager.start(1, { workspacePath: "/workspace/local" });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/remote",
        workspaceIdentity: "remote:ssh:host:/workspace/remote",
        label: "remote",
        kind: "remote",
        connectionState: "disconnected",
        lastConnectionError: "ssh closed",
      },
    ]);

    sentPayloads.length = 0;
    deliverPayload({ zcode_type: "workspace-list-request", requestId: "list-1" });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-list-response",
          result: expect.objectContaining({
            workspaces: expect.arrayContaining([
              expect.objectContaining({
                workspaceIdentity: "remote:ssh:host:/workspace/remote",
                connectionState: "disconnected",
                lastConnectionError: "ssh closed",
              }),
            ]),
          }),
        }),
      ),
    );

    sentPayloads.length = 0;
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "bridge-req-1",
      bridgeSessionId: "bridge-disconnected",
      workspaceKey: "remote:ssh:host:/workspace/remote",
    });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          bridgeSessionId: "bridge-disconnected",
        }),
      ),
    );
  });

  it.each([
    ["connectionState", {}, { connectionState: "reconnecting" }],
    ["remoteSessionId", {}, { remoteSessionId: "remote-session-2" }],
    [
      "lastConnectionError",
      { connectionState: "disconnected", lastConnectionError: "ssh closed" },
      { lastConnectionError: "authentication failed" },
    ],
  ] satisfies Array<
    [string, Partial<WebRemoteControlWorkspaceTarget>, Partial<WebRemoteControlWorkspaceTarget>]
  >)("pushes workspace list updates when workspace %s changes", async (_field, initial, patch) => {
    const { manager, sentPayloads, workspace } = await createPrimedWorkspaceSyncHarness(initial);

    manager.syncAvailableWorkspaces(1, [{ ...workspace, ...patch }]);

    expect(sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "workspace-list-updated",
        result: expect.objectContaining({
          workspaces: expect.arrayContaining([
            expect.objectContaining({
              workspaceIdentity: workspace.workspaceIdentity,
              ...patch,
            }),
          ]),
        }),
      }),
    );
  });

  it("forwards mobile workspace reconnect requests to the desktop renderer", async () => {
    const reconnectWorkspace = vi.fn(async () => undefined);
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      reconnectWorkspace,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });

    deliverPayload({
      zcode_type: "workspace-reconnect-request",
      requestId: "reconnect-1",
      workspaceKey: "remote:ssh:host:/workspace/demo",
    });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual({
        zcode_type: "workspace-reconnect-response",
        requestId: "reconnect-1",
        workspaceKey: "remote:ssh:host:/workspace/demo",
        success: true,
      }),
    );
    expect(reconnectWorkspace).toHaveBeenCalledWith(1, "remote:ssh:host:/workspace/demo");
  });

  it("releases stale attachments when an older bridge open completes after reconnect", async () => {
    let resolveFirst: ((value: Awaited<ReturnType<AttachWorkspaceHost>>) => void) | undefined;
    const attachWorkspaceHost = vi
      .fn<AttachWorkspaceHost>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        entryId: "entry-1",
        attachmentId: "attachment-2",
        process: {} as never,
        port: createFakePort() as never,
      });
    const releaseWorkspaceHostAttachment = vi.fn();
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
      releaseWorkspaceHostAttachment,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);

    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-2",
      bridgeSessionId: "bridge-2",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(expect.objectContaining({ bridgeSessionId: "bridge-2" })),
    );

    resolveFirst?.({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: createFakePort() as never,
    });

    await vi.waitFor(() =>
      expect(releaseWorkspaceHostAttachment).toHaveBeenCalledWith("attachment-1"),
    );
    expect(releaseWorkspaceHostAttachment).not.toHaveBeenCalledWith("");
    expect(
      sentPayloads.filter(
        (payload) =>
          payload.zcode_type === "workspace-bridge-ready" && payload.bridgeSessionId === "bridge-1",
      ),
    ).toEqual([]);
  });

  it("does not match a remote workspace by path when identity is present", async () => {
    const { deliverPayload, manager, sentPayloads } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "remote-session-1",
    });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/demo",
        workspaceIdentity: "remote:ssh:host:/workspace/demo",
        remoteSessionId: "remote-session-1",
        label: "demo",
        kind: "remote",
      },
    ]);

    sentPayloads.length = 0;
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-path",
      bridgeSessionId: "bridge-path",
      workspaceKey: "/workspace/demo",
    });

    await vi.waitFor(() => {
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          requestId: "req-path",
        }),
      );
    });
  });

  it.each([
    ["DESKTOP_HOST_MISSING", "desktop-disconnected"],
    ["REMOTE_SESSION_MISSING", "workspace-closed"],
    ["REMOTE_WORKSPACE_IDENTITY_MISSING", "unsupported-action"],
  ] as const)("maps workspace bridge attach error %s to %s", async (code, reason) => {
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => {
      throw Object.assign(new Error(`attach failed: ${code}`), { code });
    });
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);

    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: `req-${code}`,
      bridgeSessionId: `bridge-${code}`,
      workspaceKey: "/workspace/demo",
    });

    await vi.waitFor(() => {
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          requestId: `req-${code}`,
          bridgeSessionId: `bridge-${code}`,
          reason,
        }),
      );
    });
  });

  it("production feature gate rejects start before returning QR material", async () => {
    const { manager } = createManagerHarness({ featureEnabled: false });

    await expect(
      manager.start(1, {
        workspacePath: "/workspace/demo",
      }),
    ).rejects.toThrow("Web remote control is disabled");
    expect(manager.getStatus(1)).toEqual({
      status: "idle",
      failure: {
        reason: "unsupported-action",
        message: "Web remote control is disabled in this build.",
      },
    });
  });

  it("waits long enough for slow external relay QR readiness", async () => {
    vi.useFakeTimers();
    const { manager } = createManagerHarness({ delayReadyMs: 20_000 });

    const startPromise = manager.start(1, {
      workspacePath: "/workspace/demo",
    });
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(startPromise).resolves.toMatchObject({
      status: "running",
      sessionId: "sid-1",
    });
    expect(manager.getStatus(1)).toMatchObject({
      status: "running",
      sessionId: "sid-1",
    });
  });

  it("emits a status update as soon as the external relay session is ready", async () => {
    const onStatusChanged = vi.fn();
    const { manager } = createManagerHarness({ onStatusChanged });

    await manager.start(1, {
      workspacePath: "/workspace/demo",
    });

    expect(onStatusChanged).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "running",
        sessionId: "sid-1",
        qrUrl: expect.stringContaining("/remote/v3?"),
      }),
    );
  });

  it("keeps the dialog active during a short paired-session reconnect", async () => {
    vi.useFakeTimers();
    const { emitTransportState, manager } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
    });
    emitTransportState("paired");
    expect(manager.getStatus(1)).toMatchObject({
      status: "active",
      mobileConnected: true,
    });

    emitTransportState("connecting");
    expect(manager.getStatus(1)).toMatchObject({
      status: "active",
      mobileConnected: true,
    });

    emitTransportState("waiting_terminal");
    expect(manager.getStatus(1)).toMatchObject({
      status: "active",
      mobileConnected: true,
    });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(manager.getStatus(1)).toMatchObject({
      status: "running",
      mobileConnected: false,
    });
  });

  it("flushes buffered outbound payloads after a normal reconnect becomes paired", async () => {
    let canSendPayload = true;
    const { deliverPayload, emitTransportState, manager, sentPayloads } = createManagerHarness({
      canSendPayload: () => canSendPayload,
    });

    await manager.start(1, {
      workspacePath: "/workspace/demo",
    });
    emitTransportState("paired");
    sentPayloads.length = 0;

    canSendPayload = false;
    deliverPayload({
      zcode_type: "workspace-list-request",
      requestId: "req-buffered",
    });
    expect(sentPayloads).toEqual([]);

    canSendPayload = true;
    emitTransportState("connecting");
    emitTransportState("authenticating");
    emitTransportState("paired");

    expect(sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "workspace-list-response",
        requestId: "req-buffered",
      }),
    );
  });

  it("drops duplicate mobile rpc frames before forwarding to the host", async () => {
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    const [frame] = encodeWebRemoteControlRpcTransportMessage(new Uint8Array([1]), {
      bridgeSessionId: "bridge-1",
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    deliverPayload(frame);
    deliverPayload(frame);

    expect(hostPort.postMessage).toHaveBeenCalledTimes(1);
  });

  it("marks a bridge degraded and does not forward mobile rpc frame gaps", async () => {
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    sentPayloads.length = 0;
    const [gapFrame] = encodeWebRemoteControlRpcTransportMessage(new Uint8Array([2]), {
      bridgeSessionId: "bridge-1",
      firstPhysicalSeq: 2,
      messageSeq: 1,
    });
    deliverPayload(gapFrame);

    expect(hostPort.postMessage).not.toHaveBeenCalled();
    expect(sentPayloads).toContainEqual({
      zcode_type: "bridge-degraded",
      bridgeSessionId: "bridge-1",
      reason: "rpc-transport-fault",
    });
  });

  it("keeps raw bridge frames out of the ordinary 50-item buffer", async () => {
    let canSendPayload = true;
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, emitTransportSendReady, emitTransportState, manager, sentPayloads } =
      createManagerHarness({
        attachWorkspaceHost,
        canSendPayload: () => canSendPayload,
      });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    emitTransportState("paired");
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    sentPayloads.length = 0;
    canSendPayload = false;
    for (let index = 0; index < 51; index += 1) {
      hostPort.emit("message", { data: new Uint8Array([index]) });
    }

    canSendPayload = true;
    emitTransportSendReady("same-socket");

    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(51);
    expect(sentPayloads.some((payload) => payload.zcode_type === "bridge-degraded")).toBe(false);
  });

  it("does not apply the ordinary app buffer timeout to raw bridge frames", async () => {
    vi.useFakeTimers();
    let canSendPayload = true;
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, emitTransportSendReady, emitTransportState, manager, sentPayloads } =
      createManagerHarness({
        attachWorkspaceHost,
        canSendPayload: () => canSendPayload,
      });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    emitTransportState("paired");
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    sentPayloads.length = 0;
    canSendPayload = false;
    hostPort.emit("message", { data: new Uint8Array([1]) });
    await vi.advanceTimersByTimeAsync(5_000);

    canSendPayload = true;
    emitTransportSendReady("same-socket");

    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(1);
    expect(sentPayloads.some((payload) => payload.zcode_type === "bridge-degraded")).toBe(false);
  });

  it("replays lost-ACK raw frames after same-socket peer readiness and stops after cumulative ACK", async () => {
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, emitTransportSendReady, emitTransportState, manager, sentPayloads } =
      createManagerHarness({ attachWorkspaceHost });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    emitTransportState("paired");
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-1",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    sentPayloads.length = 0;
    hostPort.emit("message", { data: new Uint8Array([1, 2, 3]) });
    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(1);
    const firstFrame = sentPayloads[0];

    emitTransportSendReady("same-socket");
    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(2);
    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")[1]).toBe(
      firstFrame,
    );

    deliverPayload({
      zcode_type: "rpc-frame-ack",
      bridgeSessionId: "foreign-bridge",
      ackMessageSeq: 1,
    });
    emitTransportSendReady("reconnected-socket");
    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(3);

    deliverPayload({
      zcode_type: "rpc-frame-ack",
      bridgeSessionId: "bridge-1",
      ackMessageSeq: 1,
    });
    emitTransportSendReady("reconnected-socket");
    expect(sentPayloads.filter((payload) => payload.zcode_type === "rpc-frame")).toHaveLength(3);
  });

  it("forwards raw adapter saturated/drained edges only to the owning host attachment", async () => {
    const hostPort = createFakePort();
    const attachWorkspaceHost = vi.fn<AttachWorkspaceHost>(async () => ({
      entryId: "entry-1",
      attachmentId: "attachment-1",
      process: {} as never,
      port: hostPort as never,
    }));
    const { deliverPayload, emitTransportState, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/demo", label: "demo", kind: "local" },
    ]);
    emitTransportState("paired");
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-bridge",
      bridgeSessionId: "bridge-flow",
      workspaceKey: "/workspace/demo",
    });
    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
      ),
    );

    hostPort.emit("message", { data: new Uint8Array(900_000) });
    expect(hostPort.postMessage).toHaveBeenCalledWith({
      __zcodeRpcControl: "connection-flow-v1",
      state: "saturated",
    });

    deliverPayload({
      zcode_type: "rpc-frame-ack",
      bridgeSessionId: "bridge-flow",
      ackMessageSeq: 1,
    });
    expect(hostPort.postMessage).toHaveBeenCalledWith({
      __zcodeRpcControl: "connection-flow-v1",
      state: "drained",
    });
  });

  it("exposes the latest mobile device info from view state updates", async () => {
    const { deliverPayload, manager } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
    });

    deliverPayload({
      zcode_type: "mobile-view-state-update",
      viewState: {
        activeWorkspaceKey: "/workspace/demo",
        activeTaskId: "task-1",
        updatedAt: 1,
      },
      deviceInfo: {
        platform: "web",
        version: "1.7.0",
        name: "mobile-browser",
        userAgent: "Mozilla/5.0 Mobile Safari/604.1",
        language: "zh-CN",
        languages: ["zh-CN", "en-US"],
        browserPlatform: "iPhone",
        viewport: {
          width: 390,
          height: 844,
          devicePixelRatio: 3,
        },
        screen: {
          width: 390,
          height: 844,
        },
        timezone: "Asia/Shanghai",
        online: true,
        updatedAt: 2,
      },
    });

    expect(manager.getStatus(1)).toMatchObject({
      mobileViewState: {
        activeWorkspaceKey: "/workspace/demo",
        activeTaskId: "task-1",
      },
      mobileDeviceInfo: {
        platform: "web",
        userAgent: "Mozilla/5.0 Mobile Safari/604.1",
        viewport: {
          width: 390,
          height: 844,
        },
      },
    });
  });

  it("logs mobile diagnostics as desktop log summaries", async () => {
    const { deliverPayload, logger, manager } = createManagerHarness();

    await manager.start(1, {
      workspacePath: "/workspace/demo",
    });

    deliverPayload({
      zcode_type: "mobile-diagnostic",
      event: "pair-status",
      timestamp: 1710000000000,
      state: "paired",
      pairStatus: "waiting",
      visibilityState: "visible",
      online: true,
    });

    expect(logger.info).toHaveBeenCalledWith(
      "[web-remote-control] mobile diagnostic",
      expect.objectContaining({
        event: "pair-status",
        pairStatus: "waiting",
        state: "paired",
        visibilityState: "visible",
        online: true,
      }),
    );
  });

  it("keeps the dialog status target on the window workspace after mobile opens another workspace bridge", async () => {
    const { deliverPayload, manager, sentPayloads } = createManagerHarness();

    await manager.start(1, { workspacePath: "/workspace/z-code" });
    manager.syncAvailableWorkspaces(1, [
      { workspacePath: "/workspace/z-code", label: "z-code", kind: "local" },
      { workspacePath: "/workspace/cgx-dev-web", label: "cgx-dev-web", kind: "local" },
    ]);

    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-cgx",
      bridgeSessionId: "bridge-cgx",
      workspaceKey: "/workspace/cgx-dev-web",
    });

    await vi.waitFor(() =>
      expect(sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridgeSessionId: "bridge-cgx",
        }),
      ),
    );

    expect(manager.getStatus(1)).toMatchObject({
      status: "active",
      workspacePath: "/workspace/z-code",
    });
  });

  it("disposes workspace host attachments when stopping the window runtime", async () => {
    const disposeWorkspaceHostAttachmentsForWindow = vi.fn();
    const { manager } = createManagerHarness({
      disposeWorkspaceHostAttachmentsForWindow,
    });

    await manager.start(1, { workspacePath: "/workspace/demo" });
    await manager.stop(1);

    expect(disposeWorkspaceHostAttachmentsForWindow).toHaveBeenCalledWith(1, "manual-stop");
  });

  it("disposes workspace host attachments when a remote session fails", async () => {
    const disposeWorkspaceHostAttachmentsForRemoteSession = vi.fn();
    const { deliverPayload, manager } = createManagerHarness({
      disposeWorkspaceHostAttachmentsForRemoteSession,
    });

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "remote-session-1",
    });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/demo",
        workspaceIdentity: "remote:ssh:host:/workspace/demo",
        remoteSessionId: "remote-session-1",
        label: "demo",
        kind: "remote",
      },
    ]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      workspaceKey: "remote:ssh:host:/workspace/demo",
    });
    await vi.waitFor(() => expect(manager.getStatus(1).status).toBe("active"));

    manager.failRemoteSession("remote-session-1", "remote-closed", {
      reason: "workspace-closed",
      message: "closed",
    });

    expect(disposeWorkspaceHostAttachmentsForRemoteSession).toHaveBeenCalledWith(
      "remote-session-1",
      "remote-closed",
    );
  });

  it("degrades an active remote bridge after Source reconnect so Web opens a new transport generation", async () => {
    let attachment = 0;
    const attachWorkspaceHost = vi.fn(async () => ({
      entryId: `entry-${++attachment}`,
      attachmentId: `attachment-${attachment}`,
      process: {} as never,
      port: createFakePort() as never,
    }));
    const releaseWorkspaceHostAttachment = vi.fn();
    const { deliverPayload, manager, sentPayloads } = createManagerHarness({
      attachWorkspaceHost,
      releaseWorkspaceHostAttachment,
    });
    const workspaceIdentity = "remote:server:source-1:/workspace/demo";

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity,
      remoteSessionId: "remote-session-1",
    });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/demo",
        workspaceIdentity,
        remoteSessionId: "remote-session-1",
        label: "demo",
        kind: "remote",
      },
    ]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      bridgeGeneration: 4,
      recoveryId: "recovery-1",
      workspaceKey: workspaceIdentity,
    });
    await vi.waitFor(() => expect(manager.getStatus(1).status).toBe("active"));
    sentPayloads.length = 0;

    await manager.replaceRemoteSession({
      previousSessionId: "remote-session-1",
      sessionId: "remote-session-2",
      workspacePath: "/workspace/demo",
      workspaceIdentity,
    });

    expect(releaseWorkspaceHostAttachment).toHaveBeenCalledWith("attachment-1");
    expect(attachWorkspaceHost).toHaveBeenCalledTimes(1);
    expect(sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "bridge-degraded",
        bridgeSessionId: "bridge-1",
        bridgeGeneration: 4,
        recoveryId: "recovery-1",
        reason: "source-session-replaced",
      }),
    );
    expect(sentPayloads).not.toContainEqual(
      expect.objectContaining({ zcode_type: "workspace-bridge-ready" }),
    );
  });

  it("replays Source replacement invalidation after the ordinary app buffer deadline", async () => {
    vi.useFakeTimers();
    let canSendPayload = true;
    let attachment = 0;
    const releaseWorkspaceHostAttachment = vi.fn();
    const { deliverPayload, emitTransportSendReady, manager, sentPayloads } = createManagerHarness({
      canSendPayload: () => canSendPayload,
      releaseWorkspaceHostAttachment,
      attachWorkspaceHost: vi.fn(async () => ({
        entryId: `entry-${++attachment}`,
        attachmentId: `attachment-${attachment}`,
        process: {} as never,
        port: createFakePort() as never,
      })),
    });
    const workspaceIdentity = "remote:server:source-1:/workspace/demo";
    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity,
      remoteSessionId: "remote-session-1",
    });
    manager.syncAvailableWorkspaces(1, [
      {
        workspacePath: "/workspace/demo",
        workspaceIdentity,
        remoteSessionId: "remote-session-1",
        label: "demo",
        kind: "remote",
      },
    ]);
    deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: "req-1",
      bridgeSessionId: "bridge-1",
      workspaceKey: workspaceIdentity,
    });
    await vi.waitFor(() => expect(manager.getStatus(1).status).toBe("active"));
    sentPayloads.length = 0;
    canSendPayload = false;

    await manager.replaceRemoteSession({
      previousSessionId: "remote-session-1",
      sessionId: "remote-session-2",
      workspacePath: "/workspace/demo",
      workspaceIdentity,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentPayloads).toEqual([]);
    expect(releaseWorkspaceHostAttachment).toHaveBeenCalledWith("attachment-1");

    canSendPayload = true;
    emitTransportSendReady("same-socket");

    expect(sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "bridge-degraded",
        bridgeSessionId: "bridge-1",
        reason: "source-session-replaced",
      }),
    );

    const firstReplayCount = sentPayloads.filter(
      (payload) => payload.zcode_type === "bridge-degraded",
    ).length;
    emitTransportSendReady("same-socket");
    expect(sentPayloads.filter((payload) => payload.zcode_type === "bridge-degraded")).toHaveLength(
      firstReplayCount,
    );

    emitTransportSendReady("reconnected-socket");
    expect(sentPayloads.filter((payload) => payload.zcode_type === "bridge-degraded")).toHaveLength(
      firstReplayCount + 1,
    );
  });

  it("keeps the desktop relay session alive when a waiting remote workspace session closes", async () => {
    const disposeWorkspaceHostAttachmentsForRemoteSession = vi.fn();
    const { disposeTransport, manager, sentPayloads } = createManagerHarness({
      disposeWorkspaceHostAttachmentsForRemoteSession,
    });

    await manager.start(1, {
      workspacePath: "/workspace/demo",
      workspaceIdentity: "remote:ssh:host:/workspace/demo",
      remoteSessionId: "remote-session-1",
    });

    manager.failRemoteSession("remote-session-1", "remote-closed", {
      reason: "workspace-closed",
      message: "closed",
    });

    expect(manager.getStatus(1)).toMatchObject({
      status: "running",
      failure: undefined,
    });
    expect(disposeTransport).not.toHaveBeenCalled();
    expect(sentPayloads).not.toContainEqual(expect.objectContaining({ zcode_type: "app-error" }));
    expect(disposeWorkspaceHostAttachmentsForRemoteSession).toHaveBeenCalledWith(
      "remote-session-1",
      "remote-closed",
    );
  });
});

describe("mobile project bridge admission", () => {
  const prepared: HostPreparedProjectWorkspace = {
    projectId: "project-a",
    hostId: "server:source-a",
    workspacePath: "/new-project",
    workspaceIdentity: "remote:server:source-a:/new-project",
    additionalDirectories: [],
    remote: {
      remoteSessionId: "project-scope",
      sourceServerId: "source-a",
      generation: 1,
      target: { kind: "server", url: "http://source.test" },
      workspacePath: "/new-project",
      workspaceIdentity: "remote:server:source-a:/new-project",
    },
  };
  const projectRequest = {
    zcode_type: "workspace-bridge-open" as const,
    requestId: "project-request",
    bridgeSessionId: "project-bridge",
    workspaceKey: localWorkspace.workspacePath,
    project: { projectId: "project-a", hostId: "server:source-a" },
  };
  it("attaches the Host admitted directory even without a desktop tab", async () => {
    const prepareProjectWorkspace = vi.fn(async () => prepared);
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    harness.manager.syncAvailableWorkspaces(1, [localWorkspace]);
    harness.deliverPayload(projectRequest);
    await vi.waitFor(() =>
      expect(harness.defaultAttachWorkspaceHost).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          workspacePath: prepared.workspacePath,
          workspaceIdentity: prepared.workspaceIdentity,
          remoteSessionId: "project-scope",
          kind: "remote",
        }),
      ),
    );
    expect(prepareProjectWorkspace).toHaveBeenCalledOnce();
    expect(prepareProjectWorkspace).toHaveBeenCalledWith(
      1,
      projectRequest.project,
      expect.any(String),
    );
    await harness.manager.disposeWindow(1);
  });
  it("keeps the current bridge when the Host refuses project admission", async () => {
    const prepareProjectWorkspace = vi.fn(async () => {
      throw new Error("Source offline");
    });
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    harness.manager.syncAvailableWorkspaces(1, [localWorkspace]);
    harness.deliverPayload({
      ...projectRequest,
      project: undefined,
      bridgeSessionId: "old-bridge",
    });
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridgeSessionId: "old-bridge",
        }),
      ),
    );
    harness.deliverPayload(projectRequest);
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          bridgeSessionId: "project-bridge",
          error: "Source offline",
        }),
      ),
    );
    expect(harness.releaseWorkspaceHostAttachment).not.toHaveBeenCalled();
    await harness.manager.disposeWindow(1);
  });
  it("deduplicates project preparation across transport retries", async () => {
    let finish!: (result: HostPreparedProjectWorkspace) => void;
    const prepareProjectWorkspace = vi.fn(
      () =>
        new Promise<HostPreparedProjectWorkspace>((resolve) => {
          finish = resolve;
        }),
    );
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    harness.deliverPayload(projectRequest);
    harness.deliverPayload({ ...projectRequest, requestId: "retry" });
    await vi.waitFor(() => expect(prepareProjectWorkspace).toHaveBeenCalledOnce());
    finish(prepared);
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({ zcode_type: "workspace-bridge-ready", requestId: "retry" }),
      ),
    );
    harness.deliverPayload({ ...projectRequest, requestId: "retry-after-ready" });
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          requestId: "retry-after-ready",
        }),
      ),
    );
    expect(prepareProjectWorkspace).toHaveBeenCalledOnce();
    expect(harness.defaultAttachWorkspaceHost).toHaveBeenCalledOnce();
    await harness.manager.disposeWindow(1);
  });
  it("does not let a late project result supersede a later ordinary navigation", async () => {
    let finish!: (result: HostPreparedProjectWorkspace) => void;
    const prepareProjectWorkspace = vi.fn(
      () =>
        new Promise<HostPreparedProjectWorkspace>((resolve) => {
          finish = resolve;
        }),
    );
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    harness.manager.syncAvailableWorkspaces(1, [localWorkspace]);
    harness.deliverPayload(projectRequest);
    await vi.waitFor(() => expect(prepareProjectWorkspace).toHaveBeenCalledOnce());
    harness.deliverPayload({
      ...projectRequest,
      project: undefined,
      bridgeSessionId: "later-bridge",
      requestId: "later",
    });
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridgeSessionId: "later-bridge",
        }),
      ),
    );
    finish(prepared);
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          requestId: "project-request",
        }),
      ),
    );
    expect(harness.defaultAttachWorkspaceHost).toHaveBeenCalledOnce();
    await harness.manager.disposeWindow(1);
  });
  it("rejects a retry for the invalidated bridge after Source replacement", async () => {
    const harness = createManagerHarness({ prepareProjectWorkspace: async () => prepared });
    await harness.manager.start(1, localWorkspace);
    harness.deliverPayload(projectRequest);
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          requestId: "project-request",
        }),
      ),
    );
    await harness.manager.replaceRemoteSession({
      previousSessionId: "project-scope",
      sessionId: "replacement",
      workspacePath: prepared.workspacePath,
      workspaceIdentity: prepared.workspaceIdentity!,
    });
    harness.deliverPayload({ ...projectRequest, requestId: "invalidated-retry" });
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-error",
          requestId: "invalidated-retry",
        }),
      ),
    );
    await harness.manager.disposeWindow(1);
  });
  it("admits a file-only task cwd without selecting or marking the task read", async () => {
    const prepareProjectWorkspace = vi.fn(async () => prepared);
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    const request = {
      ...projectRequest,
      project: undefined,
      workspaceKey: prepared.workspaceIdentity!,
      fileTreeTaskId: "existing-task",
      taskHostId: prepared.hostId,
    };
    expect(parseWebRemoteControlAppPayload(request)).toEqual(request);
    harness.deliverPayload(request);
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridge: expect.objectContaining({ workspacePath: prepared.workspacePath }),
        }),
      ),
    );
    const response = harness.sentPayloads.find(
      (payload) => payload.zcode_type === "workspace-bridge-ready",
    );
    expect(
      response && response.zcode_type === "workspace-bridge-ready" && response.bridge.initialTaskId,
    ).toBeUndefined();
    expect(prepareProjectWorkspace).toHaveBeenCalledWith(
      1,
      {
        hostId: prepared.hostId,
        task: { taskId: "existing-task", workspaceKey: prepared.workspaceIdentity },
      },
      expect.any(String),
    );
    expect(parseWebRemoteControlAppPayload({ ...request, taskId: "other" })).toBeNull();
    expect(parseWebRemoteControlAppPayload({ ...request, taskHostId: undefined })).toBeNull();
    await harness.manager.disposeWindow(1);
  });
  it("admits an existing project task absent from the desktop workspace list", async () => {
    const prepareProjectWorkspace = vi.fn(async () => prepared);
    const harness = createManagerHarness({ prepareProjectWorkspace });
    await harness.manager.start(1, localWorkspace);
    harness.deliverPayload({
      ...projectRequest,
      project: undefined,
      workspaceKey: prepared.workspaceIdentity!,
      taskId: "existing-task",
      taskHostId: prepared.hostId,
    });
    await vi.waitFor(() =>
      expect(harness.sentPayloads).toContainEqual(
        expect.objectContaining({
          zcode_type: "workspace-bridge-ready",
          bridge: expect.objectContaining({
            initialTaskId: "existing-task",
            workspacePath: prepared.workspacePath,
          }),
        }),
      ),
    );
    expect(prepareProjectWorkspace).toHaveBeenCalledWith(
      1,
      {
        hostId: prepared.hostId,
        task: { taskId: "existing-task", workspaceKey: prepared.workspaceIdentity },
      },
      expect.any(String),
    );
    await harness.manager.disposeWindow(1);
  });
});

async function createTaskViewHarness() {
  const onStatusChanged = vi.fn();
  const harness = createManagerHarness({ onStatusChanged });
  await harness.manager.start(1, { workspacePath: localWorkspace.workspacePath });
  harness.manager.syncAvailableWorkspaces(1, [remoteWorkspace]);
  harness.emitTransportState("paired");
  const epoch = () => {
    const request = harness.sentPayloads.findLast(
      (payload) => payload.zcode_type === "mobile-task-view-request",
    );
    expect(request).toBeDefined();
    if (!request || request.zcode_type !== "mobile-task-view-request")
      throw new Error("missing task view epoch");
    return request.epoch;
  };
  const open = async (bridgeSessionId = "view-bridge", bridgeGeneration = 1) => {
    harness.deliverPayload({
      zcode_type: "workspace-bridge-open",
      requestId: bridgeSessionId,
      bridgeSessionId,
      bridgeGeneration,
      workspaceKey: remoteWorkspace.workspaceIdentity!,
    });
    await vi.waitFor(() =>
      expect(
        harness.sentPayloads.some(
          (payload) =>
            payload.zcode_type === "workspace-bridge-ready" &&
            payload.bridgeSessionId === bridgeSessionId,
        ),
      ).toBe(true),
    );
  };
  await open();
  const view = {
    workspacePath: remoteWorkspace.workspacePath,
    workspaceIdentity: remoteWorkspace.workspaceIdentity,
    taskId: "view-task",
  };
  const send = (
    seq: number,
    value: typeof view | null = view,
    overrides: Record<string, unknown> = {},
  ) =>
    harness.deliverPayload({
      zcode_type: "mobile-task-view-update",
      epoch: epoch(),
      seq,
      bridgeSessionId: "view-bridge",
      bridgeGeneration: 1,
      view: value,
      ...overrides,
    } as never);
  return { ...harness, onStatusChanged, epoch, open, view, send };
}

it("MRO03：查看进入和离开同步推送，旧导航位置不能被当作有效查看", async () => {
  const f = await createTaskViewHarness();
  try {
    f.deliverPayload({
      zcode_type: "mobile-view-state-update",
      viewState: {
        activeWorkspaceKey: remoteWorkspace.workspaceIdentity,
        activeTaskId: "cached",
        updatedAt: 1,
      },
    });
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    f.onStatusChanged.mockClear();
    f.send(1);
    f.send(2);
    f.send(3, null);
    expect(f.onStatusChanged.mock.calls.map(([, status]) => status.mobileTaskView)).toEqual([
      { ...f.view, remoteSessionId: remoteWorkspace.remoteSessionId },
      null,
    ]);
    expect(f.manager.getStatus(1).mobileViewState?.activeTaskId).toBe("cached");
  } finally {
    await f.manager.stop(1);
  }
});

it("MRO03：断线立即清查看但保留连接宽限，重连只接收新 epoch", async () => {
  const f = await createTaskViewHarness();
  try {
    f.send(1);
    const previous = f.epoch();
    f.emitTransportState("connecting");
    expect(f.manager.getStatus(1)).toMatchObject({ mobileConnected: true, mobileTaskView: null });
    f.emitTransportState("paired");
    expect(f.epoch()).not.toBe(previous);
    f.send(99, f.view, { epoch: previous });
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    f.send(1);
    expect(f.manager.getStatus(1).mobileTaskView).toEqual({
      ...f.view,
      remoteSessionId: remoteWorkspace.remoteSessionId,
    });
  } finally {
    await f.manager.stop(1);
  }
});

it("MRO03：旧序号、bridge 代际、同路径异设备及错 cwd 不能替换查看事实", async () => {
  const f = await createTaskViewHarness();
  try {
    f.send(5);
    f.send(4, null);
    f.send(6, null, { bridgeSessionId: "old" });
    f.send(6, null, { bridgeGeneration: 0 });
    f.send(6, { ...f.view, workspaceIdentity: "remote:server:other:/workspace/remote" });
    f.send(6, { ...f.view, workspacePath: "/other" });
    expect(f.manager.getStatus(1).mobileTaskView).toEqual({
      ...f.view,
      remoteSessionId: remoteWorkspace.remoteSessionId,
    });
    f.send(6, null);
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    f.send(7);
    await f.open("next-view-bridge", 2);
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    f.send(8);
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
  } finally {
    await f.manager.stop(1);
  }
});

it("MRO03：bootstrap 补发 epoch，send-ready 不以心跳频率重申查看", async () => {
  const f = await createTaskViewHarness();
  try {
    const epoch = f.epoch();
    f.deliverPayload({ zcode_type: "bootstrap-request", requestId: "view-bootstrap" });
    expect(f.sentPayloads).toContainEqual(
      expect.objectContaining({
        zcode_type: "bootstrap-response",
        requestId: "view-bootstrap",
        result: expect.objectContaining({ mobileTaskViewEpoch: epoch }),
      }),
    );
    f.emitTransportSendReady("same-socket");
    const count = f.sentPayloads.filter(
      (payload) => payload.zcode_type === "mobile-task-view-request",
    ).length;
    f.emitTransportSendReady("same-socket");
    expect(
      f.sentPayloads.filter((payload) => payload.zcode_type === "mobile-task-view-request"),
    ).toHaveLength(count);
    f.emitTransportSendReady("reconnected-socket");
    expect(
      f.sentPayloads.filter((payload) => payload.zcode_type === "mobile-task-view-request"),
    ).toHaveLength(count + 1);
  } finally {
    await f.manager.stop(1);
  }
});

it.each(["raw-fault", "replaced", "closed"] as const)(
  "MRO03：连接仍 paired 时 bridge 失效立即清查看：%s",
  async (reason) => {
    const f = await createTaskViewHarness();
    try {
      f.send(1);
      if (reason === "raw-fault")
        f.getLatestTransportOptions()?.onRawTransportFault?.("invalid-frame");
      else if (reason === "closed")
        f.manager.failRemoteSession(remoteWorkspace.remoteSessionId!, "test", {
          reason: "workspace-closed",
        });
      else
        await f.manager.replaceRemoteSession({
          previousSessionId: remoteWorkspace.remoteSessionId!,
          sessionId: "new-session",
          workspacePath: remoteWorkspace.workspacePath,
          workspaceIdentity: remoteWorkspace.workspaceIdentity!,
        });
      expect(f.manager.getStatus(1)).toMatchObject({ mobileConnected: true, mobileTaskView: null });
      f.send(2);
      expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    } finally {
      await f.manager.stop(1);
    }
  },
);

it("MRO03：legacy 身份的查看事实由 Main 注入当前 session，换代不能沿用旧 session", async () => {
  const f = await createTaskViewHarness();
  try {
    f.send(1);
    expect(f.manager.getStatus(1).mobileTaskView).toEqual({
      ...f.view,
      remoteSessionId: remoteWorkspace.remoteSessionId,
    });
    await f.manager.replaceRemoteSession({
      previousSessionId: remoteWorkspace.remoteSessionId!,
      sessionId: "replacement-session",
      workspacePath: remoteWorkspace.workspacePath,
      workspaceIdentity: remoteWorkspace.workspaceIdentity!,
    });
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    await f.open("replacement-view-bridge", 2);
    f.send(2);
    expect(f.manager.getStatus(1).mobileTaskView).toBeNull();
    f.send(3, f.view, { bridgeSessionId: "replacement-view-bridge", bridgeGeneration: 2 });
    expect(f.manager.getStatus(1).mobileTaskView).toEqual({
      ...f.view,
      remoteSessionId: "replacement-session",
    });
  } finally {
    await f.manager.stop(1);
  }
});

it.each(["auth", "restore"] as const)("关闭窗口撤销迟到的 %s 存储读取", async (kind) => {
  const auth = Promise.withResolvers<{ deviceSid: string; passHash: string }>();
  const restoreContext = Promise.withResolvers<{ workspacePath: string }>();
  const loadAuth = vi.fn(() => auth.promise);
  const loadStartupRestore = vi.fn(() => restoreContext.promise);
  const f = createManagerHarness(kind === "auth" ? { loadAuth } : { loadStartupRestore });
  const pending =
    kind === "auth"
      ? f.manager.start(1, localWorkspace).then(
          () => "started",
          () => "cancelled",
        )
      : f.manager.restorePreviouslyEnabled(1, [localWorkspace]);
  await vi.waitFor(() =>
    expect(kind === "auth" ? loadAuth : loadStartupRestore).toHaveBeenCalledOnce(),
  );
  await f.manager.disposeWindow(1);
  auth.resolve({ deviceSid: "old-sid", passHash: "old-hash" });
  restoreContext.resolve({ workspacePath: localWorkspace.workspacePath });
  await expect(pending).resolves.toBe(kind === "auth" ? "cancelled" : false);
  expect(f.manager.getStatus(1)).toEqual({ status: "idle" });
  expect(f.getLatestTransportOptions()).toBeUndefined();
});

it.each([false, true])(
  "混合工作区恢复读取期间移除本地目标=%s 时只消费最新快照",
  async (removed) => {
    const context = Promise.withResolvers<{ workspacePath: string }>();
    const f = createManagerHarness({ loadStartupRestore: () => context.promise });
    const restore = f.manager.restorePreviouslyEnabled(1, [localWorkspace, remoteWorkspace]);
    f.manager.syncAvailableWorkspaces(
      1,
      removed ? [remoteWorkspace] : [localWorkspace, remoteWorkspace],
    );
    context.resolve({ workspacePath: localWorkspace.workspacePath });
    await expect(restore).resolves.toBe(!removed);
    if (removed) {
      expect(f.manager.getStatus(1)).toEqual({ status: "idle" });
      expect(f.getLatestTransportOptions()).toBeUndefined();
    } else {
      expect(f.manager.getStatus(1)).toMatchObject({
        status: "running",
        workspacePath: localWorkspace.workspacePath,
      });
    }
    await f.manager.disposeWindow(1);
  },
);

it("远程启动恢复等待当前 remoteSessionId，离线占位目标不创建 relay", async () => {
  const f = createManagerHarness({
    startupRestoreContext: {
      workspacePath: remoteWorkspace.workspacePath,
      workspaceIdentity: remoteWorkspace.workspaceIdentity,
    },
  });
  await expect(
    f.manager.restorePreviouslyEnabled(1, [{ ...remoteWorkspace, remoteSessionId: undefined }]),
  ).resolves.toBe(false);
  expect(f.getLatestTransportOptions()).toBeUndefined();
  expect(f.defaultAttachWorkspaceHost).not.toHaveBeenCalled();
  await expect(
    f.manager.restorePreviouslyEnabled(1, [
      { ...remoteWorkspace, remoteSessionId: "current-session" },
    ]),
  ).resolves.toBe(true);
  expect(f.manager.getStatus(1)).toMatchObject({
    remoteSessionId: "current-session",
    status: "running",
  });
  await f.manager.disposeWindow(1);
});

it("transport明确报告kicked时保留session-conflict终态", async () => {
  const f = createManagerHarness();
  await f.manager.start(1, remoteWorkspace);
  f.emitTransportState("kicked");
  expect(f.manager.getStatus(1)).toMatchObject({
    status: "error",
    failure: { reason: "session-conflict" },
  });
  expect(f.disposeTransport).toHaveBeenCalled();
  f.manager.failRemoteSession(remoteWorkspace.remoteSessionId!, "closed", {
    reason: "workspace-closed",
  });
  expect(f.manager.getStatus(1)).toMatchObject({
    status: "error",
    failure: { reason: "session-conflict" },
  });
  await f.manager.disposeWindow(1);
});

describe("V1 prepared connection lifecycle", () => {
  function provider() {
    const settings = {
      mode: "direct" as const,
      direct: { listenHost: "127.0.0.1", port: 0, publicUrl: "" },
      relay: { wsUrl: "", pageUrl: "" },
    };
    const connection = {
      relayWsUrl: "ws://127.0.0.1:12345/ws",
      mobileRemoteControlUrl: "http://phone.example/remote/",
      settings,
      authStorageProvider: {
        load: vi.fn(async () => ({ deviceSid: "direct-id", passHash: "direct-hash" })),
        save: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
        rotate: vi.fn(async () => {}),
      },
      commit: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    return {
      connection,
      getSettings: vi.fn(async () => settings),
      prepare: vi.fn(async () => connection),
    };
  }
  it("uses scoped auth, never exposes loopback in the QR, and releases on stop", async () => {
    const p = provider();
    const h = createManagerHarness({ connectionProvider: p });
    const result = await h.manager.start(1, { workspacePath: "/workspace/demo" });
    expect(result.connection?.mode).toBe("direct");
    expect(new URL(result.qrUrl).searchParams.has("relay")).toBe(false);
    expect(h.getLatestTransportOptions()?.auth).toMatchObject({
      mode: "persisted",
      deviceSid: "direct-id",
    });
    expect(p.connection.commit).toHaveBeenCalledOnce();
    await h.manager.stop(1);
    expect(p.connection.dispose).toHaveBeenCalledOnce();
  });
  it.each(["direct", "self-hosted", "official"] as const)(
    "%s 模式分别处理网页选择与真实桌面版本，官方旧页不被 bootstrap 重定向",
    async (mode) => {
      const p = provider();
      const connection = {
        ...p.connection,
        settings: { ...p.connection.settings, mode },
        mobileRemoteControlUrl:
          mode === "official"
            ? "https://zcode.z.ai/remote/v4"
            : p.connection.mobileRemoteControlUrl,
      };
      const h = createManagerHarness({
        connectionProvider: {
          getSettings: async () => connection.settings,
          prepare: async () => connection,
        },
      });
      try {
        const result = await h.manager.start(1, { workspacePath: "/workspace/demo" });
        expect(new URL(result.qrUrl).searchParams.get("app_version")).toBe(
          mode === "official" ? "3.15.2" : "1.5.0",
        );
        expect(h.getLatestTransportOptions()?.meta.version).toBe("1.5.0");
        h.deliverPayload({ zcode_type: "bootstrap-request", requestId: "page-version" });
        const response = h.sentPayloads.find(
          (payload) => payload.zcode_type === "bootstrap-response",
        );
        expect(response).toMatchObject({ success: true, result: { tasks: [] } });
        if (mode === "official") {
          // 旧页允许版本缺失；填入真实版本会跳到新版页面，填网页版本又会误报桌面身份。
          expect(response).not.toHaveProperty("result.desktopAppVersion");
        } else {
          expect(response).toHaveProperty("result.desktopAppVersion", "1.5.0");
        }
      } finally {
        await h.manager.stop(1);
      }
    },
  );
  it("refresh preserves the running connection mode and rotates only that scope", async () => {
    const p = provider();
    const h = createManagerHarness({ connectionProvider: p });
    await h.manager.start(1, { workspacePath: "/workspace/demo" });
    await h.manager.resetPairing(1, { workspacePath: "/workspace/demo" });
    expect(p.prepare).toHaveBeenLastCalledWith(
      1,
      p.connection.settings,
      expect.any(AbortSignal),
      true,
    );
    await h.manager.stop(1);
  });
  it("startup restores the saved target together with its own connection settings", async () => {
    const p = provider();
    const h = createManagerHarness({
      connectionProvider: p,
      startupRestoreContext: {
        workspacePath: "/workspace/demo",
        connection: p.connection.settings,
      },
    });
    expect(
      await h.manager.restorePreviouslyEnabled(1, [{ workspacePath: "/workspace/demo" }]),
    ).toBe(true);
    expect(p.prepare).toHaveBeenCalledWith(
      1,
      p.connection.settings,
      expect.any(AbortSignal),
      false,
    );
    expect(h.getStartupRestoreContext()?.connection).toEqual(p.connection.settings);
    await h.manager.stop(1);
  });
  it("a failed settings commit disposes the active connection", async () => {
    const p = provider();
    p.connection.commit.mockRejectedValueOnce(new Error("disk failed"));
    const h = createManagerHarness({ connectionProvider: p });
    await expect(h.manager.start(1, { workspacePath: "/workspace/demo" })).rejects.toThrow(
      "disk failed",
    );
    expect(p.connection.dispose).toHaveBeenCalled();
    expect(h.manager.getStatus(1).status).toBe("idle");
  });
  it("cancellation during preparation releases a late listener without starting transport", async () => {
    const p = provider();
    let release!: (value: typeof p.connection) => void;
    p.prepare.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const h = createManagerHarness({ connectionProvider: p });
    const starting = h.manager.start(1, { workspacePath: "/workspace/demo" });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(p.prepare).toHaveBeenCalledOnce());
    await h.manager.stop(1);
    release(p.connection);
    await rejected;
    expect(p.connection.dispose).toHaveBeenCalledOnce();
    expect(h.getLatestTransportOptions()).toBeUndefined();
  });
});
