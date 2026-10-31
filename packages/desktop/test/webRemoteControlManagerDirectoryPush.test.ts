import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  WebRemoteControlAppPayload,
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceTarget,
} from "@zcode/shared";
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

function createManagerHarness() {
  const sentPayloads: WebRemoteControlAppPayload[] = [];
  const settings: AppSettings = { recentProjects: [], locale: "zh-CN" };
  let storedAuth: { deviceSid: string; passHash: string } | undefined;
  let deliverPayload: ((payload: WebRemoteControlAppPayload) => void) | undefined;
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
      load: async () => undefined,
      save: async () => {},
      clear: async () => {},
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
    setTerminalOwner: vi.fn(),
    createDeviceTransport: (transportOptions) => ({
      start: () => {
        deliverPayload = transportOptions.onPayload;
        if (transportOptions.auth.mode === "register") {
          transportOptions.onRegisteredAuth({ deviceSid: "sid-1", passHash: "hash-1" });
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
    }),
  });

  return {
    manager,
    sentPayloads,
    deliverPayload: (payload: WebRemoteControlAppPayload) => {
      if (!deliverPayload) throw new Error("transport not started");
      deliverPayload(payload);
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
});
