import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  WebRemoteControlAppPayload,
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceTarget,
} from "@zcode/shared";
import { DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS } from "@zcode/shared";
import { createWebRemoteControlManager } from "../src/main/webRemoteControlManager.js";
import { createWebRemoteControlFeatureGate } from "../src/main/webRemoteControlFeatureGate.js";

// v3.17.1 同步复核：上游退役了原 webRemoteControlManagerExternalRelay.test.ts 全文件，
// 本文件按 OW-P009 / OW-P018 原触发场景（目录推送签名吞掉时间与展示字段变化）重建最小回归。
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

type StartupRestoreContext = {
  connection?: typeof DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS & {
    profileId?: string;
  };
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
};

function createManagerHarness({
  startupContexts = [],
  overrides = {},
}: {
  startupContexts?: StartupRestoreContext[];
  overrides?: Partial<Parameters<typeof createWebRemoteControlManager>[0]>;
} = {}) {
  const sentPayloads: WebRemoteControlAppPayload[] = [];
  const settings: AppSettings = { recentProjects: [], locale: "zh-CN" };
  const savedStartupRestoreContexts: StartupRestoreContext[] = [];
  let storedAuth: { deviceSid: string; passHash: string } | undefined;
  const deliverPayloads: Array<(payload: WebRemoteControlAppPayload) => void> = [];
  const addTerminalOwner = vi.fn();
  const removeTerminalOwner = vi.fn();
  const defaultAttachWorkspaceHost = vi.fn(async () => ({
    entryId: "entry-1",
    attachmentId: "attachment-1",
    process: {} as never,
    port: createFakePort() as never,
  }));
  const manager = createWebRemoteControlManager({
    relayWsUrl: "ws://relay.test/ws",
    mobileRemoteControlUrl: "https://relay.test/remote/v3",
    deviceMid: "mid-1",
    deviceName: "MacBook",
    appVersion: "1.5.0",
    authProvider: {
      createPassword: () => "password",
      createPassHash: () => "hash-1",
      calculateProof: () => "proof",
    },
    authStorageProvider: {
      load: async () => storedAuth,
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
      load: async () => startupContexts,
      save: async (contexts) => {
        savedStartupRestoreContexts.splice(0, savedStartupRestoreContexts.length, ...contexts);
      },
      clear: async () => {
        savedStartupRestoreContexts.splice(0, savedStartupRestoreContexts.length);
      },
    },
    featureGate: createWebRemoteControlFeatureGate(true),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
    reconnectWorkspace: vi.fn(async () => undefined),
    attachWorkspaceHost: defaultAttachWorkspaceHost,
    releaseWorkspaceHostAttachment: vi.fn(),
    disposeWorkspaceHostAttachmentsForWindow: vi.fn(),
    disposeWorkspaceHostAttachmentsForRemoteSession: vi.fn(),
    addTerminalOwner,
    removeTerminalOwner,
    createDeviceTransport: (transportOptions) => {
      const transportIndex = deliverPayloads.length;
      return {
        start: () => {
          deliverPayloads[transportIndex] = transportOptions.onPayload;
          if (transportOptions.auth.mode === "register") {
            transportOptions.onRegisteredAuth({
              deviceSid: `sid-${transportIndex + 1}`,
              passHash: `hash-${transportIndex + 1}`,
            });
          }
          transportOptions.onStateChange("waiting_terminal");
        },
        sendPayload: (payload) => {
          sentPayloads.push(payload);
          return true;
        },
        measurePayloadBytes: (payload) => JSON.stringify(payload).length,
        sendPayloadResult: (payload) => {
          sentPayloads.push(payload);
          return { kind: "sent" as const, bytes: JSON.stringify(payload).length };
        },
        dispose: vi.fn(),
      };
    },
    ...overrides,
  });

  return {
    manager,
    sentPayloads,
    savedStartupRestoreContexts,
    deliverPayload: (payload: WebRemoteControlAppPayload, transportIndex = 0) => {
      const deliver = deliverPayloads[transportIndex];
      if (!deliver) throw new Error("transport not started");
      deliver(payload);
    },
    addTerminalOwner,
    removeTerminalOwner,
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

describe("webRemoteControlManager 目录推送签名", () => {
  it("OW-P018：仅工作区名称或用途变化也推送，重复快照仍去重", async () => {
    const h = await createPrimedWorkspaceSyncHarness();
    try {
      // OW-P018：身份、连接和任务不变时，旧签名遗漏 label / purpose。
      const renamed = { ...h.workspace, label: "Renamed project" };
      h.manager.syncAvailableWorkspaces(1, [renamed]);
      expect(h.sentPayloads).toContainEqual({
        zcode_type: "workspace-list-updated",
        result: expect.objectContaining({ workspaces: expect.arrayContaining([renamed]) }),
      });
      h.sentPayloads.length = 0;
      h.manager.syncAvailableWorkspaces(1, [{ ...renamed }]);
      expect(h.sentPayloads).toEqual([]);
      h.manager.syncAvailableWorkspaces(1, [{ ...renamed, workspacePurpose: "conversation" }]);
      expect(h.sentPayloads).toHaveLength(1);
    } finally {
      await h.manager.disposeWindow(1);
    }
  });

  it.each(["updatedAt", "createdAt"] as const)(
    "OW-P009：仅 %s 变化时推送最新任务时间与排序，重复投影仍去重",
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

  it("同一窗口多个接入档案可并存，停止一个不释放另一个的终端 owner", async () => {
    const h = createManagerHarness();
    const connection = (profileId: string) => ({
      ...structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS),
      profileId,
      mode: "self-hosted" as const,
      relay: {
        wsUrl: "wss://relay.example/ws",
        pageUrl: "https://relay.example/remote/",
      },
    });

    await h.manager.start(1, {
      workspacePath: localWorkspace.workspacePath,
      connection: connection("lan"),
    });
    await h.manager.start(1, {
      workspacePath: localWorkspace.workspacePath,
      connection: connection("relay-b"),
    });

    expect(h.manager.getStatus(1).instances?.map((instance) => instance.profileId)).toEqual([
      "lan",
      "relay-b",
    ]);
    h.deliverPayload(
      {
        zcode_type: "bootstrap-request",
        requestId: "bootstrap-lan",
        terminalClientSessionId: "mobile-session-lan",
      },
      0,
    );
    h.deliverPayload(
      {
        zcode_type: "bootstrap-request",
        requestId: "bootstrap-relay",
        terminalClientSessionId: "mobile-session-relay",
      },
      1,
    );
    expect(h.addTerminalOwner).toHaveBeenCalledTimes(2);
    expect(h.removeTerminalOwner).not.toHaveBeenCalled();

    const lanOwnerId = h.addTerminalOwner.mock.calls[0]![1];
    await h.manager.stop(1, "lan");
    expect(h.removeTerminalOwner).toHaveBeenCalledWith(1, lanOwnerId);
    expect(h.manager.getStatus(1).instances?.map((instance) => instance.profileId)).toEqual([
      "relay-b",
    ]);

    await h.manager.disposeWindow(1);
  });

  it("并发启动授权按档案隔离，且恢复快照可路由到不同窗口", async () => {
    const connection = (profileId: string) => ({
      ...structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS),
      profileId,
      mode: "self-hosted" as const,
      relay: {
        wsUrl: "wss://relay.example/ws",
        pageUrl: "https://relay.example/remote/",
      },
    });
    const contextA = {
      workspacePath: "/workspace/a",
      connection: connection("lan"),
    };
    const contextB = {
      workspacePath: "/workspace/b",
      connection: connection("relay-b"),
    };
    const h = createManagerHarness();
    const restoreHarness = createManagerHarness({
      startupContexts: [
        { workspacePath: contextA.workspacePath, connection: contextA.connection },
        { workspacePath: contextB.workspacePath, connection: contextB.connection },
      ],
    });
    const authorizationA = h.manager.authorizeStart(1, contextA);
    const authorizationB = h.manager.authorizeStart(1, contextB);

    await h.manager.startAuthorized(1, contextA, authorizationA);
    await h.manager.startAuthorized(1, contextB, authorizationB);
    expect(h.manager.getStatus(1).instances?.map((instance) => instance.profileId)).toEqual([
      "lan",
      "relay-b",
    ]);
    await h.manager.stop(1, "lan");
    await h.manager.stop(1, "relay-b");

    expect(
      await restoreHarness.manager.restorePreviouslyEnabled(1, [
        { ...localWorkspace, workspacePath: contextA.workspacePath },
      ]),
    ).toBe(true);
    expect(
      await restoreHarness.manager.restorePreviouslyEnabled(2, [
        { ...localWorkspace, workspacePath: contextB.workspacePath },
      ]),
    ).toBe(true);
    expect(
      restoreHarness.manager.getStatus(1).instances?.map((instance) => instance.profileId),
    ).toEqual(["lan"]);
    expect(
      restoreHarness.manager.getStatus(2).instances?.map((instance) => instance.profileId),
    ).toEqual(["relay-b"]);
    expect(restoreHarness.savedStartupRestoreContexts).toHaveLength(2);

    await h.manager.disposeWindow(1);
    await restoreHarness.manager.disposeWindow(1);
    await restoreHarness.manager.disposeWindow(2);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const profile = (profileId: string) => ({
  ...structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS),
  profileId,
});

describe("多档案启动取消与恢复持久化", () => {
  it.each(["stop-profile", "stop-window", "suspend", "dispose"])(
    "cancels preparing start on %s",
    async (action) => {
      const entered = deferred();
      const release = deferred();
      const h = createManagerHarness({
        overrides: {
          getEndpointUrls: async () => {
            entered.resolve();
            await release.promise;
            return {} as never;
          },
        },
      });
      const started = h.manager
        .start(1, { workspacePath: "/workspace/a", connection: profile("a") })
        .then(
          () => "resolved",
          () => "rejected",
        );
      await entered.promise;
      if (action === "stop-profile") await h.manager.stop(1, "a");
      else if (action === "stop-window") await h.manager.stop(1);
      else if (action === "suspend") await h.manager.suspend(1, "endpoint-changed");
      else await h.manager.disposeWindow(1);
      release.resolve();
      const result = await started;
      const status = h.manager.getStatus(1);
      await h.manager.disposeWindow(1);
      expect({ result, status: status.status }).toEqual({ result: "rejected", status: "idle" });
    },
  );
  it("new start cancels an older preparation of the same profile", async () => {
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const h = createManagerHarness({
      overrides: {
        getEndpointUrls: async () => {
          if (++calls === 1) {
            entered.resolve();
            await release.promise;
          }
          return {} as never;
        },
      },
    });
    const first = h.manager
      .start(1, { workspacePath: "/workspace/older", connection: profile("a") })
      .then(
        () => "resolved",
        () => "rejected",
      );
    await entered.promise;
    await h.manager.start(1, { workspacePath: "/workspace/newer", connection: profile("a") });
    release.resolve();
    const outcome = await first;
    const actual = h.manager.getStatus(1).workspacePath;
    await h.manager.disposeWindow(1);
    expect({ outcome, actual }).toEqual({ outcome: "rejected", actual: "/workspace/newer" });
  });
  it("persists pending restores before their workspace becomes available", async () => {
    const contexts = [
      { workspacePath: "/workspace/a", connection: profile("a") },
      { workspacePath: "/workspace/b", connection: profile("b") },
    ];
    const h = createManagerHarness({
      startupContexts: contexts,
      overrides: {
        connectionProvider: {
          getSettings: async () => profile("a"),
          prepare: async (
            _windowId: number,
            settings: typeof DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS | undefined,
          ) => ({
            settings: settings!,
            relayWsUrl: "ws://relay.test/ws",
            mobileRemoteControlUrl: "https://relay.test/remote/v3",
            authStorageProvider: {
              load: async () => undefined,
              save: async () => {},
              clear: async () => {},
              rotate: async () => {},
            },
            commit: async () => {},
            dispose: async () => {},
          }),
        },
      },
    });
    await h.manager.restorePreviouslyEnabled(1, [
      { workspacePath: "/workspace/a", label: "A", kind: "local" },
    ]);
    const persisted = structuredClone(h.savedStartupRestoreContexts);
    await h.manager.disposeWindow(1);
    expect(persisted.map((c) => c.workspacePath)).toEqual(["/workspace/a", "/workspace/b"]);
  });
});

function restoreConnectionProvider(prepare?: (profileId: string) => Promise<void>) {
  return {
    getSettings: async () => profile("a"),
    prepare: async (
      _windowId: number,
      requested: typeof DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS | undefined,
    ) => {
      const settings = requested ?? profile("a");
      await prepare?.(settings.profileId!);
      return {
        settings,
        relayWsUrl: "ws://relay.test/ws",
        mobileRemoteControlUrl: "https://relay.test/remote/v3",
        authStorageProvider: {
          load: async () => undefined,
          save: async () => {},
          clear: async () => {},
          rotate: async () => {},
        },
        commit: async () => {},
        dispose: async () => {},
      };
    },
  };
}
it("恢复部分失败仍保存待恢复项，同窗口下次可以重试", async () => {
  let fail = true;
  const contexts = ["a", "b"].map((id) => ({
    workspacePath: `/workspace/${id}`,
    connection: profile(id),
  }));
  const h = createManagerHarness({
    startupContexts: contexts,
    overrides: {
      connectionProvider: restoreConnectionProvider(async (id) => {
        if (id === "b" && fail) throw new Error("temporary prepare failure");
      }),
    },
  });
  const candidates = contexts.map((context) => ({ ...context, label: context.workspacePath }));
  expect(await h.manager.restorePreviouslyEnabled(1, candidates)).toBe(true);
  expect(h.savedStartupRestoreContexts.map((c) => c.connection?.profileId)).toEqual(["a", "b"]);
  expect(h.manager.getStatus(1).instances?.map((i) => i.profileId)).toEqual(["a"]);
  fail = false;
  expect(await h.manager.restorePreviouslyEnabled(1, candidates)).toBe(true);
  expect(h.manager.getStatus(1).instances?.map((i) => i.profileId)).toEqual(["a", "b"]);
  await h.manager.stop(1, "b");
  expect(h.savedStartupRestoreContexts.map((c) => c.connection?.profileId)).toEqual(["a"]);
  expect(await h.manager.restorePreviouslyEnabled(1, candidates)).toBe(false);
  await h.manager.disposeWindow(1);
});
it("并发窗口只加载一次恢复快照，并且同一条待恢复项只被认领一次", async () => {
  const entered = deferred();
  const release = deferred();
  const context = { workspacePath: "/workspace/a", connection: profile("a") };
  const load = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return [context];
  });
  const h = createManagerHarness({
    overrides: {
      startupRestoreStorageProvider: { load, save: async () => {}, clear: async () => {} },
      connectionProvider: restoreConnectionProvider(),
    },
  });
  const first = h.manager.restorePreviouslyEnabled(1, [context]);
  await entered.promise;
  const second = h.manager.restorePreviouslyEnabled(2, [context]);
  release.resolve();
  const outcomes = await Promise.all([first, second]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(
    (h.manager.getStatus(1).instances?.length ?? 0) +
      (h.manager.getStatus(2).instances?.length ?? 0),
  ).toBe(1);
  await h.manager.disposeWindow(1);
  await h.manager.disposeWindow(2);
});

it.each(["profile", "window"])("显式停止 %s 会撤销正在恢复的档案记录", async (target) => {
  const entered = deferred();
  const release = deferred();
  const context = { workspacePath: "/workspace/a", connection: profile("a") };
  const h = createManagerHarness({
    startupContexts: [context],
    overrides: {
      connectionProvider: restoreConnectionProvider(async () => {
        entered.resolve();
        await release.promise;
      }),
    },
  });
  const restore = h.manager.restorePreviouslyEnabled(1, [context]);
  await entered.promise;
  await h.manager.stop(1, target === "profile" ? "a" : undefined);
  release.resolve();
  expect(await restore).toBe(false);
  expect(h.savedStartupRestoreContexts).toEqual([]);
  expect(await h.manager.restorePreviouslyEnabled(1, [context])).toBe(false);
  expect(h.manager.getStatus(1).status).toBe("idle");
});
