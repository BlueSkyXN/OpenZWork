/* eslint-disable max-lines -- Web 远程控制 manager 承担外部 relay app payload 路由与 workspace bridge 编排。 */
import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { MessagePortProtocol, type MessagePortLike, type MessagePortPayload } from "@zcode/rpc";
import {
  createAcknowledgedWebRemoteControlRelayProtocol,
  type AcknowledgedWebRemoteControlRelayProtocolAdapter,
  type WebRemoteControlPayloadSendResult,
} from "@zcode/client";
import {
  buildWebRemoteControlExternalQrUrl,
  OFFICIAL_WEB_REMOTE_CONTROL_V1,
  WEB_REMOTE_CONTROL_OUTBOUND_PAYLOAD_BUFFER_TIMEOUT_MS,
  type ZCodeEndpointUrls,
  type WebRemoteControlConnectionSettings,
  type HostPreparedProjectWorkspace,
  type HostProjectWorkspaceNavigationInput,
  resolveUnrecognizedWebRemoteControlRequest,
  resolveWebRemoteControlWorkspaceKey,
  type WebRemoteControlAppPayload,
  type WebRemoteControlContext,
  type WebRemoteControlExternalWorkspaceBridge,
  type WebRemoteControlFailure,
  type WebRemoteControlFailureReason,
  type WebRemoteControlMobileDeviceInfo,
  type WebRemoteControlMobileLogPayload,
  type WebRemoteControlMobileViewState,
  type WebRemoteControlMobileTaskViewUpdatePayload,
  type WebRemoteControlPlatformMethod,
  type WebRemoteControlPlatformMethodArgsMap,
  type WebRemoteControlPlatformMethodResultMap,
  type WebRemoteControlPlatformRequestPayload,
  type WebRemoteControlPlatformResponsePayload,
  type WebRemoteControlRpcTransportPayload,
  type WebRemoteControlStartResult,
  type WebRemoteControlTaskTarget,
  type WebRemoteControlLegacyDirectory,
  type WebRemoteControlStatus,
  type WebRemoteControlWindowBootstrapResult,
  type WebRemoteControlWorkspaceBridgeOpenPayload,
  type WebRemoteControlWorkspaceListResult,
  type WebRemoteControlWorkspaceTarget,
  measureWebRemoteControlRpcRelayEnvelopeBytes,
} from "@zcode/shared";
import {
  WebRemoteControlDeviceTransport,
  type WebRemoteControlDeviceTransportOptions,
  type WebRemoteControlDeviceTransportState,
  type WebRemoteControlDeviceTransportAuth,
} from "./webRemoteControlTransport.js";
// fork 净化：上游 import createWebRemoteControlV2Http / WebRemoteControlLogin / deviceStorage
// （官方 V2 http/token 账号通道）与 MobilePushConnection（官方 HTTP 通知）不随入；
// 本地 HMAC 通道用我方 relay contract 与 adapters。
// mobileLogPull 为配对 WS payload 上的手机日志拉取编排（与鉴权通道无关），保留。
import type { WebRemoteControlPreparedConnection } from "./web-remote-relay/index.js";
import type { WebRemoteControlRelayAuthProvider } from "./web-remote-relay/index.js";
import type { WebRemoteControlRelayAuthStorageProvider } from "./web-remote-relay/index.js";
import {
  createMobileLogPullCoordinator,
  MobileLogPullError,
  type MobileLogPullQuery,
  type MobileLogPullShard,
  type MobileLogPullSummary,
  type MobileLogSink,
} from "./web-remote-relay/index.js";

import type { WebRemoteControlFeatureGate } from "./webRemoteControlFeatureGate.js";
import {
  respondToWebRemoteControlActionRequest,
  type RunWebRemoteControlRendererAction,
  type WebRemoteControlActionRequestPayload,
} from "#src/main/web-remote-relay/index.js";

interface WebRemoteControlHostAttachmentHandle {
  entryId: string;
  attachmentId: string;
  process: ElectronUtilityProcess;
  port: MessagePortMain;
  remoteKind?: string;
}

interface WorkspaceBridgeRuntime {
  terminalOwnerId?: string;
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  hostEntryId: string;
  attachmentId: string;
  kind: "local" | "remote";
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  hostProtocol?: MessagePortProtocol;
  relayProtocol?: AcknowledgedWebRemoteControlRelayProtocolAdapter;
  disposeBridge?: () => void;
  readyAnnounced: boolean;
  degraded: boolean;
}

interface WebRemoteControlDeviceTransportLike {
  start(): void;
  sendPayload(payload: WebRemoteControlAppPayload): boolean;
  sendPayloadResult?(payload: WebRemoteControlAppPayload): WebRemoteControlPayloadSendResult;
  measurePayloadBytes?(payload: WebRemoteControlAppPayload): number;
  dispose(): void;
}

interface WebRemoteControlStartupRestoreContext {
  connection?: WebRemoteControlConnectionSettings;
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
}

export interface WebRemoteControlStartAuthorization {
  token: string;
  expiresAt: number;
  windowId: number;
  workspaceKey: string;
  remoteSessionId?: string;
}

const WEB_REMOTE_CONTROL_START_AUTHORIZATION_TTL_MS = 30_000;

interface WindowControlLifecycle {
  controller: AbortController;
}

interface WindowControlRuntime {
  // fork 净化：远控保留本地 HMAC/directGateway 通道，prepared connection 由我方 connectionProvider 提供；
  // 上游此处的 terminalOwner 已在共同区（terminalOwner 行存在），不需要从上游侧重复引入。
  connection?: WebRemoteControlPreparedConnection;
  windowId: number;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  theme?: WebRemoteControlContext["theme"];
  status: WebRemoteControlStatus["status"];
  error?: string;
  failure?: WebRemoteControlFailure;
  deviceSid: string;
  passHash: string;
  deviceMid: string;
  connectUrl: string;
  qrUrl: string;
  transport: WebRemoteControlDeviceTransportLike;
  mobileConnected: boolean;
  hasEverPaired: boolean;
  hasObservedSendReadyForPairing: boolean;
  transportState?: WebRemoteControlDeviceTransportState;
  mobileViewState?: WebRemoteControlMobileViewState;
  mobileTaskView?: NonNullable<WebRemoteControlStatus["mobileTaskView"]>;
  mobileTaskViewEpoch?: string;
  mobileTaskViewSeq?: number;
  mobileDeviceInfo?: WebRemoteControlMobileDeviceInfo;
  currentBridge?: WorkspaceBridgeRuntime;
  bridgeOpen?: {
    bridgeSessionId: string;
    bridgeGeneration?: number;
    intentKey: string;
    hostRequestId: string;
    preparingProject: boolean;
    promise: Promise<WebRemoteControlExternalWorkspaceBridge>;
  };
  pendingBridgeInvalidation?: Extract<
    WebRemoteControlAppPayload,
    { zcode_type: "bridge-degraded" }
  >;
  pendingOutboundPayloads: WebRemoteControlAppPayload[];
  pendingOutboundPayloadTimer?: ReturnType<typeof setTimeout>;
  mobileDisconnectGraceTimer?: ReturnType<typeof setTimeout>;
}

interface WebRemoteControlManagerDependencies {
  connectionProvider?: {
    getSettings(): Promise<WebRemoteControlConnectionSettings>;
    prepare(
      windowId: number,
      requested: WebRemoteControlConnectionSettings | undefined,
      signal: AbortSignal,
      resetPairing?: boolean,
    ): Promise<WebRemoteControlPreparedConnection>;
  };
  getEndpointUrls?: () => Promise<ZCodeEndpointUrls> | ZCodeEndpointUrls;
  relayWsUrl: string;
  mobileRemoteControlUrl: string;
  deviceMid: string;
  deviceName: string;
  appVersion: string;
  authProvider: WebRemoteControlRelayAuthProvider;
  authStorageProvider: WebRemoteControlRelayAuthStorageProvider;
  startupRestoreStorageProvider: {
    load(): Promise<WebRemoteControlStartupRestoreContext | undefined>;
    save(context: WebRemoteControlStartupRestoreContext): Promise<void>;
    clear(): Promise<void>;
  };
  featureGate: WebRemoteControlFeatureGate;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  relayMessageLogger?: {
    info: (...args: unknown[]) => void;
  };
  platformHandlers: {
    [K in WebRemoteControlPlatformMethod]: (
      args: WebRemoteControlPlatformMethodArgsMap[K],
    ) => Promise<WebRemoteControlPlatformMethodResultMap[K]>;
  };
  reconnectWorkspace: (windowId: number, workspaceKey: string) => Promise<void>;
  /** 手机置顶/归档/新建本地项目交给目标窗口 Renderer 执行；缺省时三类请求回 success:false。 */
  runRendererAction?: RunWebRemoteControlRendererAction;
  prepareProjectWorkspace?: (
    windowId: number,
    project: HostProjectWorkspaceNavigationInput,
    requestId: string,
  ) => Promise<HostPreparedProjectWorkspace>;
  cancelProjectPreparation?: (windowId: number, requestId: string) => void;
  onStatusChanged?: (windowId: number, status: WebRemoteControlStatus) => void;
  attachWorkspaceHost: (
    windowId: number,
    context: WebRemoteControlContext & { kind: "local" | "remote"; terminalOwnerId?: string },
  ) => Promise<WebRemoteControlHostAttachmentHandle>;
  setTerminalOwner: (windowId: number, ownerId: string | null) => void;
  releaseWorkspaceHostAttachment: (attachmentId: string) => void;
  disposeWorkspaceHostAttachmentsForWindow: (windowId: number, reason: string) => void;
  disposeWorkspaceHostAttachmentsForRemoteSession: (
    remoteSessionId: string,
    reason: string,
  ) => void;
  createDeviceTransport?: (
    options: WebRemoteControlDeviceTransportOptions,
  ) => WebRemoteControlDeviceTransportLike;
  /** 手机实时日志（mobile-log）落盘；未注入时直接丢弃。 */
  mobileLogSink?: Pick<MobileLogSink, "append">;
  /** 手机日志拉取单片超时（单测注入）。 */
  mobileLogPullShardTimeoutMs?: number;
}

/** 可拉取手机日志的目标连接。 */
export interface WebRemoteControlMobileLogPullTarget {
  windowId: number;
  deviceLabel: string;
}

// Bugfix: 外部 relay 首次鉴权会受边缘层冷启动和网络抖动影响，实测可能略超 15s。
// 这里等待到 30s，避免在 device 已经快进入 waiting_terminal 时过早销毁可用连接。
const EXTERNAL_RELAY_QR_READY_TIMEOUT_MS = 30_000;
const MOBILE_DISCONNECT_STATUS_GRACE_MS = 3_000;

function createFailure(
  reason: WebRemoteControlFailureReason,
  message?: string,
): WebRemoteControlFailure {
  return { reason, message };
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function mapWorkspaceBridgeFailureReason(error: unknown): WebRemoteControlFailureReason {
  switch (getErrorCode(error)) {
    case "DESKTOP_HOST_MISSING":
      return "desktop-disconnected";
    case "REMOTE_SESSION_MISSING":
    case "REMOTE_SESSION_WINDOW_MISMATCH":
      return "workspace-closed";
    case "REMOTE_WORKSPACE_IDENTITY_MISSING":
    case "REMOTE_WORKSPACE_IDENTITY_MISMATCH":
      return "unsupported-action";
    default:
      return "unexpected-error";
  }
}

function wrapElectronPort(port: MessagePortMain): MessagePortLike {
  return {
    addEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
      port.on("message", listener);
    },
    removeEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
      port.off("message", listener);
    },
    postMessage(data: MessagePortPayload) {
      port.postMessage(data);
    },
    start() {
      port.start();
    },
    close() {
      port.close();
    },
  };
}

function getPathLabel(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? workspacePath;
}

function isBridgeableRemoteTarget(target: WebRemoteControlWorkspaceTarget): boolean {
  return target.kind !== "remote" || Boolean(target.workspaceIdentity && target.remoteSessionId);
}

function isBridgeableRemoteTask(task: WebRemoteControlTaskTarget): boolean {
  return task.workspaceKind !== "remote" || Boolean(task.workspaceIdentity && task.remoteSessionId);
}

function toExternalBridge(
  runtime: WorkspaceBridgeRuntime,
): WebRemoteControlExternalWorkspaceBridge {
  const base = {
    ...(runtime.terminalOwnerId ? { terminalOwnerId: runtime.terminalOwnerId } : {}),
    bridgeSessionId: runtime.bridgeSessionId,
    ...(runtime.bridgeGeneration !== undefined
      ? { bridgeGeneration: runtime.bridgeGeneration }
      : {}),
    ...(runtime.recoveryId ? { recoveryId: runtime.recoveryId } : {}),
    workspaceKey: runtime.workspaceKey,
    workspacePath: runtime.workspacePath,
    initialTaskId: runtime.initialTaskId,
  };

  if (runtime.kind === "remote") {
    if (!runtime.workspaceIdentity || !runtime.remoteSessionId) {
      throw new Error("远程 workspace bridge 缺少 workspaceIdentity 或 remoteSessionId。");
    }
    return {
      ...base,
      kind: "remote",
      workspaceIdentity: runtime.workspaceIdentity,
      remoteSessionId: runtime.remoteSessionId,
      capabilities: { windowProjectDirectory: true },
    };
  }

  return {
    ...base,
    kind: "local",
  };
}

async function resetExternalRelayDeviceAuth(
  authStorageProvider: WebRemoteControlRelayAuthStorageProvider,
  logger: WebRemoteControlManagerDependencies["logger"],
  reason: "manual" | "auth-failed" | "device-not-found" | "leaked-qr",
): Promise<void> {
  await authStorageProvider.clear();
  logger.info("[web-remote-control] external relay auth reset", { reason });
}

export function createWebRemoteControlManager(dependencies: WebRemoteControlManagerDependencies) {
  const runtimes = new Map<number, WindowControlRuntime>();
  // 取消令牌覆盖首次启动到连接释放，拒绝旧代异步结果。
  const windowLifecycles = new Map<number, WindowControlLifecycle>();
  const startAuthorizations = new Map<string, WebRemoteControlStartAuthorization>();
  const availableWorkspacesByWindowId = new Map<number, WebRemoteControlWorkspaceTarget[]>();
  const mobileLogPulls = createMobileLogPullCoordinator({
    shardTimeoutMs: dependencies.mobileLogPullShardTimeoutMs,
  });

  // 同步修复：这些业务所有者在删除相邻遥测函数时被一起移除，启动与恢复仍依赖它们。
  const availableTasksByWindowId = new Map<number, WebRemoteControlTaskTarget[]>();
  const legacyDirectoriesByWindowId = new Map<number, WebRemoteControlLegacyDirectory[]>();
  const pushedWorkspaceListSignaturesByWindowId = new Map<number, string>();
  let startupRestoreClaimed = false;
  let lifecycleRevision = 0;

  function createTransport(options: WebRemoteControlDeviceTransportOptions) {
    return dependencies.createDeviceTransport
      ? dependencies.createDeviceTransport(options)
      : new WebRemoteControlDeviceTransport(options);
  }

  function clearStartAuthorizationsForWindow(windowId: number): void {
    for (const [token, authorization] of startAuthorizations) {
      if (authorization.windowId === windowId) {
        startAuthorizations.delete(token);
      }
    }
  }

  function authorizeStart(
    windowId: number,
    context: WebRemoteControlContext,
  ): WebRemoteControlStartAuthorization {
    const now = Date.now();
    // 同一窗口只保留最近一次 IPC dispatch 对应的内部票据，避免旧请求与新 workspace 上下文并存。
    clearStartAuthorizationsForWindow(windowId);
    for (const [token, authorization] of startAuthorizations) {
      if (authorization.expiresAt <= now) {
        startAuthorizations.delete(token);
      }
    }

    const authorization: WebRemoteControlStartAuthorization = {
      token: randomUUID(),
      expiresAt: now + WEB_REMOTE_CONTROL_START_AUTHORIZATION_TTL_MS,
      windowId,
      workspaceKey: resolveWebRemoteControlWorkspaceKey(context),
      ...(context.remoteSessionId ? { remoteSessionId: context.remoteSessionId } : {}),
    };
    startAuthorizations.set(authorization.token, authorization);
    return authorization;
  }

  function consumeStartAuthorization(
    windowId: number,
    context: WebRemoteControlContext,
    authorization: WebRemoteControlStartAuthorization,
  ): void {
    const stored = startAuthorizations.get(authorization.token);
    startAuthorizations.delete(authorization.token);
    if (!stored || stored !== authorization) {
      throw new Error("Web remote control authorization is invalid or already used");
    }
    if (stored.expiresAt <= Date.now()) {
      throw new Error("Web remote control authorization expired");
    }
    if (
      stored.windowId !== windowId ||
      stored.workspaceKey !== resolveWebRemoteControlWorkspaceKey(context) ||
      stored.remoteSessionId !== context.remoteSessionId
    ) {
      throw new Error("Web remote control authorization target mismatch");
    }
  }

  function disposeRuntimeBridgeResources(runtime: WindowControlRuntime): void {
    clearMobileTaskView(runtime);
    const bridge = runtime.currentBridge;
    if (!bridge) {
      return;
    }

    bridge.disposeBridge?.();
    bridge.disposeBridge = undefined;
    bridge.relayProtocol?.dispose();
    bridge.relayProtocol = undefined;
    try {
      bridge.hostProtocol?.disconnect();
    } catch {
      // MessagePortProtocol 已经关闭时 dispose 失败不影响主流程。
    }
    if (bridge.attachmentId) {
      dependencies.releaseWorkspaceHostAttachment(bridge.attachmentId);
    }

    runtime.currentBridge = undefined;
  }

  function endTerminalOwner(runtime: WindowControlRuntime): void {
    const hadOwner = runtime.terminalOwner !== undefined;
    runtime.terminalOwner = undefined;
    // 旧客户端没有页面 owner，但确认断线仍必须结束 attachment，才能回收其独立终端 scope。
    // 同时撤销在途 open，让晚到的 attachment 只释放而不能重新挂回。
    // 结束 owner 先撤销在途导航，不能让晚到的 attachment 把已回收的 PTY 再挂回。
    cancelBridgeOpen(runtime);
    const bridge = runtime.currentBridge;
    if (bridge) {
      runtime.pendingBridgeInvalidation = {
        zcode_type: "bridge-degraded",
        bridgeSessionId: bridge.bridgeSessionId,
        bridgeGeneration: bridge.bridgeGeneration,
        recoveryId: bridge.recoveryId,
        reason: "terminal-owner-ended",
      };
    }
    disposeRuntimeBridgeResources(runtime);
    if (hadOwner) dependencies.setTerminalOwner(runtime.windowId, null);
    sendPendingBridgeInvalidation(runtime);
  }

  function ensureTerminalOwner(runtime: WindowControlRuntime, clientSessionId?: string): void {
    if (!clientSessionId) {
      // 旧页面没有认领协议，不能继承上一页面的 owner；回退到 attachment 回收。
      // bootstrap 是认领/读取，不是断线事件；旧客户端重复 bootstrap 不应销毁其活跃 bridge。
      if (runtime.terminalOwner) endTerminalOwner(runtime);
      return;
    }
    if (runtime.terminalOwner?.clientSessionId === clientSessionId) return;
    endTerminalOwner(runtime);
    const id = randomUUID();
    runtime.terminalOwner = { clientSessionId, id };
    dependencies.setTerminalOwner(runtime.windowId, id);
  }

  function isCurrentBridgeRuntime(
    runtime: WindowControlRuntime,
    bridge: WorkspaceBridgeRuntime,
  ): boolean {
    return runtimes.get(runtime.windowId) === runtime && runtime.currentBridge === bridge;
  }

  function degradeBridgeAfterRawFault(
    runtime: WindowControlRuntime,
    bridge: WorkspaceBridgeRuntime,
    reasonCode: string,
  ): void {
    if (!isCurrentBridgeRuntime(runtime, bridge) || bridge.degraded) return;
    bridge.degraded = true;
    dependencies.logger.warn("[web-remote-control] raw relay bridge degraded", {
      windowId: runtime.windowId,
      session: runtime.deviceSid,
      bridgeSessionId: bridge.bridgeSessionId,
      bridgeGeneration: bridge.bridgeGeneration,
      recoveryId: bridge.recoveryId,
      reasonCode,
    });
    runtime.pendingBridgeInvalidation = {
      zcode_type: "bridge-degraded",
      bridgeSessionId: bridge.bridgeSessionId,
      ...(bridge.bridgeGeneration === undefined
        ? {}
        : { bridgeGeneration: bridge.bridgeGeneration }),
      ...(bridge.recoveryId ? { recoveryId: bridge.recoveryId } : {}),
      // Bugfix：checksum/oversize/future ACK 等 fault 不能伪装成 frame gap；
      // app control 只传通用恢复原因，typed reasonCode 留在上面的安全日志。
      reason: "rpc-transport-fault",
    };
    // Bug 原因：degraded 后 raw 两端都已禁止继续转发，保留旧 attachment 只会泄漏
    // scoped subscription。物理 Host/Agent 不受影响，只释放手机短生命周期 attachment。
    disposeRuntimeBridgeResources(runtime);
    sendPendingBridgeInvalidation(runtime);
  }

  function clearPendingOutboundPayloadTimer(runtime: WindowControlRuntime): void {
    if (!runtime.pendingOutboundPayloadTimer) {
      return;
    }
    clearTimeout(runtime.pendingOutboundPayloadTimer);
    runtime.pendingOutboundPayloadTimer = undefined;
  }

  function clearMobileDisconnectGraceTimer(runtime: WindowControlRuntime): void {
    if (!runtime.mobileDisconnectGraceTimer) {
      return;
    }
    clearTimeout(runtime.mobileDisconnectGraceTimer);
    runtime.mobileDisconnectGraceTimer = undefined;
  }

  function buildRuntimeStatus(runtime: WindowControlRuntime): WebRemoteControlStatus {
    const target = getRuntimeStatusTarget(runtime);
    return {
      status: runtime.status,
      sessionId: runtime.deviceSid,
      windowControlSessionId: runtime.deviceSid,
      mobileConnected: runtime.mobileConnected,
      mobileViewState: runtime.mobileViewState,
      mobileTaskView: runtime.mobileTaskView ?? null,
      mobileDeviceInfo: runtime.mobileDeviceInfo,
      qrUrl: runtime.qrUrl,
      connection: runtime.connection?.settings,
      connectUrl: runtime.connectUrl,
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      remoteSessionId: target.remoteSessionId,
      initialTaskId: runtime.currentBridge?.initialTaskId ?? runtime.initialTaskId,
      error: runtime.error,
      failure: runtime.failure,
    };
  }

  function emitRuntimeStatus(runtime: WindowControlRuntime): void {
    dependencies.onStatusChanged?.(runtime.windowId, buildRuntimeStatus(runtime));
  }

  function clearMobileTaskView(runtime: WindowControlRuntime): void {
    if (!runtime.mobileTaskView) return;
    runtime.mobileTaskView = undefined;
    emitRuntimeStatus(runtime);
  }

  function requestMobileTaskView(runtime: WindowControlRuntime): void {
    if (runtime.transportState !== "paired" || !runtime.mobileTaskViewEpoch) return;
    sendAppPayload(runtime, {
      zcode_type: "mobile-task-view-request",
      epoch: runtime.mobileTaskViewEpoch,
    });
  }

  function emitIdleStatus(windowId: number): void {
    dependencies.onStatusChanged?.(windowId, { status: "idle" });
  }

  function scheduleMobileDisconnectGrace(runtime: WindowControlRuntime): void {
    if (runtime.mobileDisconnectGraceTimer) {
      return;
    }
    runtime.mobileDisconnectGraceTimer = setTimeout(() => {
      runtime.mobileDisconnectGraceTimer = undefined;
      if (runtimes.get(runtime.windowId) !== runtime || runtime.status === "error") {
        return;
      }
      endTerminalOwner(runtime);
      runtime.status = "running";
      runtime.mobileConnected = false;
      emitRuntimeStatus(runtime);
    }, MOBILE_DISCONNECT_STATUS_GRACE_MS);
  }

  function schedulePendingOutboundPayloadTimeout(runtime: WindowControlRuntime): void {
    if (runtime.pendingOutboundPayloadTimer || runtime.pendingOutboundPayloads.length === 0) {
      return;
    }
    runtime.pendingOutboundPayloadTimer = setTimeout(() => {
      runtime.pendingOutboundPayloadTimer = undefined;
      const droppedCount = runtime.pendingOutboundPayloads.splice(0).length;
      dependencies.logger.warn("[web-remote-control] dropped buffered outbound payloads", {
        windowId: runtime.windowId,
        session: runtime.deviceSid,
        droppedCount,
      });
    }, WEB_REMOTE_CONTROL_OUTBOUND_PAYLOAD_BUFFER_TIMEOUT_MS);
  }

  function sendPayloadToTransport(
    runtime: WindowControlRuntime,
    payload: WebRemoteControlAppPayload,
  ): WebRemoteControlPayloadSendResult {
    if (runtime.transport.sendPayloadResult) {
      return runtime.transport.sendPayloadResult(payload);
    }
    return runtime.transport.sendPayload(payload)
      ? { kind: "sent", bytes: 0 }
      : { kind: "unavailable" };
  }

  function sendPendingBridgeInvalidation(runtime: WindowControlRuntime): void {
    const payload = runtime.pendingBridgeInvalidation;
    if (!payload) return;
    const result = sendPayloadToTransport(runtime, payload);
    if (result.kind === "oversize") {
      dependencies.logger.error("[web-remote-control] bridge invalidation is oversized", {
        bridgeSessionId: payload.bridgeSessionId,
        bytes: result.bytes,
        maxBytes: result.maxBytes,
      });
    }
    // unavailable 时保持 latch；sent 后也保留，直到手机用新 bridge identity 发起 open。
  }

  function bufferOutboundPayload(
    runtime: WindowControlRuntime,
    payload: WebRemoteControlAppPayload,
  ): void {
    if (runtime.pendingOutboundPayloads.length >= 50) {
      const droppedCount = runtime.pendingOutboundPayloads.length + 1;
      runtime.pendingOutboundPayloads.length = 0;
      clearPendingOutboundPayloadTimer(runtime);
      dependencies.logger.warn("[web-remote-control] dropped overflowing outbound payloads", {
        windowId: runtime.windowId,
        session: runtime.deviceSid,
        droppedCount,
      });
      return;
    }
    runtime.pendingOutboundPayloads.push(payload);
    schedulePendingOutboundPayloadTimeout(runtime);
  }

  function flushPendingOutboundPayloads(runtime: WindowControlRuntime): void {
    while (runtime.pendingOutboundPayloads.length > 0) {
      const payload = runtime.pendingOutboundPayloads[0];
      if (!payload) {
        break;
      }
      const result = sendPayloadToTransport(runtime, payload);
      if (result.kind === "unavailable") {
        schedulePendingOutboundPayloadTimeout(runtime);
        return;
      }
      if (result.kind === "oversize") {
        // Bugfix：永久 oversize 不能伪装成临时不可发送后反复进入 50 项 buffer。
        dependencies.logger.warn("[web-remote-control] dropped oversize app payload", {
          zcodeType: payload.zcode_type,
          bytes: result.bytes,
          maxBytes: result.maxBytes,
        });
      }
      runtime.pendingOutboundPayloads.shift();
    }
    clearPendingOutboundPayloadTimer(runtime);
  }

  function sendAppPayload(
    runtime: WindowControlRuntime,
    payload: WebRemoteControlAppPayload,
  ): void {
    if (runtime.pendingOutboundPayloads.length > 0) {
      bufferOutboundPayload(runtime, payload);
      flushPendingOutboundPayloads(runtime);
      return;
    }
    const result = sendPayloadToTransport(runtime, payload);
    if (result.kind === "sent") {
      return;
    }
    if (result.kind === "oversize") {
      dependencies.logger.warn("[web-remote-control] rejected oversize app payload", {
        zcodeType: payload.zcode_type,
        bytes: result.bytes,
        maxBytes: result.maxBytes,
      });
      return;
    }
    // Bugfix: relay suspect 窗口内 sendPayload 会返回 false。
    // desktop 发出的响应/RPC 帧不能静默丢弃，先短暂缓冲，等 paired 恢复后再 flush。
    bufferOutboundPayload(runtime, payload);
  }

  function preserveWindowRuntimeFailure(
    windowId: number,
    runtime: WindowControlRuntime,
    reason: string,
    failure: WebRemoteControlFailure,
  ): void {
    if (runtime.status === "error" && runtime.failure?.reason === failure.reason) {
      return;
    }

    sendAppPayload(runtime, {
      zcode_type: "app-error",
      reason: failure.reason,
      error: failure.message ?? failure.reason,
    });
    endTerminalOwner(runtime);
    cancelBridgeOpen(runtime);
    disposeRuntimeBridgeResources(runtime);
    clearPendingOutboundPayloadTimer(runtime);
    clearMobileDisconnectGraceTimer(runtime);
    runtime.pendingOutboundPayloads.length = 0;
    runtime.transport.dispose();
    // fork 净化：上游改为官方通道 mobileLogPulls.cancelOwner（手机日志拉取），随 V2 通道一并剥离；保留 directGateway dispose。
    void runtime.connection?.dispose();
    runtime.status = "error";
    runtime.mobileConnected = false;
    runtime.error = failure.message;
    runtime.failure = failure;
    runtimes.set(windowId, runtime);
    dependencies.logger.warn(
      `[web-remote-control] runtime closed window=${windowId} session=${runtime.deviceSid} reason=${reason} failure=${failure.reason} message=${failure.message ?? "<none>"}`,
    );
    emitRuntimeStatus(runtime);
  }

  async function stopWindowRuntime(windowId: number, reason: string): Promise<void> {
    legacyDirectoriesByWindowId.delete(windowId);
    availableTasksByWindowId.delete(windowId);
    windowLifecycles.get(windowId)?.controller.abort();
    windowLifecycles.delete(windowId);
    const runtime = runtimes.get(windowId);
    if (!runtime) {
      return;
    }

    sendAppPayload(runtime, {
      zcode_type: "app-error",
      reason: "desktop-disconnected",
      error: "Desktop disconnected this Web remote control session.",
    });
    runtimes.delete(windowId);
    pushedWorkspaceListSignaturesByWindowId.delete(windowId);
    endTerminalOwner(runtime);
    cancelBridgeOpen(runtime);
    disposeRuntimeBridgeResources(runtime);
    clearPendingOutboundPayloadTimer(runtime);
    clearMobileDisconnectGraceTimer(runtime);
    runtime.pendingOutboundPayloads.length = 0;
    runtime.transport.dispose();
    // fork 净化：同上，保留我方 connection dispose。
    await runtime.connection?.dispose();
    dependencies.disposeWorkspaceHostAttachmentsForWindow(windowId, reason);

    dependencies.logger.info(
      `[web-remote-control] stopped window=${windowId} session=${runtime.deviceSid} reason=${reason}`,
    );
    emitIdleStatus(windowId);
  }

  function getRuntimeWorkspaceTarget(
    runtime: WindowControlRuntime,
  ): WebRemoteControlWorkspaceTarget {
    const bridge = runtime.currentBridge;
    if (bridge) {
      return {
        workspacePath: bridge.workspacePath,
        workspaceIdentity: bridge.workspaceIdentity,
        remoteSessionId: bridge.remoteSessionId,
        label: getPathLabel(bridge.workspacePath),
        kind: bridge.kind,
      };
    }

    return {
      workspacePath: runtime.workspacePath,
      workspaceIdentity: runtime.workspaceIdentity,
      remoteSessionId: runtime.remoteSessionId,
      label: getPathLabel(runtime.workspacePath),
      kind: runtime.remoteSessionId || runtime.workspaceIdentity ? "remote" : "local",
    };
  }

  function getRuntimeStatusTarget(runtime: WindowControlRuntime): WebRemoteControlWorkspaceTarget {
    // Bugfix: 手机端可以在同一个远控会话里切到窗口内的其他 workspace。
    // 之前 getStatus() 复用了当前 bridge 目标，导致桌面弹层按启动 workspace 轮询时误判为“不是同一会话”，
    // 再次打开弹层会重启远控并把手机端踢成离线。状态接口保持窗口远控会话的原始目标，
    // 手机当前 workspace 仍通过 mobileViewState / workspace list 表达。
    return {
      workspacePath: runtime.workspacePath,
      workspaceIdentity: runtime.workspaceIdentity,
      remoteSessionId: runtime.remoteSessionId,
      label: getPathLabel(runtime.workspacePath),
      kind: runtime.remoteSessionId || runtime.workspaceIdentity ? "remote" : "local",
    };
  }

  function getAvailableWorkspaces(
    runtime: WindowControlRuntime,
  ): WebRemoteControlWorkspaceTarget[] {
    const workspaceByKey = new Map<string, WebRemoteControlWorkspaceTarget>();

    for (const workspace of availableWorkspacesByWindowId.get(runtime.windowId) ?? []) {
      // Bugfix: 手机端 workspace 列表需要和桌面端一致展示已断开的 SSH 项目。
      // 这里仅保留列表项；真正创建 bridge 时仍会校验 remoteSessionId，避免未连接项目被直接打开聊天。
      workspaceByKey.set(resolveWebRemoteControlWorkspaceKey(workspace), workspace);
    }

    if (runtime.connection?.settings.mode === "official") {
      for (const workspace of legacyDirectoriesByWindowId.get(runtime.windowId)?.workspaces ?? []) {
        // 仅补全本地目录；远端仍以当前窗口的 identity/session 快照为准。
        if (workspace.kind === "local")
          workspaceByKey.set(resolveWebRemoteControlWorkspaceKey(workspace), workspace);
      }
    }

    const currentTarget = getRuntimeWorkspaceTarget(runtime);
    if (isBridgeableRemoteTarget(currentTarget)) {
      const currentKey = resolveWebRemoteControlWorkspaceKey(currentTarget);
      if (!workspaceByKey.has(currentKey)) {
        workspaceByKey.set(currentKey, currentTarget);
      }
    }

    return [...workspaceByKey.values()];
  }

  function getAvailableTasks(runtime: WindowControlRuntime): WebRemoteControlTaskTarget[] {
    const availableWorkspaceKeys = new Set(
      getAvailableWorkspaces(runtime).map((workspace) =>
        resolveWebRemoteControlWorkspaceKey(workspace),
      ),
    );

    return (availableTasksByWindowId.get(runtime.windowId) ?? [])
      .filter(
        (task) =>
          isBridgeableRemoteTask(task) &&
          availableWorkspaceKeys.has(resolveWebRemoteControlWorkspaceKey(task)),
      )
      .sort((left, right) => {
        if (right.updatedAt !== left.updatedAt) {
          return right.updatedAt - left.updatedAt;
        }
        if (right.createdAt !== left.createdAt) {
          return right.createdAt - left.createdAt;
        }
        return right.taskId.localeCompare(left.taskId);
      });
  }

  function getRuntimeInitialViewState(
    runtime: WindowControlRuntime,
  ): WebRemoteControlMobileViewState | undefined {
    const activeTarget = getRuntimeWorkspaceTarget(runtime);
    if (!runtime.initialTaskId || !isBridgeableRemoteTarget(activeTarget)) {
      return undefined;
    }

    return {
      activeWorkspaceKey: resolveWebRemoteControlWorkspaceKey(activeTarget),
      activeTaskId: runtime.initialTaskId,
      updatedAt: Date.now(),
    };
  }

  function buildBootstrapResult(
    runtime: WindowControlRuntime,
  ): WebRemoteControlWindowBootstrapResult {
    return {
      windowControlSessionId: runtime.deviceSid,
      // 官方旧页会按此字段重定向；省略可选字段以保留固定网页，设备握手仍报告真实版本。
      ...(runtime.connection?.settings.mode === "official"
        ? {}
        : { desktopAppVersion: dependencies.appVersion }),
      workspaces: getAvailableWorkspaces(runtime),
      tasks: getAvailableTasks(runtime),
      initialViewState: getRuntimeInitialViewState(runtime),
      mobileViewState: runtime.mobileViewState,
      mobileTaskViewEpoch: runtime.mobileTaskViewEpoch,
    };
  }

  function buildWorkspaceListResult(
    runtime: WindowControlRuntime,
  ): WebRemoteControlWorkspaceListResult {
    const activeTarget = getRuntimeWorkspaceTarget(runtime);
    const initialViewState = getRuntimeInitialViewState(runtime);
    return {
      workspaces: getAvailableWorkspaces(runtime),
      tasks: getAvailableTasks(runtime),
      activeWorkspaceKey:
        runtime.mobileViewState?.activeWorkspaceKey ??
        initialViewState?.activeWorkspaceKey ??
        resolveWebRemoteControlWorkspaceKey(activeTarget),
      activeTaskId:
        runtime.mobileViewState?.activeTaskId ??
        runtime.currentBridge?.initialTaskId ??
        initialViewState?.activeTaskId,
    };
  }

  function buildWorkspaceListPushSignature(result: WebRemoteControlWorkspaceListResult): string {
    const workspaceSignatureEntries = result.workspaces
      .map((workspace) => {
        const workspaceKey = resolveWebRemoteControlWorkspaceKey(workspace);
        return JSON.stringify([
          workspaceKey,
          workspace.kind,
          // OW-P018：项目改名不改变身份；显示字段必须参与完整目录去重。
          workspace.label,
          workspace.workspacePath,
          workspace.workspacePurpose ?? "project",
          workspace.connectionState ?? "connected",
          workspace.remoteSessionId ?? "",
          // Bugfix：连接状态不只包含枚举值；同一 disconnected 状态下错误原因也会变化，
          // 手机 workspace card 直接展示 lastConnectionError，必须触发新快照。
          workspace.lastConnectionError ?? "",
        ]);
      })
      .sort();
    const taskSignatureEntries = (result.tasks ?? [])
      .map((task) => {
        const workspaceKey = resolveWebRemoteControlWorkspaceKey(task);
        return JSON.stringify([
          workspaceKey,
          task.taskId,
          // Bugfix：自动标题和用户重命名不会改变 task identity/membership；标题本身必须参与
          // 首页快照去重，否则手机会一直保留旧文案。
          task.title,
          task.workspaceLabel,
          // OW-P009：活动时间决定列表时间与排序；运行状态不变也要发布，创建时间参与同值排序。
          task.updatedAt,
          task.createdAt,
          // Bugfix：远程 workspace 重连后 workspaceKey 可以保持不变，但 task target 绑定的
          // remoteSessionId 会轮换；手机必须采用新连接身份，不能把它当成重复任务。
          task.remoteSessionId ?? "",
          // Bugfix：手机首页状态来自 renderer 已计算的 displayStatus；旧签名只比较 membership，
          // running/completed/error 迁移会被误判为重复快照。缺失值按手机 fallback 归一为 idle。
          task.displayStatus ?? "idle",
          // 后台工作起止决定手机列表运行层归属（排序），displayStatus 不变也要出新快照。
          Boolean(task.hasBackgroundWork),
          // 工作流运行行的数据：phase 灯翻转、run 结束、子代理数变化都要让手机重画那一行。
          task.workflowActivity ?? null,
          // Bugfix：unreadAt 是手机蓝点的事实字段；打开任务清除未读时 task membership 不变，
          // 必须让时间戳到缺失值的迁移触发新快照。
          typeof task.unreadAt === "number" ? task.unreadAt : "",
          Boolean(task.pinned),
          Boolean(task.archived),
        ]);
      })
      .sort();

    // Bugfix：title / connection error 是任意用户可见字符串，不能再用控制字符拼接 tuple；
    // 否则字段值本身包含分隔符时不同快照可能得到相同签名。JSON tuple 保持字段边界且仍忽略数组顺序。
    return JSON.stringify([workspaceSignatureEntries, taskSignatureEntries]);
  }

  function pushWorkspaceListUpdated(runtime: WindowControlRuntime, force = false): void {
    const result = buildWorkspaceListResult(runtime);
    const signature = buildWorkspaceListPushSignature(result);
    // force：手机新建项目后列表可能未变（项目不一定在 tab 里），仍需一次推送驱动手机重读项目树。
    if (!force && pushedWorkspaceListSignaturesByWindowId.get(runtime.windowId) === signature) {
      return;
    }

    pushedWorkspaceListSignaturesByWindowId.set(runtime.windowId, signature);
    sendAppPayload(runtime, {
      zcode_type: "workspace-list-updated",
      result,
    });
  }

  async function respondToPlatformRequest(
    runtime: WindowControlRuntime,
    request: WebRemoteControlPlatformRequestPayload,
  ): Promise<void> {
    let response: WebRemoteControlPlatformResponsePayload;

    try {
      const result = await dependencies.platformHandlers[request.method](request.args as never);
      response = {
        zcode_type: "platform-response",
        requestId: request.requestId,
        method: request.method,
        success: true,
        result,
      } as WebRemoteControlPlatformResponsePayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.logger.warn(
        `[web-remote-control] platform request failed window=${runtime.windowId} session=${runtime.deviceSid} method=${request.method} error=${message}`,
      );
      response = {
        zcode_type: "platform-response",
        requestId: request.requestId,
        method: request.method,
        success: false,
        error: message,
      };
    }

    sendAppPayload(runtime, response);
  }

  function cancelBridgeOpen(runtime: WindowControlRuntime): void {
    const pending = runtime.bridgeOpen;
    runtime.bridgeOpen = undefined;
    if (pending?.preparingProject)
      dependencies.cancelProjectPreparation?.(runtime.windowId, pending.hostRequestId);
  }

  function createWorkspaceBridge(
    runtime: WindowControlRuntime,
    request: WebRemoteControlWorkspaceBridgeOpenPayload,
  ): Promise<WebRemoteControlExternalWorkspaceBridge> {
    // 只有 bootstrap 建立页面 owner；旧页面迟到的 open 不得重新认领已结束的会话。
    if (
      request.terminalClientSessionId &&
      runtime.terminalOwner?.clientSessionId !== request.terminalClientSessionId
    ) {
      return Promise.reject(new Error("Terminal page session has ended; bootstrap is required."));
    }
    const intentKey = JSON.stringify([
      request.terminalClientSessionId,
      request.workspaceKey,
      request.taskId ?? null,
      request.project?.projectId,
      request.project?.hostId,
      request.project?.draftId,
      request.taskHostId,
      request.fileTreeTaskId,
    ]);
    const previous = runtime.bridgeOpen;
    if (
      previous?.bridgeSessionId === request.bridgeSessionId &&
      previous.bridgeGeneration === request.bridgeGeneration
    ) {
      if (previous.intentKey !== intentKey)
        return Promise.reject(new Error("Workspace bridge identity cannot change intent."));
      if (
        runtime.currentBridge?.degraded ||
        (runtime.pendingBridgeInvalidation?.bridgeSessionId === request.bridgeSessionId &&
          runtime.pendingBridgeInvalidation.bridgeGeneration === request.bridgeGeneration)
      )
        return Promise.reject(new Error("Degraded workspace bridge requires a new identity."));
      return previous.promise;
    }
    cancelBridgeOpen(runtime);
    // 同一 transport identity 的重试复用整次 admission；新导航立即使旧异步结果失效。
    const pending: NonNullable<WindowControlRuntime["bridgeOpen"]> = {
      bridgeSessionId: request.bridgeSessionId,
      bridgeGeneration: request.bridgeGeneration,
      intentKey,
      hostRequestId: randomUUID(),
      preparingProject: Boolean(request.project || request.taskHostId),
      promise: undefined as never,
    };
    runtime.bridgeOpen = pending;
    pending.promise = buildWorkspaceBridge(runtime, request, pending);
    return pending.promise;
  }

  async function buildWorkspaceBridge(
    runtime: WindowControlRuntime,
    request: WebRemoteControlWorkspaceBridgeOpenPayload,
    pending: NonNullable<WindowControlRuntime["bridgeOpen"]>,
  ): Promise<WebRemoteControlExternalWorkspaceBridge> {
    let target: WebRemoteControlWorkspaceTarget | undefined;
    let intent: HostProjectWorkspaceNavigationInput | undefined =
      request.project ??
      ((request.fileTreeTaskId || request.taskId) && request.taskHostId
        ? {
            hostId: request.taskHostId,
            task: {
              taskId: (request.fileTreeTaskId ?? request.taskId)!,
              workspaceKey: request.workspaceKey,
            },
          }
        : undefined);
    if (!intent && runtime.connection?.settings.mode === "official") {
      const directory = legacyDirectoriesByWindowId.get(runtime.windowId);
      const workspace = directory?.workspaces.find(
        (item) =>
          item.kind === "local" &&
          resolveWebRemoteControlWorkspaceKey(item) === request.workspaceKey,
      );
      if (workspace) {
        const taskId = request.fileTreeTaskId ?? request.taskId;
        if (taskId) {
          // 历史沿真实 cwd 查询 Host；不得为了打开任务而 prepare 新草稿或复活目录。
          intent = { hostId: "local", task: { taskId, workspaceKey: request.workspaceKey } };
        } else {
          const projectIds = directory?.projects.find(
            (p) => p.workspaceKey === request.workspaceKey,
          )?.projectIds;
          if (projectIds && projectIds.length > 1)
            throw new Error("此目录属于多个项目，请在桌面选择项目后新建任务。");
          if (projectIds?.length === 1) intent = { hostId: "local", projectId: projectIds[0]! };
        }
      }
    }
    if (intent) {
      if ((request.project && request.taskId) || !dependencies.prepareProjectWorkspace)
        throw new Error("Project navigation is unavailable.");
      pending.preparingProject = true;
      try {
        const prepared = await dependencies.prepareProjectWorkspace(
          runtime.windowId,
          intent,
          pending.hostRequestId,
        );
        target = {
          workspacePath: prepared.workspacePath,
          workspaceIdentity: prepared.workspaceIdentity,
          remoteSessionId: prepared.remote?.remoteSessionId,
          kind: prepared.remote ? "remote" : "local",
          label: prepared.workspacePath,
          ...(prepared.remote ? { connectionState: "connected" as const } : {}),
        };
      } catch (error) {
        // 官方旧页没有原生项目错误翻译；在兼容入口给出可执行的目录恢复提示。
        if (
          runtime.connection?.settings.mode === "official" &&
          !request.project &&
          error instanceof Error &&
          ["project.primaryRootMissing", "project.primaryRootUnavailable"].includes(error.message)
        )
          throw new Error("工作区目录不可用。请恢复目录或在桌面选择有效目录后新建任务。");
        throw error;
      } finally {
        pending.preparingProject = false;
      }
    } else {
      target = getAvailableWorkspaces(runtime).find(
        (workspace) => resolveWebRemoteControlWorkspaceKey(workspace) === request.workspaceKey,
      );
    }
    if (runtimes.get(runtime.windowId) !== runtime || runtime.bridgeOpen !== pending)
      throw new Error("Workspace bridge request was superseded.");
    if (!target) {
      throw new Error("目标工作区不在当前桌面窗口中，无法创建 Web 远程控制 bridge。");
    }
    if (!isBridgeableRemoteTarget(target)) {
      throw new Error("目标远程工作区尚未连接，无法创建 bridge，请先重连。");
    }
    const targetWorkspaceKey = resolveWebRemoteControlWorkspaceKey(target);

    const invalidation = runtime.pendingBridgeInvalidation;
    if (
      invalidation?.bridgeSessionId === request.bridgeSessionId &&
      invalidation.bridgeGeneration === request.bridgeGeneration
    ) {
      throw new Error("Degraded workspace bridge must be rebuilt with a new transport identity.");
    }
    // 收到新 identity 的 open 已证明手机消费了 invalidation；后续失败由显式 bridge-error
    // 和 Web 侧有界 retry 收口，不再重复旧 generation 的 degraded 通知。
    runtime.pendingBridgeInvalidation = undefined;

    disposeRuntimeBridgeResources(runtime);
    runtime.status = "connecting";
    runtime.error = undefined;
    runtime.failure = undefined;
    emitRuntimeStatus(runtime);

    const bridgeRuntime: WorkspaceBridgeRuntime = {
      terminalOwnerId: request.terminalClientSessionId ? runtime.terminalOwner?.id : undefined,
      bridgeSessionId: request.bridgeSessionId,
      bridgeGeneration: request.bridgeGeneration,
      recoveryId: request.recoveryId,
      hostEntryId: "",
      attachmentId: "",
      kind: target.kind,
      workspaceKey: targetWorkspaceKey,
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      remoteSessionId: target.remoteSessionId,
      initialTaskId: request.taskId,
      readyAnnounced: false,
      degraded: false,
    };
    runtime.currentBridge = bridgeRuntime;

    dependencies.logger.info(
      `[web-remote-control] attaching workspace bridge window=${runtime.windowId} session=${runtime.deviceSid} bridgeSession=${request.bridgeSessionId} workspace=${target.workspacePath}`,
    );

    let acquired: WebRemoteControlHostAttachmentHandle | undefined;
    try {
      acquired = await dependencies.attachWorkspaceHost(runtime.windowId, {
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
        remoteSessionId: target.remoteSessionId,
        initialTaskId: request.fileTreeTaskId ?? request.taskId,
        kind: target.kind,
        ...(bridgeRuntime.terminalOwnerId
          ? { terminalOwnerId: bridgeRuntime.terminalOwnerId }
          : {}),
      });
      if (!isCurrentBridgeRuntime(runtime, bridgeRuntime) || runtime.bridgeOpen !== pending) {
        dependencies.releaseWorkspaceHostAttachment(acquired.attachmentId);
        acquired = undefined;
        throw new Error("Workspace bridge request was superseded.");
      }
      const hostProtocol = new MessagePortProtocol(wrapElectronPort(acquired.port));
      const relayProtocol = createAcknowledgedWebRemoteControlRelayProtocol({
        bridgeSessionId: bridgeRuntime.bridgeSessionId,
        bridgeGeneration: bridgeRuntime.bridgeGeneration,
        recoveryId: bridgeRuntime.recoveryId,
        measureFrameBytes: (frame) =>
          runtime.transport.measurePayloadBytes?.(frame) ??
          measureWebRemoteControlRpcRelayEnvelopeBytes(frame),
        sendFrame: (payload) => {
          if (!bridgeRuntime.readyAnnounced || bridgeRuntime.degraded) return false;
          const result = sendPayloadToTransport(runtime, payload);
          if (result.kind === "oversize") {
            throw new Error("remote.rpcFrame.envelopeTooLarge");
          }
          return result.kind === "sent";
        },
      });

      // Bugfix：raw adapter 是唯一 replay owner；main 不再把 rpc-frame 放进普通 50 项 buffer。
      const disposeHostToRelay = hostProtocol.onMessage((buffer) => {
        relayProtocol.protocol.send(buffer);
      });
      const disposeRelayToHost = relayProtocol.protocol.onMessage((buffer) => {
        hostProtocol.send(buffer);
      });
      const disposeDegraded = relayProtocol.onDegraded((fault) => {
        degradeBridgeAfterRawFault(runtime, bridgeRuntime, fault.reasonCode);
      });
      const disposeSaturated = relayProtocol.onSaturated(() => {
        if (!isCurrentBridgeRuntime(runtime, bridgeRuntime) || bridgeRuntime.degraded) return;
        hostProtocol.sendFlowState("saturated");
      });
      const disposeDrained = relayProtocol.onDrained(() => {
        if (!isCurrentBridgeRuntime(runtime, bridgeRuntime) || bridgeRuntime.degraded) return;
        hostProtocol.sendFlowState("drained");
      });

      bridgeRuntime.hostEntryId = acquired.entryId;
      bridgeRuntime.attachmentId = acquired.attachmentId;
      bridgeRuntime.hostProtocol = hostProtocol;
      bridgeRuntime.relayProtocol = relayProtocol;
      bridgeRuntime.disposeBridge = () => {
        disposeHostToRelay.dispose();
        disposeRelayToHost.dispose();
        disposeDegraded.dispose();
        disposeSaturated.dispose();
        disposeDrained.dispose();
      };
      runtime.status = "active";
      runtime.error = undefined;
      runtime.failure = undefined;
      emitRuntimeStatus(runtime);

      dependencies.logger.info(
        `[web-remote-control] workspace bridge active window=${runtime.windowId} session=${runtime.deviceSid} bridgeSession=${request.bridgeSessionId}`,
      );

      return toExternalBridge(bridgeRuntime);
    } catch (error) {
      if (acquired) {
        dependencies.releaseWorkspaceHostAttachment(acquired.attachmentId);
      }
      if (isCurrentBridgeRuntime(runtime, bridgeRuntime)) {
        disposeRuntimeBridgeResources(runtime);
        runtime.status = runtime.mobileConnected ? "active" : "running";
        emitRuntimeStatus(runtime);
      }
      throw error;
    }
  }

  async function respondToWorkspaceBridgeOpen(
    runtime: WindowControlRuntime,
    request: WebRemoteControlWorkspaceBridgeOpenPayload,
  ): Promise<void> {
    try {
      const bridge = await createWorkspaceBridge(runtime, request);
      sendAppPayload(runtime, {
        zcode_type: "workspace-bridge-ready",
        requestId: request.requestId,
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration !== undefined
          ? { bridgeGeneration: request.bridgeGeneration }
          : {}),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        bridge,
      });
      const currentBridge = runtime.currentBridge;
      if (
        currentBridge?.bridgeSessionId === request.bridgeSessionId &&
        currentBridge.bridgeGeneration === request.bridgeGeneration
      ) {
        // bridge-ready 必须先进入 ordinary app transport，才允许 queued raw frames 开闸。
        currentBridge.readyAnnounced = true;
        currentBridge.relayProtocol?.flushPendingFrames();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.logger.warn(
        `[web-remote-control] workspace bridge failed window=${runtime.windowId} session=${runtime.deviceSid} workspaceKey=${request.workspaceKey} error=${message}`,
      );
      sendAppPayload(runtime, {
        zcode_type: "workspace-bridge-error",
        requestId: request.requestId,
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration !== undefined
          ? { bridgeGeneration: request.bridgeGeneration }
          : {}),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        reason: mapWorkspaceBridgeFailureReason(error),
        error: message,
      });
    }
  }

  async function respondToWorkspaceReconnectRequest(
    runtime: WindowControlRuntime,
    request: Extract<WebRemoteControlAppPayload, { zcode_type: "workspace-reconnect-request" }>,
  ): Promise<void> {
    try {
      await dependencies.reconnectWorkspace(runtime.windowId, request.workspaceKey);
      sendAppPayload(runtime, {
        zcode_type: "workspace-reconnect-response",
        requestId: request.requestId,
        workspaceKey: request.workspaceKey,
        success: true,
      });
    } catch (error) {
      sendAppPayload(runtime, {
        zcode_type: "workspace-reconnect-response",
        requestId: request.requestId,
        workspaceKey: request.workspaceKey,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function respondToActionRequest(
    runtime: WindowControlRuntime,
    request: WebRemoteControlActionRequestPayload,
  ): Promise<void> {
    const response = await respondToWebRemoteControlActionRequest(
      runtime.windowId,
      request,
      dependencies.runRendererAction,
    );
    if (runtimes.get(runtime.windowId) !== runtime) return;
    sendAppPayload(runtime, response);
    if (response.zcode_type === "workspace-create-response" && response.success) {
      pushWorkspaceListUpdated(runtime, true);
    }
  }

  /** 不认识的请求型 payload 回 app-error，让新手机连旧桌面时能立即降级而不是等超时。 */
  function respondToUnrecognizedPayload(runtime: WindowControlRuntime, value: unknown): void {
    const request = resolveUnrecognizedWebRemoteControlRequest(value);
    if (!request) return;
    sendAppPayload(runtime, {
      zcode_type: "app-error",
      requestId: request.requestId,
      reason: "unsupported-action",
      error: `Desktop does not recognize app payload type: ${request.zcodeType}`,
    });
  }

  function applyMobileViewStateUpdate(
    runtime: WindowControlRuntime,
    viewState: WebRemoteControlMobileViewState,
    deviceInfo?: WebRemoteControlMobileDeviceInfo,
  ): void {
    runtime.mobileViewState = viewState;
    if (deviceInfo) {
      runtime.mobileDeviceInfo = deviceInfo;
    }
  }

  function applyMobileTaskViewUpdate(
    runtime: WindowControlRuntime,
    payload: WebRemoteControlMobileTaskViewUpdatePayload,
  ): void {
    const bridge = runtime.currentBridge;
    const view = payload.view;
    // 导航缓存、断线宽限和旧 bridge 回包都不能证明当前查看；只接收本代配对的完整地址。
    if (
      runtime.transportState !== "paired" ||
      payload.epoch !== runtime.mobileTaskViewEpoch ||
      payload.seq <= (runtime.mobileTaskViewSeq ?? -1) ||
      !bridge?.readyAnnounced ||
      bridge.degraded ||
      payload.bridgeSessionId !== bridge.bridgeSessionId ||
      payload.bridgeGeneration !== bridge.bridgeGeneration ||
      (view &&
        (view.workspacePath !== bridge.workspacePath ||
          resolveWebRemoteControlWorkspaceKey(view) !== bridge.workspaceKey))
    )
      return;
    runtime.mobileTaskViewSeq = payload.seq;
    // legacy 身份不能反查 Source；读与 CAS 必须携带所属 bridge 的可信 session，不能接受 Web 自报。
    const trustedView = view
      ? {
          ...view,
          ...(bridge.kind === "remote" ? { remoteSessionId: bridge.remoteSessionId } : {}),
        }
      : undefined;
    const previous = runtime.mobileTaskView;
    if (
      previous?.taskId === trustedView?.taskId &&
      previous?.workspacePath === trustedView?.workspacePath &&
      previous?.workspaceIdentity === trustedView?.workspaceIdentity &&
      previous?.remoteSessionId === trustedView?.remoteSessionId
    )
      return;
    runtime.mobileTaskView = trustedView;
    emitRuntimeStatus(runtime);
  }

  function routeRpcTransportPayload(
    runtime: WindowControlRuntime,
    frame: WebRemoteControlRpcTransportPayload,
  ): void {
    routeRawTransportCandidate(runtime, frame);
  }

  function routeRawTransportCandidate(runtime: WindowControlRuntime, payload: unknown): boolean {
    const bridge = runtime.currentBridge;
    if (!bridge || bridge.degraded) return false;
    return bridge.relayProtocol?.acceptPayload(payload) ?? false;
  }

  function logMobileDiagnostic(
    runtime: WindowControlRuntime,
    payload: Extract<WebRemoteControlAppPayload, { zcode_type: "mobile-diagnostic" }>,
  ): void {
    dependencies.logger.info("[web-remote-control] mobile diagnostic", {
      window: runtime.windowId,
      session: runtime.deviceSid,
      event: payload.event,
      state: payload.state,
      previousState: payload.previousState,
      pairStatus: payload.pairStatus,
      closeCode: payload.closeCode,
      closeReason: payload.closeReason,
      wasClean: payload.wasClean,
      wasPaired: payload.wasPaired,
      failureReason: payload.failureReason,
      failureMessage: payload.failureMessage,
      visibilityState: payload.visibilityState,
      online: payload.online,
      hiddenDurationMs: payload.hiddenDurationMs,
      timestamp: payload.timestamp,
    });
  }

  function routePayload(runtime: WindowControlRuntime, payload: WebRemoteControlAppPayload): void {
    switch (payload.zcode_type) {
      case "bootstrap-request":
        ensureTerminalOwner(runtime, payload.terminalClientSessionId);
        sendAppPayload(runtime, {
          zcode_type: "bootstrap-response",
          requestId: payload.requestId,
          success: true,
          result: buildBootstrapResult(runtime),
        });
        break;
      case "workspace-list-request":
        sendAppPayload(runtime, {
          zcode_type: "workspace-list-response",
          requestId: payload.requestId,
          success: true,
          result: buildWorkspaceListResult(runtime),
        });
        break;
      case "platform-request":
        void respondToPlatformRequest(runtime, payload);
        break;
      case "mobile-view-state-update":
        applyMobileViewStateUpdate(runtime, payload.viewState, payload.deviceInfo);
        break;
      case "mobile-task-view-update":
        applyMobileTaskViewUpdate(runtime, payload);
        break;
      case "workspace-bridge-open":
        void respondToWorkspaceBridgeOpen(runtime, payload);
        break;
      case "workspace-reconnect-request":
        void respondToWorkspaceReconnectRequest(runtime, payload);
        break;
      case "rpc-frame":
      case "rpc-frame-ack":
        routeRpcTransportPayload(runtime, payload);
        break;
      case "mobile-diagnostic":
        logMobileDiagnostic(runtime, payload);
        break;
      case "task-pin-request":
      case "task-archive-request":
      case "workspace-create-request":
        void respondToActionRequest(runtime, payload);
        break;
      case "mobile-log":
        appendMobileLog(runtime, payload);
        break;
      case "mobile-log-pull-response":
        if (!mobileLogPulls.handleResponse(payload)) {
          dependencies.logger.info("[web-remote-control] dropped stale mobile log pull response", {
            requestId: payload.requestId,
          });
        }
        break;
      case "app-error":
        // 手机对桌面请求的报错：目前只有日志拉取会按 requestId 认领（unsupported-action 降级）。
        mobileLogPulls.handleAppError(payload);
        break;
      default:
        // 已能解析但本端不处理的请求型 payload 同样回 unsupported-action。
        respondToUnrecognizedPayload(runtime, payload);
        break;
    }
  }

  function resolveMobileLogDeviceLabel(runtime: WindowControlRuntime): string {
    const info = runtime.mobileDeviceInfo;
    return info ? [info.name, info.platform].filter(Boolean).join("-") : "";
  }

  function appendMobileLog(
    runtime: WindowControlRuntime,
    payload: WebRemoteControlMobileLogPayload,
  ): void {
    if (!dependencies.mobileLogSink) return;
    const info = runtime.mobileDeviceInfo;
    dependencies.mobileLogSink.append(
      {
        deviceKey: payload.device?.id ?? (resolveMobileLogDeviceLabel(runtime) || "unknown-device"),
        sessionKey: payload.sessionId ?? runtime.deviceSid,
        header: {
          device:
            payload.device ??
            (info
              ? { name: info.name, platform: info.platform, appVersion: info.version }
              : undefined),
          mobileSessionId: payload.sessionId,
          desktopSession: runtime.deviceSid,
          windowId: runtime.windowId,
        },
      },
      payload.events,
    );
  }

  function findMobileLogPullRuntime(
    windowId: number | undefined,
  ): WindowControlRuntime | undefined {
    const isPaired = (runtime: WindowControlRuntime | undefined) =>
      runtime?.transportState === "paired" && runtime.mobileConnected;
    const preferred = windowId === undefined ? undefined : runtimes.get(windowId);
    if (isPaired(preferred)) return preferred;
    return [...runtimes.values()].find((runtime) => isPaired(runtime));
  }

  function mapTransportState(
    runtime: WindowControlRuntime,
    state: WebRemoteControlDeviceTransportState,
  ): void {
    const previousTransportState = runtime.transportState;
    runtime.transportState = state;
    // 瞬时查看不能沿用连接弹窗的断线宽限；恢复必须由新 epoch 下的可见页面重新声明。
    if (state !== "paired") {
      runtime.mobileTaskViewEpoch = undefined;
      runtime.mobileTaskViewSeq = undefined;
      clearMobileTaskView(runtime);
    } else if (previousTransportState !== "paired") {
      runtime.mobileTaskViewEpoch = randomUUID();
      runtime.mobileTaskViewSeq = -1;
    }
    if (state !== "paired") {
      runtime.hasObservedSendReadyForPairing = false;
    }
    if (state === "waiting_terminal" || state === "paired") {
      runtime.error = undefined;
      runtime.failure = undefined;
    }
    if (state === "connecting" || state === "authenticating") {
      if (runtime.mobileConnected) {
        // Bugfix: 已配对会话的 relay 短抖会先经历 connecting/authenticating。
        // 旧逻辑把 dialog 立刻切成“启动中”，用户会误以为远控重新启动；这里在宽限期内保持 active。
        runtime.status = "active";
        scheduleMobileDisconnectGrace(runtime);
        emitRuntimeStatus(runtime);
        return;
      }
      runtime.status = "starting";
      emitRuntimeStatus(runtime);
      return;
    }
    if (state === "waiting_terminal") {
      if (runtime.mobileConnected) {
        // Bugfix: 已配对会话恢复时 relay 可能短暂回 waiting。
        // 旧逻辑会把 dialog 从 active 拉回“等待手机匹配”；这里先防抖，超时仍未 paired 再降级。
        runtime.status = "active";
        scheduleMobileDisconnectGrace(runtime);
        emitRuntimeStatus(runtime);
        return;
      }
      runtime.status = "running";
      runtime.mobileConnected = false;
      emitRuntimeStatus(runtime);
      return;
    }
    if (state === "paired") {
      runtime.hasEverPaired = true;
      clearMobileDisconnectGraceTimer(runtime);
      runtime.status = "active";
      runtime.mobileConnected = true;
      emitRuntimeStatus(runtime);
      // Bugfix: 普通断线重连重新 paired 时 transport 不一定触发 onSendReady。
      // 这里在状态恢复为可发送后主动 flush，避免重连窗口内缓冲的响应/RPC 帧超时丢弃。
      flushPendingOutboundPayloads(runtime);
      sendPendingBridgeInvalidation(runtime);
      if (previousTransportState !== "paired") requestMobileTaskView(runtime);
      return;
    }
    if (state === "kicked") {
      preserveWindowRuntimeFailure(
        runtime.windowId,
        runtime,
        "external-relay-kicked",
        createFailure("session-conflict", "Web remote control connection was kicked by relay."),
      );
      return;
    }
    if (state === "error") {
      runtime.status = "error";
      emitRuntimeStatus(runtime);
    }
  }

  function createQrUrl(
    auth: { deviceSid: string; passHash: string },
    mobileRemoteControlUrl: string,
    theme?: WebRemoteControlContext["theme"],
    connection?: WebRemoteControlPreparedConnection,
  ): string {
    return buildWebRemoteControlExternalQrUrl({
      baseUrl: mobileRemoteControlUrl,
      relayWsUrl: connection?.settings.mode === "self-hosted" ? connection.relayWsUrl : undefined,
      deviceSid: auth.deviceSid,
      passHash: auth.passHash,
      timestamp: Date.now(),
      deviceMid: dependencies.deviceMid,
      deviceName: dependencies.deviceName,
      // 官方缺省入口仍提供旧网页；显式选择 V1 页面，避免与桌面版本绑定到 OAuth 页面。
      appVersion:
        connection?.settings.mode === "official"
          ? OFFICIAL_WEB_REMOTE_CONTROL_V1.pageVersion
          : dependencies.appVersion,
      theme,
    });
  }

  return {
    // fork 净化：上游通知推送 API（MobilePushConnection，官方 V2 http 通道）随账号通道剥离；保留我方连接设置读取。
    getConnectionSettings: () => dependencies.connectionProvider?.getSettings(),
    authorizeStart,
    async startAuthorized(
      windowId: number,
      context: WebRemoteControlContext,
      authorization: WebRemoteControlStartAuthorization,
    ): Promise<WebRemoteControlStartResult> {
      consumeStartAuthorization(windowId, context, authorization);
      return this.start(windowId, context);
    },
    async start(
      windowId: number,
      context: WebRemoteControlContext,
      resetPairing = false,
    ): Promise<WebRemoteControlStartResult> {
      clearStartAuthorizationsForWindow(windowId);
      dependencies.featureGate.assertEnabled();
      startupRestoreClaimed = true;
      const stopped = stopWindowRuntime(windowId, "restart");
      const controller = new AbortController();
      windowLifecycles.set(windowId, { controller });
      const signal = controller.signal;
      const assertActive = () => signal.throwIfAborted();
      let runtime: WindowControlRuntime | undefined;
      let connection: WebRemoteControlPreparedConnection | undefined;
      try {
        await stopped;
        assertActive();
        connection = await dependencies.connectionProvider?.prepare(
          windowId,
          context.connection,
          signal,
          resetPairing,
        );
        assertActive();
        const endpointUrls = await dependencies.getEndpointUrls?.();
        assertActive();
        const relayWsUrl =
          connection?.relayWsUrl ?? endpointUrls?.relayWsUrl ?? dependencies.relayWsUrl;
        const mobileRemoteControlUrl =
          connection?.mobileRemoteControlUrl ??
          endpointUrls?.remoteUrl ??
          dependencies.mobileRemoteControlUrl;
        const authStorageProvider =
          connection?.authStorageProvider ?? dependencies.authStorageProvider;
        const storedAuth = await authStorageProvider.load();
        assertActive();
        // fork 净化：上游在此走 V2 JWT/deviceStorage 注册（官方账号通道）；保留我方 HMAC transportAuth 初始化。
        const transportAuth: WebRemoteControlDeviceTransportAuth = storedAuth
          ? { mode: "persisted", deviceSid: storedAuth.deviceSid, passHash: storedAuth.passHash }
          : {
              mode: "register",
              passHash: dependencies.authProvider.createPassHash(
                dependencies.authProvider.createPassword(),
              ),
            };
        let readyAuth =
          transportAuth.mode === "persisted"
            ? { deviceSid: transportAuth.deviceSid, passHash: transportAuth.passHash }
            : undefined;
        let registeredAuth: { deviceSid: string; passHash: string } | undefined;
        const isCurrent = () =>
          !signal.aborted && runtime !== undefined && runtimes.get(windowId) === runtime;        const readyPromise = new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
          };
          const aborted = () => finish(new Error("Web remote control start cancelled"));
          const timeout = setTimeout(
            () =>
              finish(
                new Error("External relay device did not reach QR-ready state before timeout."),
              ),
            EXTERNAL_RELAY_QR_READY_TIMEOUT_MS,
          );
          signal.addEventListener("abort", aborted, { once: true });
          const transport = createTransport({
            relayWsUrl,
            deviceMid: dependencies.deviceMid,
            auth: transportAuth,
            authProvider: dependencies.authProvider,
            meta: {
              platform: process.platform,
              version: dependencies.appVersion,
              name: dependencies.deviceName,
            },
            // fork 净化：上游 getToken/resolveDeviceSid 由官方 V2 http 通道提供，本地 HMAC 通道由 auth/authProvider 完成，不随入。
            logger: dependencies.logger,
            relayMessageLogger: dependencies.relayMessageLogger,
            onRegisteredAuth: (auth) => {
              if (!isCurrent()) return;
              registeredAuth = readyAuth = auth;
            },
            onStateChange: (state) => {
              if (!isCurrent() || !runtime) return;
              mapTransportState(runtime, state);
              if ((state === "waiting_terminal" || state === "paired") && readyAuth) finish();
            },
            onPayload: (payload) => {
              if (isCurrent() && runtime) routePayload(runtime, payload);
            },
            onRawTransportPayload: (payload) => {
              return isCurrent() && runtime ? routeRawTransportCandidate(runtime, payload) : false;
            },
            onRawTransportFault: (reasonCode) => {
              if (isCurrent()) runtime?.currentBridge?.relayProtocol?.markDegraded(reasonCode);
            },
            onSendReady: (event) => {
              if (!isCurrent() || !runtime) return;
              flushPendingOutboundPayloads(runtime);
              // 吸收上游修复：后台可能丢弃首次失效通知，沿已有心跳重送直到新 bridge identity 接管（Web 侧幂等）。
              // 后台可能丢弃首次失效通知；沿已有心跳重送直到新 bridge identity 接管。
              // Web 按 bridge 幂等消费，重复通知不会重置恢复或退避预算。
              sendPendingBridgeInvalidation(runtime);
              const isFirstSendReadyForPairing = !runtime.hasObservedSendReadyForPairing;
              runtime.hasObservedSendReadyForPairing = true;
              if (event.kind === "reconnected-socket" || isFirstSendReadyForPairing) {                requestMobileTaskView(runtime);
              }
              const relayProtocol = runtime.currentBridge?.relayProtocol;
              if (relayProtocol && !relayProtocol.isDegraded())
                relayProtocol.replayUnacknowledged();
            },
            onError: (error) => {
              if (!isCurrent()) return;
              dependencies.logger.warn("[web-remote-control] external relay device error", {
                message: error.message,
              });
            },
            onInvalidPersistedAuth: async () => {
              if (!isCurrent()) return;
              await resetExternalRelayDeviceAuth(
                authStorageProvider,
                dependencies.logger,
                "auth-failed",
              );
            },
          });
          runtime = {
            connection,
            windowId,
            workspacePath: context.workspacePath,
            workspaceIdentity: context.workspaceIdentity,
            remoteSessionId: context.remoteSessionId,
            initialTaskId: context.initialTaskId,
            theme: context.theme,
            status: "starting",
            deviceSid: readyAuth?.deviceSid ?? "pending",
            passHash: readyAuth?.passHash ?? transportAuth.passHash,
            deviceMid: dependencies.deviceMid,
            connectUrl: "",
            qrUrl: "",
            transport,
            mobileConnected: false,
            hasEverPaired: false,
            hasObservedSendReadyForPairing: false,
            pendingOutboundPayloads: [],
          };
          runtimes.set(windowId, runtime);
          emitRuntimeStatus(runtime);
          transport.start();
        });
        await readyPromise;
        assertActive();
        const auth = readyAuth;
        if (!auth || !runtime)
          throw new Error("External relay auth was not available after transport became ready.");
        if (registeredAuth) {
          await authStorageProvider.save(registeredAuth);
          assertActive();
        }
        await connection?.commit();
        assertActive();
        await dependencies.startupRestoreStorageProvider.save({
          ...(connection ? { connection: connection.settings } : {}),
          workspacePath: context.workspacePath,
          workspaceIdentity: context.workspaceIdentity,
          initialTaskId: context.initialTaskId,
        });
        assertActive();
        // 直连页面从自身 origin 解析 /ws；不能把 Main 使用的 loopback 地址发给手机。
        const qrUrl = createQrUrl(auth, mobileRemoteControlUrl, context.theme, connection);
        runtime.deviceSid = auth.deviceSid;
        runtime.passHash = auth.passHash;
        runtime.qrUrl = runtime.connectUrl = qrUrl;
        emitRuntimeStatus(runtime);
        return {
          status: runtime.status === "active" ? "active" : "running",
          connection: connection?.settings,
          sessionId: auth.deviceSid,
          windowControlSessionId: auth.deviceSid,
          qrUrl,
          connectUrl: qrUrl,
          workspacePath: context.workspacePath,
          workspaceIdentity: context.workspaceIdentity,
          remoteSessionId: context.remoteSessionId,
          initialTaskId: context.initialTaskId,
        };
      } catch (error) {
        // 停止或新启动可能已接管窗口；旧代失败不能关闭新代连接。
        if (windowLifecycles.get(windowId)?.controller === controller)
          await stopWindowRuntime(windowId, "start-failed");
        await connection?.dispose();
        throw error;
      }
    },

    async stop(windowId: number): Promise<void> {
      lifecycleRevision += 1;
      startupRestoreClaimed = true;
      clearStartAuthorizationsForWindow(windowId);
      // Bugfix: 清除自动恢复设置需要写磁盘，失败时不能阻止用户关闭当前远控连接。
      // 先释放 transport 和 attachment，再把持久化错误返回 UI，保证本次运行立即停止。
      await stopWindowRuntime(windowId, "manual-stop");
      await dependencies.startupRestoreStorageProvider.clear();
    },

    async suspend(windowId: number, reason: string): Promise<void> {
      clearStartAuthorizationsForWindow(windowId);
      // fork 净化：上游在 endpoint-changed 时刷新官方通知连接（notificationConnection），随 V2 通道剥离。
      await stopWindowRuntime(windowId, reason);
    },

    async resetPairing(
      windowId: number,
      // fork 净化：上游 resetPairing 之后的官方登录态通知路径（signed-in/signed-out，V2 JWT）随账号通道剥离；保留我方 HMAC 重配对实现。
      context: WebRemoteControlContext,
    ): Promise<WebRemoteControlStartResult> {
      // Bugfix: refresh 入口和 start 一样受功能开关保护。
      // 之前 gate 校验藏在后续 start 里，feature disabled 时会先清掉本地配对材料再抛错。
      // 这里前置校验，避免禁用态 IPC 产生破坏性副作用。
      dependencies.featureGate.assertEnabled();
      // Bugfix: 二维码 URL 里携带的 sid/hash 泄露后，重启当前 runtime 仍会复用持久化配对材料。
      // 这里必须先关闭旧连接并清掉本地 relay auth，再重新注册设备，确保旧 URL 不再代表当前桌面端会话。
      if (dependencies.connectionProvider) {
        const connection = runtimes.get(windowId)?.connection?.settings ?? context.connection;
        return this.start(windowId, { ...context, connection }, true);      }
      await stopWindowRuntime(windowId, "leaked-qr");
      await resetExternalRelayDeviceAuth(
        dependencies.authStorageProvider,
        dependencies.logger,
        "leaked-qr",
      );
      return this.start(windowId, context);
    },
    async resetPairingAuthorized(
      windowId: number,
      context: WebRemoteControlContext,
      authorization: WebRemoteControlStartAuthorization,
    ): Promise<WebRemoteControlStartResult> {
      consumeStartAuthorization(windowId, context, authorization);
      return this.resetPairing(windowId, context);
    },

    async restorePreviouslyEnabled(
      windowId: number,
      candidates: Array<WebRemoteControlContext & { label?: string }>,
    ): Promise<boolean> {
      // 修复原因：候选快照与 syncAvailableWorkspaces 共用同一份 WorkspaceTarget 表，label 是必填展示字段；
      // 生产调用方传入完整目标，只有仅携带 context 的调用需要回退到路径，不能写入缺 label 的列表项。
      availableWorkspacesByWindowId.set(
        windowId,
        candidates.map((candidate) => ({
          ...candidate,
          label: candidate.label ?? candidate.workspacePath,
          kind: candidate.workspaceIdentity || candidate.remoteSessionId ? "remote" : "local",
        })),
      );
      if (startupRestoreClaimed || runtimes.has(windowId)) return false;
      const revision = lifecycleRevision;
      const persistedContext = await dependencies.startupRestoreStorageProvider
        .load()
        .catch((error) => {
          dependencies.logger.warn(
            "[web-remote-control] load startup restore context failed",
            error,
          );
          return undefined;
        });
      if (revision !== lifecycleRevision || startupRestoreClaimed || !persistedContext) {
        return false;
      }

      const persistedWorkspaceKey = resolveWebRemoteControlWorkspaceKey(persistedContext);
      // 磁盘读取期间可能发生 tab 关闭或远端重连，只能消费最新完整快照。
      const currentContext = availableWorkspacesByWindowId
        .get(windowId)
        ?.find(
          (candidate) => resolveWebRemoteControlWorkspaceKey(candidate) === persistedWorkspaceKey,
        );
      if (
        !currentContext ||
        (currentContext.kind === "remote" && !currentContext.remoteSessionId)
      ) {
        return false;
      }

      startupRestoreClaimed = true;
      dependencies.logger.info(
        `[web-remote-control] restoring previous enabled state window=${windowId} workspace=${currentContext.workspacePath} remoteSession=${currentContext.remoteSessionId ?? "none"}`,
      );
      try {
        await this.start(windowId, {
          workspacePath: currentContext.workspacePath,
          workspaceIdentity: currentContext.workspaceIdentity,
          remoteSessionId: currentContext.remoteSessionId,
          initialTaskId: persistedContext.initialTaskId,
          connection: persistedContext.connection,
        });
        return true;
      } catch (error) {
        if (revision === lifecycleRevision) startupRestoreClaimed = false;
        dependencies.logger.warn(
          "[web-remote-control] restore previous enabled state failed",
          error,
        );
        return false;
      }
    },

    /** 找到可拉日志的已配对连接：优先指定窗口，否则任一已配对窗口。 */
    findMobileLogPullTarget(
      windowId: number | undefined,
    ): WebRemoteControlMobileLogPullTarget | undefined {
      const runtime = findMobileLogPullRuntime(windowId);
      if (!runtime) return undefined;
      return {
        windowId: runtime.windowId,
        deviceLabel: resolveMobileLogDeviceLabel(runtime) || "mobile",
      };
    },

    /** 向已配对手机拉取日志；分片逐片交给 onShard 落盘，全部完成后返回汇总。 */
    pullMobileLogs(
      windowId: number,
      query: MobileLogPullQuery,
      onShard: (shard: MobileLogPullShard) => Promise<void>,
    ): Promise<MobileLogPullSummary> {
      const runtime = findMobileLogPullRuntime(windowId);
      if (!runtime || runtime.windowId !== windowId) {
        return Promise.reject(
          new MobileLogPullError("not-paired", "no paired mobile for this window"),
        );
      }
      return mobileLogPulls.start({
        owner: runtime,
        query,
        send: (payload) => sendAppPayload(runtime, payload),
        onShard,
      });
    },

    getStatus(windowId: number): WebRemoteControlStatus {
      if (!dependencies.featureGate.isEnabled()) {
        return {
          status: "idle",
          failure: createFailure(
            "unsupported-action",
            "Web remote control is disabled in this build.",
          ),
        };
      }

      const runtime = runtimes.get(windowId);
      if (!runtime) {
        return { status: "idle" };
      }

      return buildRuntimeStatus(runtime);
    },

    syncAvailableWorkspaces(windowId: number, workspaces: WebRemoteControlWorkspaceTarget[]): void {
      availableWorkspacesByWindowId.set(windowId, workspaces);
      const runtime = runtimes.get(windowId);
      if (!runtime) {
        return;
      }
      pushWorkspaceListUpdated(runtime);
    },

    syncAvailableTasks(
      windowId: number,
      tasks: WebRemoteControlTaskTarget[],
      directory?: WebRemoteControlLegacyDirectory,
    ): void {
      const runtime = runtimes.get(windowId);
      if (!runtime) {
        return;
      }
      if (directory) {
        if (
          runtime.connection?.settings.mode !== "official" ||
          !["running", "connecting", "active"].includes(runtime.status) ||
          directory.windowControlSessionId !== runtime.deviceSid
        )
          return;
        legacyDirectoriesByWindowId.set(windowId, directory);
      }
      availableTasksByWindowId.set(windowId, tasks);
      pushWorkspaceListUpdated(runtime);
    },

    async replaceRemoteSession(event: {
      previousSessionId: string;
      sessionId: string;
      workspacePath: string;
      workspaceIdentity: string;
    }): Promise<void> {
      for (const [windowId, runtime] of runtimes) {
        const bridge = runtime.currentBridge;
        const bridgeMatches =
          bridge?.remoteSessionId === event.previousSessionId &&
          bridge.workspacePath === event.workspacePath &&
          bridge.workspaceIdentity === event.workspaceIdentity;
        const runtimeMatches = runtime.remoteSessionId === event.previousSessionId;
        const availableWorkspaces = availableWorkspacesByWindowId.get(windowId);
        if (availableWorkspaces) {
          availableWorkspacesByWindowId.set(
            windowId,
            availableWorkspaces.map((workspace) =>
              workspace.remoteSessionId === event.previousSessionId &&
              workspace.workspacePath === event.workspacePath &&
              workspace.workspaceIdentity === event.workspaceIdentity
                ? { ...workspace, remoteSessionId: event.sessionId, connectionState: "connected" }
                : workspace,
            ),
          );
        }
        if (runtimeMatches) runtime.remoteSessionId = event.sessionId;
        if (!bridgeMatches || !bridge) {
          if (runtimeMatches || availableWorkspaces) pushWorkspaceListUpdated(runtime);
          continue;
        }

        // Bug 原因：过去 Main 复用相同 bridge identity 重建 acknowledged protocol，
        // 新协议的 seq 从 1 开始，手机 assembler 却仍等待 N+1，新帧会被当成旧 duplicate
        // 静默丢弃。这里只发非终态 degraded，由 Web 已有恢复流程以新 identity 主动重建。
        bridge.degraded = true;
        runtime.pendingBridgeInvalidation = {
          zcode_type: "bridge-degraded",
          bridgeSessionId: bridge.bridgeSessionId,
          ...(bridge.bridgeGeneration === undefined
            ? {}
            : { bridgeGeneration: bridge.bridgeGeneration }),
          ...(bridge.recoveryId ? { recoveryId: bridge.recoveryId } : {}),
          reason: "source-session-replaced",
        };
        disposeRuntimeBridgeResources(runtime);
        sendPendingBridgeInvalidation(runtime);
        pushWorkspaceListUpdated(runtime);
      }
    },

    async disposeWindow(windowId: number): Promise<void> {
      lifecycleRevision += 1;
      clearStartAuthorizationsForWindow(windowId);
      await stopWindowRuntime(windowId, "window-disposed");
      availableWorkspacesByWindowId.delete(windowId);
      availableTasksByWindowId.delete(windowId);
      pushedWorkspaceListSignaturesByWindowId.delete(windowId);
    },

    failRemoteSession(
      remoteSessionId: string,
      reason: string,
      failure: WebRemoteControlFailure,
    ): void {
      for (const [windowId, runtime] of runtimes) {
        const bridge = runtime.currentBridge;
        const bridgeUsesRemoteSession = bridge?.remoteSessionId === remoteSessionId;
        const runtimeUsesRemoteSession = runtime.remoteSessionId === remoteSessionId;

        if (!bridgeUsesRemoteSession && !runtimeUsesRemoteSession) {
          continue;
        }

        // Bugfix: 远程 workspace session 只是某个 workspace/bridge 的依赖，不能把它的断开升级成
        // 窗口级 Web 远控 device WS 失败；否则单个远端空闲退出会错误关闭电脑端全局远控入口。
        if (bridgeUsesRemoteSession) {
          disposeRuntimeBridgeResources(runtime);
          sendAppPayload(runtime, {
            zcode_type: "workspace-bridge-error",
            bridgeSessionId: bridge.bridgeSessionId,
            ...(bridge.bridgeGeneration !== undefined
              ? { bridgeGeneration: bridge.bridgeGeneration }
              : {}),
            ...(bridge.recoveryId ? { recoveryId: bridge.recoveryId } : {}),
            requestId: `remote-session-closed:${remoteSessionId}`,
            reason: failure.reason,
            error: failure.message ?? failure.reason,
          });
        }
        if (runtimeUsesRemoteSession) {
          runtime.remoteSessionId = undefined;
        }
        // workspace 生命周期不能复活因401或KICKED终止的设备连接。
        if (runtime.status !== "error") {
          runtime.status = runtime.mobileConnected ? "active" : "running";
          runtime.error = undefined;
          runtime.failure = undefined;
        }
        runtimes.set(windowId, runtime);
        emitRuntimeStatus(runtime);
      }
      dependencies.disposeWorkspaceHostAttachmentsForRemoteSession(remoteSessionId, reason);
    },
  };
}
