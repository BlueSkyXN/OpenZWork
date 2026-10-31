import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionView } from "@zcode/provider";
import { zcodeProtocolMethods } from "@zcode/shared";
import { V4_METHODS, type CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { setDataBaseDir } from "../src/paths.js";
import { createZCodeAgentConnectionScope } from "../src/zcode-agent/zcodeAgentConnectionScope.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";

const { request, getClient } = vi.hoisted(() => ({ request: vi.fn(), getClient: vi.fn() }));
vi.mock("../src/zcode-agent/zcodeAgentProcessManager.js", () => ({
  ZCodeAgentProcessManager: class {
    // OpenZWork v3.17.1：目录协商按 isSharedRuntime 判定共享 runtime；测试为独立 runtime。
    isSharedRuntime = () => false;
    getClient = getClient;
    onRuntimeLifecycle() {
      return { dispose() {} };
    }
    onRuntimeRestarted() {
      return { dispose() {} };
    }
    markReady() {}
    disposeAll() {}
  },
}));

const MODEL_COMMANDS = [
  "createSession",
  "createSelectionSideSession",
  "sendText",
  "sendGoalCommand",
  "compact",
  "forkAssistant",
  "editUserQuery",
  "retryTurn",
  "sendQueuedNow",
  "switchModelConfig",
] as const;
const READY_VIEW = {
  revision: 1,
  providers: [{ providerId: "personal", config: {}, models: [{ modelId: "model", config: {} }] }],
} as ModelSelectionView;

let root: string;
let service: ReturnType<typeof createZCodeAgentService>;
let refresh: () => Promise<unknown>;
let client: {
  request: typeof request;
  transportKind: "stdio";
  onNotification: () => { dispose(): void };
  onRequest: () => { dispose(): void };
  onClose: () => { dispose(): void };
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "provider-refresh-barrier-"));
  setDataBaseDir(root);
  refresh = async () => ({ refreshed: true });
  request
    .mockReset()
    .mockImplementation(
      async (method: string, params: unknown, schema: { parse(value: unknown): unknown }) => {
        // OpenZWork v3.17.1：workspace 启动新增 runtime/capabilities 目录来源协商（先于命令屏障），
        // mock 提供最小应答；sessionWorkspaceRouting 缺省为 false（非共享 runtime 不受影响）。
        if (method === zcodeProtocolMethods.runtimeCapabilities) return schema.parse({});
        if (method === zcodeProtocolMethods.providerRefreshRegistry)
          return schema.parse(await refresh());
        if (method === V4_METHODS.command)
          return schema.parse({
            commandId: (params as CommandEnvelope).commandId,
            status: "accepted",
            revisionAtDecision: 1,
          });
        throw new Error(`Unexpected method ${method}`);
      },
    );
  client = {
    request,
    transportKind: "stdio",
    onNotification: () => ({ dispose() {} }),
    onRequest: () => ({ dispose() {} }),
    onClose: () => ({ dispose() {} }),
  };
  getClient.mockReset().mockResolvedValue(client);
  service = createZCodeAgentService({
    modelSelectionReadinessSource: { getView: async () => READY_VIEW },
  });
  await service.initialize({ workspacePath: root });
  request.mockClear();
});

afterEach(async () => {
  service?.disposeAll();
  setDataBaseDir(null);
  await rm(root, { recursive: true, force: true });
});

function command(type: CommandEnvelope["type"]): CommandEnvelope {
  return {
    commandId: `command-${type}`,
    clientId: "trusted-host",
    sessionId: "session",
    type,
    payload:
      type === "createSession"
        ? { workspaceId: "workspace" }
        : type === "sendText"
          ? { text: "hello" }
          : {},
    issuedAt: 1,
  };
}

describe.each(["desktop-continuous", "web-remote-replayable"] as const)(
  "Worker Personal Config barrier: %s",
  (clientMode) => {
    function facade() {
      return createZCodeAgentConnectionScope(service, {
        connectionId: `connection-${clientMode}`,
        clientMode,
        role: "trusted-host-relay",
      }).service;
    }

    it.each(MODEL_COMMANDS)(
      "waits for Worker refresh before %s reaches admission",
      async (type) => {
        const gate = Promise.withResolvers<unknown>();
        refresh = () => gate.promise;
        const sending = facade().sendConversationCommandV4({
          workspacePath: root,
          envelope: command(type),
        });
        const result = sending.then(
          (ack) => ({ ack }),
          (error: unknown) => ({ error }),
        );
        try {
          await vi.waitFor(() => expect(request).toHaveBeenCalled());
          expect(request.mock.calls.map(([method]) => method)).toEqual([
            zcodeProtocolMethods.providerRefreshRegistry,
          ]);
          expect(request).toHaveBeenCalledWith(
            zcodeProtocolMethods.providerRefreshRegistry,
            { reason: "v4_command" },
            expect.any(Object),
          );
          gate.resolve({ refreshed: true });
          await expect(result).resolves.toMatchObject({ ack: { status: "accepted" } });
          expect(request.mock.calls.map(([method]) => method)).toEqual([
            zcodeProtocolMethods.providerRefreshRegistry,
            V4_METHODS.command,
          ]);
          expect(getClient).toHaveBeenCalledTimes(1);
          if (type === "sendText")
            expect(request.mock.calls[1]?.[1]).toMatchObject({
              payload: { inputOrigin: clientMode === "desktop-continuous" ? "desktop" : "mobile" },
            });
        } finally {
          gate.resolve({ refreshed: true });
          await result;
        }
      },
    );

    it.each(["request-error", "invalid-result"] as const)(
      "rejects %s without admission and retries a later refresh",
      async (failure) => {
        const error = new Error("Worker registry read failed");
        refresh = async () => {
          if (failure === "request-error") throw error;
          return { refreshed: false };
        };
        const scoped = facade();
        const sending = scoped.sendConversationCommandV4({
          workspacePath: root,
          envelope: command("switchModelConfig"),
        });
        if (failure === "request-error") await expect(sending).rejects.toBe(error);
        else await expect(sending).rejects.toThrow();
        expect(request.mock.calls.map(([method]) => method)).toEqual([
          zcodeProtocolMethods.providerRefreshRegistry,
        ]);
        refresh = async () => ({ refreshed: true });
        await expect(
          scoped.sendConversationCommandV4({ workspacePath: root, envelope: command("sendText") }),
        ).resolves.toMatchObject({ status: "accepted" });
        expect(request.mock.calls.map(([method]) => method)).toEqual([
          zcodeProtocolMethods.providerRefreshRegistry,
          zcodeProtocolMethods.providerRefreshRegistry,
          V4_METHODS.command,
        ]);
      },
    );

    it("keeps stop independent of a failed refresh", async () => {
      refresh = async () => {
        throw new Error("refresh unavailable");
      };
      await expect(
        facade().sendConversationCommandV4({ workspacePath: root, envelope: command("stop") }),
      ).resolves.toMatchObject({ status: "accepted" });
      expect(request.mock.calls.map(([method]) => method)).toEqual([V4_METHODS.command]);
    });
  },
);
