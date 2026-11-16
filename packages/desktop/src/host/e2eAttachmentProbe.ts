// WT04 direct 证据（docs/specs/wt04-direct-runtime-association-openzwork.md）：
// Window Host 对真实 V4 conversation subscribe/unsubscribe/ACK 与 attachment dispose 的
// 只读记录。probe 只包一层 Proxy 观察既有调用，不新增端口、不发送测试订阅、不改产品
// ACK/背压/路由语义；仅在专用 E2E bridge flag、非空 run ID 与有效 artifact 目录同时
// 存在时启用。runtime 查询沿用 getWorkspaceRuntimeIdentity 的 existing-only 合同，
// 不为诊断拉起 dormant runtime。
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { shouldEnableE2ETestBridge, type WindowHostAttachmentScope } from "@zcode/shared";
import { conversationTopic } from "@zcode/shared/zcode-protocol-v4";
import type {
  IZCodeAgentService,
  IZCodeSessionService,
  ZCodeAgentV4ClientMode,
  ZCodeAgentWorkspaceTarget,
} from "@zcode/services";

export type HostE2EConversationSubscribeParams = Parameters<
  IZCodeAgentService["subscribeConversationV4"]
>[0];
export type HostE2EConversationUnsubscribeParams = Parameters<
  IZCodeAgentService["unsubscribeConversationV4"]
>[0];

export interface HostE2EAttachmentProbeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface HostE2EAttachmentProbeRecord {
  attachmentId: string;
  clientMode: ZCodeAgentV4ClientMode;
  event: "subscribed" | "unsubscribed" | "attachment-disposed";
  hostConnectionId: string;
  hostGeneration: number;
  hostProcessId: number;
  recordedAt: string;
  remoteSessionId: string | null;
  runtimeIdentity: HostE2EAttachmentProbeIdentity | null;
  runtimeIdentityError?: string;
  scope: WindowHostAttachmentScope;
  scopeMatchesTarget: boolean;
  seq: number;
  sessionId: string;
  subscribeRemoteSessionId: string | null;
  subscriptionId: string;
  topic: string;
  workspaceIdentity: string | null;
  workspaceKey: string;
  workspacePath: string;
}

export interface HostE2EAttachmentProbeBinding {
  service: IZCodeAgentService;
  dispose(): Promise<void>;
}

export interface HostE2EAttachmentProbeContext {
  attachmentId: string;
  generation: number;
}

const PROBE_FILE_NAME = `host-attachment-subscriptions-${process.pid}.ndjson`;

export function resolveHostE2EAttachmentProbeFilePath(artifactDir: string): string {
  const outputPath = resolve(artifactDir.trim(), "host-probes", PROBE_FILE_NAME);
  const allowedOutputRoot = resolve(artifactDir.trim());
  const relativePath = relative(allowedOutputRoot, outputPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error("Host E2E probe artifact path escaped the run directory");
  }
  return outputPath;
}

export function createHostE2EAttachmentProbe(options: {
  enabled: boolean;
  artifactDir?: string;
  hostProcessId?: number;
  onWarn?: (message: string, error: unknown) => void;
}) {
  let outputPath: string | null = null;
  if (options.enabled) {
    const artifactDir = options.artifactDir?.trim();
    if (artifactDir) {
      try {
        outputPath = resolveHostE2EAttachmentProbeFilePath(artifactDir);
      } catch (error) {
        // artifact 目标无效时禁用探针而非崩溃 Host：验收端把缺失记录判失败。
        options.onWarn?.("host E2E attachment probe disabled: invalid artifact target", error);
        outputPath = null;
      }
    }
  }
  const hostProcessId = options.hostProcessId ?? process.pid;
  let seq = 0;
  let writeChain = Promise.resolve();

  const appendRecord = (record: HostE2EAttachmentProbeRecord): Promise<void> => {
    if (!outputPath) return Promise.resolve();
    const current = writeChain.then(async () => {
      await mkdir(dirname(outputPath!), { recursive: true });
      await appendFile(outputPath!, `${JSON.stringify(record)}\n`, "utf8");
    });
    // 诊断失败不能破坏产品业务调用；写失败仅丢弃该条记录。
    writeChain = current.catch((error) => {
      options.onWarn?.("failed to write host E2E attachment probe record", error);
    });
    return current;
  };

  const hostScope = (scope: WindowHostAttachmentScope) =>
    scope.kind === "remote" ? scope.remoteSessionId : null;

  const baseRecord = (input: {
    attachmentId: string;
    clientMode: ZCodeAgentV4ClientMode;
    event: HostE2EAttachmentProbeRecord["event"];
    hostConnectionId: string;
    hostGeneration: number;
    params: HostE2EConversationSubscribeParams | HostE2EConversationUnsubscribeParams;
    scope: WindowHostAttachmentScope;
    sessionId: string;
    subscriptionId: string;
  }): Omit<HostE2EAttachmentProbeRecord, "runtimeIdentity" | "runtimeIdentityError"> => {
    seq += 1;
    const remoteSessionId = hostScope(input.scope);
    const workspaceKey = input.params.workspaceIdentity?.trim() || input.params.workspacePath;
    return {
      attachmentId: input.attachmentId,
      clientMode: input.clientMode,
      event: input.event,
      hostConnectionId: input.hostConnectionId,
      hostGeneration: input.hostGeneration,
      hostProcessId,
      recordedAt: new Date().toISOString(),
      remoteSessionId,
      scope: input.scope,
      scopeMatchesTarget: matchesAttachmentScope(input.scope, input.params),
      seq,
      sessionId: input.sessionId,
      subscribeRemoteSessionId: input.params.remoteSessionId ?? null,
      subscriptionId: input.subscriptionId,
      topic: input.sessionId ? conversationTopic(input.sessionId) : "",
      workspaceIdentity: input.params.workspaceIdentity ?? null,
      workspaceKey,
      workspacePath: input.params.workspacePath,
    };
  };

  const recordSubscribed = async (input: {
    attachmentId: string;
    clientMode: ZCodeAgentV4ClientMode;
    hostConnectionId: string;
    hostGeneration: number;
    params: HostE2EConversationSubscribeParams;
    scope: WindowHostAttachmentScope;
    sessionService?: Pick<IZCodeSessionService, "getWorkspaceRuntimeIdentity">;
    subscriptionId: string;
  }): Promise<void> => {
    if (!outputPath) return;

    const remoteSessionId = hostScope(input.scope);
    // runtime 查询 target 与该 attachment 的实际 scope/target 对齐；existing-only，
    // runtime 不存在/已退出时失败并记录，不拉起 dormant runtime。
    const runtimeTarget: ZCodeAgentWorkspaceTarget = {
      workspacePath: input.params.workspacePath,
      ...(input.params.workspaceIdentity
        ? { workspaceIdentity: input.params.workspaceIdentity }
        : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    };
    let runtimeIdentity: HostE2EAttachmentProbeIdentity | null = null;
    let runtimeIdentityError: string | undefined;
    if (!input.sessionService) {
      runtimeIdentityError = "session-service-unavailable";
    } else {
      try {
        const identity = await input.sessionService.getWorkspaceRuntimeIdentity(runtimeTarget);
        runtimeIdentity = {
          generation: identity.generation,
          identity: identity.identity,
          ...(identity.processId !== undefined ? { processId: identity.processId } : {}),
          workspaceKey: identity.workspaceKey,
        };
      } catch (error) {
        runtimeIdentityError = error instanceof Error ? error.name : "unknown-error";
      }
    }
    await appendRecord({
      ...baseRecord({ ...input, event: "subscribed", sessionId: input.params.sessionId }),
      runtimeIdentity,
      ...(runtimeIdentityError ? { runtimeIdentityError } : {}),
    });
  };

  const recordEnded = async (input: {
    attachmentId: string;
    clientMode: ZCodeAgentV4ClientMode;
    event: "unsubscribed" | "attachment-disposed";
    hostConnectionId: string;
    hostGeneration: number;
    params: HostE2EConversationUnsubscribeParams;
    scope: WindowHostAttachmentScope;
    sessionId: string;
  }): Promise<void> => {
    if (!outputPath) return;
    await appendRecord({
      ...baseRecord({ ...input, subscriptionId: input.params.subscriptionId }),
      runtimeIdentity: null,
    });
  };

  return {
    enabled: outputPath !== null,
    outputPath,
    wrapService(input: {
      attachmentId: string;
      clientMode: ZCodeAgentV4ClientMode;
      hostConnectionId: string;
      hostGeneration: number;
      scope: WindowHostAttachmentScope;
      service: IZCodeAgentService;
      sessionService?: Pick<IZCodeSessionService, "getWorkspaceRuntimeIdentity">;
    }): HostE2EAttachmentProbeBinding {
      if (!outputPath) return { service: input.service, async dispose() {} };
      const sessionBySubscription = new Map<
        string,
        { params: HostE2EConversationUnsubscribeParams; sessionId: string }
      >();
      let disposed = false;
      const service = new Proxy(input.service, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property === "subscribeConversationV4" && typeof value === "function") {
            return async (params: HostE2EConversationSubscribeParams) => {
              // 先执行真实订阅并透传 ACK；记录只观察结果，不改变返回值/时序。
              const result = await value.call(target, params);
              const unsubscribeParams: HostE2EConversationUnsubscribeParams = {
                workspacePath: params.workspacePath,
                ...(params.workspaceIdentity
                  ? { workspaceIdentity: params.workspaceIdentity }
                  : {}),
                ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
                subscriptionId: result.ack.subscriptionId,
              };
              sessionBySubscription.set(result.ack.subscriptionId, {
                params: unsubscribeParams,
                sessionId: params.sessionId,
              });
              await recordSubscribed({
                ...input,
                params,
                subscriptionId: result.ack.subscriptionId,
              }).catch(() => undefined);
              return result;
            };
          }
          if (property === "unsubscribeConversationV4" && typeof value === "function") {
            return async (params: HostE2EConversationUnsubscribeParams) => {
              const tracked = sessionBySubscription.get(params.subscriptionId);
              const result = await value.call(target, params);
              if (tracked) {
                sessionBySubscription.delete(params.subscriptionId);
                await recordEnded({
                  ...input,
                  event: "unsubscribed",
                  params,
                  sessionId: tracked.sessionId,
                }).catch(() => undefined);
              }
              return result;
            };
          }
          return value;
        },
      });
      return {
        service,
        async dispose() {
          if (disposed) return;
          disposed = true;
          // attachment dispose（端口关闭/换代/registry detach）时记录所有仍未退订的
          // subscription，避免已失效订阅被判有效。
          const tracked = Array.from(sessionBySubscription, ([subscriptionId, entry]) => ({
            ...entry,
            subscriptionId,
          }));
          sessionBySubscription.clear();
          await Promise.all(
            tracked.map(({ params, sessionId }) =>
              recordEnded({
                ...input,
                event: "attachment-disposed",
                params,
                sessionId,
              }).catch(() => undefined),
            ),
          );
        },
      };
    },
  };
}

/**
 * 进程级单例：每个 Window Host 进程一个 ndjson 文件（按 host pid 区分）。
 * gate 三条件缺一即禁用（零输出、零额外 runtime 查询）。
 */
function createHostE2EAttachmentProbeSingleton() {
  try {
    return createHostE2EAttachmentProbe({
      enabled: shouldEnableE2ETestBridge(process.env),
      artifactDir: process.env.ZCODE_E2E_ARTIFACT_DIR,
    });
  } catch {
    // 单例初始化异常按禁用处理，不阻塞 Host 启动；验收端把缺失记录判失败。
    return createHostE2EAttachmentProbe({ enabled: false });
  }
}

export const hostE2EAttachmentProbe = createHostE2EAttachmentProbeSingleton();

function matchesAttachmentScope(
  scope: WindowHostAttachmentScope,
  target: ZCodeAgentWorkspaceTarget,
): boolean {
  if (scope.kind === "local") return !target.remoteSessionId;
  if (scope.kind !== "remote") return false;
  return (
    scope.workspacePath === target.workspacePath &&
    scope.workspaceIdentity.trim() === (target.workspaceIdentity?.trim() || "") &&
    (!target.remoteSessionId || target.remoteSessionId === scope.remoteSessionId)
  );
}
