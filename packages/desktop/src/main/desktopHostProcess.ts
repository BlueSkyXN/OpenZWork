import type { HostQuitBlocker } from "@zcode/shared";
import {
  createSystemCredentialCipher,
  executeCredentialCipherRequest,
} from "@zcode/shared/credential-security";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";
import { getCredentialsFilePath } from "@zcode/services/node";
import { bindAppControlNavigationHost } from "#src/app-control-navigation/main.js";
/* eslint-disable max-lines -- host process 统一处理 main↔host 生命周期、日志、ZCode Agent，拆分前先保持跨进程消息收口。 */
import {
  type HostAgentProcessErrorResponse,
  type HostAgentProcessExceptionResponse,
  type HostAgentProcessExitedResponse,
  type HostAgentProcessReadyResponse,
  type HostAgentProcessSpawnedResponse,
  // data-sync 域：Provisioning lane 状态类型（本机配置推送远端设备的协调器协议）。
  type ProviderProvisioningLaneStatus,
  type RemoteTarget,
  type TaskRealtimeHostDeliveryKind,
  type WorkspacePurpose,
  CREDENTIAL_KEY_SHARE_UNAVAILABLE_ERROR_CODE,
  formatZCodeHostProcessName,
  HostMessageTypes,
  hostResponseMessageSchema,
  HostResponseTypes,
  InternalChannels,
  LAUNCH_MARKS_QUERY_KEY,
  RUNTIME_ZCODE_DEBUG,
  serializeLaunchMarks,
  ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV,
  shouldEnableE2ETestBridge,
} from "@zcode/shared";
import type {
  PluginSandboxHandle,
  PluginSandboxRegisterRequestPayload,
  PluginSandboxRegisterResultPayload,
} from "@zcode/shared/mcp-apps";
import type { UtilityProcess as ElectronUtilityProcess, MessagePortMain } from "electron";
import {
  app,
  BrowserWindow,
  utilityProcess as electronUtilityProcess,
  MessageChannelMain,
} from "electron";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { BroadcastHub } from "./broadcastHub.js";
import { bindDatabaseStartupRelay } from "./databaseStartupRelay.js";
import { getMainLaunchPartialMarks } from "./desktopLaunchMarks.js";
import {
  buildHostProcessEnv,
  hostModulePath,
  resolveBundledGlmBinaryPath,
} from "./desktopRuntimeEnv.js";
import { buildHostE2ECoverageEnv } from "./e2eCoverage.js";
import { createHostLogRelay } from "./hostLogRelay.js";
import { resolveHostResourceUsageResult } from "./resourceManagerHostSampling.js";
import {
  registerHostAgentProcess,
  registerHostProcess,
  unregisterHostAgentProcess,
  unregisterHostProcess,
} from "./resourceManagerWindow.js";
import type { RemoteAssetDirs } from "./desktopRuntimeEnv.js";
import type { TaskRealtimeBus } from "./taskRealtimeBus.js";

export interface WindowBootstrapOptions {
  restoreSession?: boolean;
  supportsSettings?: boolean;
  initialWorkspacePath?: string;
  initialWorkspacePurpose?: WorkspacePurpose;
  unavailableWorkspacePath?: string;
  windowKind?: "main" | "update-status";
  locale?: string;
}

export interface HostInitMessage {
  browserBackendIdentity?: { id: string; generation: number };
  type: typeof HostMessageTypes.InitLocal;
  hostId?: string;
  databaseStartupId?: string;
  deliveryKind?: TaskRealtimeHostDeliveryKind;
  deviceMid?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  agentWarmupTargets?: Array<{
    workspacePath: string;
    workspaceIdentity?: string;
  }>;
  agentSpawnFallbackCwd?: string;
  remoteAssets?: RemoteAssetDirs;
  /** Main 持有的 Agent 回复语言（null 为未设置）；后续变化由 reply-language-changed 推送。 */
  replyLanguage: string | null;
  /** Main 解析后的 ZCode Built-in Provider Config 路径；Host/Services 不感知 Electron 安装布局。 */
  zcodeBuiltinProviderConfigFilePath: string;
  /** 构建固定目标，不包含安装状态；本机 Host 用共享纯函数解析记录地址。 */
  /** Main 提前异步采集并过滤的本机 runtime 环境；只允许传给 InitLocal。 */
  runtimeProcessEnvPatch?: Record<string, string>;
}

export interface SpawnHostProcessOptions {
  internalChannel?: typeof InternalChannels.ServicePort | typeof InternalChannels.ScopedServicePort;
  internalPayload?: unknown;
  registerBroadcast?: boolean;
  taskRealtime?: {
    workspaceKeys: Iterable<string>;
    deliveryKind?: TaskRealtimeHostDeliveryKind;
    onHostId?: (hostId: string) => void;
  };
  onPortReady?: (port: MessagePortMain) => void;
  /** 共享 SSH/WSL Host 初始化时不创建特殊的首个 workspace RPC port。 */
  attachInitialServicePort?: boolean;
}

const exitedHostProcesses = new WeakSet<ElectronUtilityProcess>();
const disposingHostProcesses = new Set<ElectronUtilityProcess>();

export function listDisposingHostProcesses(): ElectronUtilityProcess[] {
  return Array.from(disposingHostProcesses);
}

export function loadWindow(
  win: BrowserWindow,
  page: "index" | "login" = "index",
  bootstrap?: WindowBootstrapOptions,
): Promise<void> {
  const query = Object.fromEntries(
    Object.entries({
      restoreSession:
        bootstrap?.restoreSession == null ? undefined : String(bootstrap.restoreSession),
      supportsSettings:
        bootstrap?.supportsSettings == null ? undefined : String(bootstrap.supportsSettings),
      initialWorkspacePath: bootstrap?.initialWorkspacePath,
      initialWorkspacePurpose: bootstrap?.initialWorkspacePurpose,
      unavailableWorkspacePath: bootstrap?.unavailableWorkspacePath,
      windowKind: bootstrap?.windowKind,
      locale: bootstrap?.locale,
      // OpenZWork(OZ-F012): pane runtime identity E2E 诊断的 run ID 注入——与 Host probe
      // 同一 gate（build flag + 非空 run ID）才随 URL 下发；生产构建 flag 缺失时不存在。
      ...(shouldEnableE2ETestBridge(process.env)
        ? { zcodeE2eRunId: process.env.ZCODE_E2E_RUN_ID?.trim() }
        : {}),
    }).filter((entry): entry is [string, string] => entry[1] != null),
  );

  if (page === "index") {
    const partial = getMainLaunchPartialMarks();
    query[LAUNCH_MARKS_QUERY_KEY] = serializeLaunchMarks({
      ...partial,
      loadUrl: Date.now(), // T3
    });
  }

  // 生产包不能信任继承环境中的开发服务器地址，否则会被本机开发会话劫持为空白页。
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    const base = process.env["ELECTRON_RENDERER_URL"];
    const url = new URL(page === "login" ? `${base}/login.html` : base);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return win.loadURL(url.toString());
  } else {
    return win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`), {
      query,
    });
  }
}

export function spawnHostProcess(
  win: BrowserWindow,
  label: string,
  initMessage: HostInitMessage,
  dependencies: {
    hostProcessLocalEnv: Record<string, string>;
    /** Main 进程已完成服务端灰度裁决；Host 只消费这个快照，不自行请求或分桶。 */
    desktopContextPromptEnabled?: () => boolean;
    logger: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
    };
    broadcastHub: BroadcastHub;
    taskRealtimeBus?: TaskRealtimeBus;
    windowHostProcessMap: Map<number, ElectronUtilityProcess>;
    hostRunningTaskCountMap: Map<ElectronUtilityProcess, number>;
    /** 每个 Host 当前阻止退出的事项（docs/git/worktree.md §6.4）；空集合时删除条目。 */
    hostQuitBlockersMap: Map<ElectronUtilityProcess, HostQuitBlocker[]>;
    onWorkspaceRunningTaskCountChanged?: (
      child: ElectronUtilityProcess,
      event: {
        workspacePath: string;
        workspaceIdentity?: string;
        runningTaskCount: number;
      },
    ) => void;
    onAgentProcessExited?: (event: HostAgentProcessExitedResponse) => void;
    onAgentProcessError?: (event: HostAgentProcessErrorResponse) => void;
    onAgentProcessException?: (event: HostAgentProcessExceptionResponse) => void;
    onAgentProcessReady?: (event: HostAgentProcessReadyResponse) => void;
    onAgentProcessSpawned?: (event: HostAgentProcessSpawnedResponse) => void;
    // 吸收上游 v3.14.3 的 bots 远端工作区三个回调；onMcpTelemetry/onSessionCreateTelemetry
    // 属我方 WP-05 已删遥测链，onCuaOperationState* 属 D-14 已删 CUA 链，均不再引入。
    handleBotRemoteWorkspaceReconnectRequest?: (params: {
      win: BrowserWindow;
      requestId: string;
      workspacePath: string;
      workspaceIdentity: string;
      target: RemoteTarget;
    }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
    handleBotRemoteWorkspaceConnectionStatusRequest?: (params: {
      win: BrowserWindow;
      requestId: string;
      workspacePath: string;
      workspaceIdentity: string;
      target: RemoteTarget;
    }) => Promise<{ ok: boolean; connected?: boolean; error?: string }>;
    handleBotRemoteWorkspaceRuntimePortRequest?: (params: {
      win: BrowserWindow;
      requestId: string;
      workspacePath: string;
      workspaceIdentity: string;
      target: RemoteTarget;
    }) => Promise<{
      ok: boolean;
      port?: MessagePortMain;
      error?: string;
    }> /** host → main：定时任务派发结果，转交给 cron scheduler 结算调度状态机。 */;
    onCronRunResult?: (result: {
      runId: string;
      ok: boolean;
      taskId?: string;
      sessionId?: string;
      error?: string;
      failureKind?: "transient" | "permanent";
    }) => void;
    /** host 中 manual run 落库后请求 main 立即唤醒 scheduler。 */
    onCronSchedulerWakeRequested?: (automationId: string) => void;
    // browser-use：main 用 WebContentsView+CDP 执行一条命令。实现由宿主注入；缺省则 backend_unavailable。
    handleBrowserExecuteRequest?: (params: {
      win: BrowserWindow;
      requestId: string;
      browserId?: string;
      browserGeneration?: number;
      controlScopeId?: string;
      sessionId: string;
      turnId?: string;
      workspaceKey?: string;
      workspacePath?: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      clientMode?: "desktop-continuous" | "web-remote-replayable";
      sessionContext?: "live" | "cached";
      command: unknown;
    }) => Promise<{ ok: boolean; [k: string]: unknown }>;
    /** Host 已完成附件授权后，由 Main 将本地视频 realpath 加入精确协议授权集合。 */
    authorizeLocalMediaPreviewPath?: (path: string) => Promise<string>;
    /** Host 校验完插件 UI HTML 后交给 Main 沙箱注册表登记，返回句柄。 */
    registerPluginSandbox?: (
      input: PluginSandboxRegisterRequestPayload,
    ) => PluginSandboxHandle | Promise<PluginSandboxHandle>;
    /** 数据同步页经本机 Host 读取 / 重试 Main 协调器的 Provisioning lane（按 sourceServerId）。 */
    providerProvisioningLanes?: {
      getStatus(
        sourceServerId: string,
        options: { waitForIdle: boolean },
      ): Promise<ProviderProvisioningLaneStatus>;
      retry(sourceServerId: string): Promise<ProviderProvisioningLaneStatus>;
    };
  },
  options?: SpawnHostProcessOptions,
): ElectronUtilityProcess {
  const hostId = randomUUID();
  // 系统库只由 Main 访问；路径在 fork 时绑定，Host 不能指定其他凭据目录。
  // 与 Host 凭据服务共用同一路径解析入口，保证 Main 绑定的 cipher 与 Host 读写的文件一致。
  const credentialCipher = createSystemCredentialCipher({ filePath: getCredentialsFilePath() });
  const glmBinaryPath = resolveBundledGlmBinaryPath();
  const execArgv = [
    ...(RUNTIME_ZCODE_DEBUG ? [`--inspect-brk=${RUNTIME_ZCODE_DEBUG}`] : []),
    "--no-warnings",
  ];
  const child = electronUtilityProcess.fork(hostModulePath, [], {
    serviceName: formatZCodeHostProcessName(label),
    execArgv,
    env: {
      ...buildHostProcessEnv(dependencies.hostProcessLocalEnv),
      ...buildHostE2ECoverageEnv(),
      ZCODE_PROCESS_LABEL: label,
      ...(dependencies.desktopContextPromptEnabled
        ? {
            [ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV]: dependencies.desktopContextPromptEnabled()
              ? "1"
              : "0",
          }
        : {}),
    },
  });

  dependencies.logger.info(
    `[spawnHostProcess] forked host process for (${label}), pid=${child.pid}`,
  );
  dependencies.logger.info(`[spawnHostProcess] host module path: ${hostModulePath}`);
  dependencies.logger.info(`[spawnHostProcess] glm binary path: ${glmBinaryPath ?? "<not found>"}`);
  dependencies.logger.info(
    `[spawnHostProcess] BIGMODEL_OAUTH_APP_SECRET source: ${process.env.BIGMODEL_OAUTH_APP_SECRET ? "process" : dependencies.hostProcessLocalEnv.BIGMODEL_OAUTH_APP_SECRET ? "dotenv" : "fallback"}`,
  );

  // 远程连接与本地服务共享 window Host，进程级 stdout 没有请求身份。
  // 连接进度改由 HostResponseTypes.RemoteWorkspaceConnectionLog 按 requestId 上报。
  const hostLogRelay = createHostLogRelay(
    label,
    dependencies.logger as Parameters<typeof createHostLogRelay>[1],
  );

  child.stderr?.on("data", (data: Buffer) => {
    hostLogRelay.onStderr(data.toString());
  });
  child.stdout?.on("data", (data: Buffer) => {
    hostLogRelay.onStdout(data.toString());
  });

  const databaseStartupRelay = bindDatabaseStartupRelay(win, child, hostId);
  const unbindAppNavigation = bindAppControlNavigationHost(win, child, (id) =>
    BrowserWindow.fromId(id),
  );
  child.once("exit", unbindAppNavigation);
  child.on("message", (message: unknown) => {
    const result = hostResponseMessageSchema.safeParse(message);
    if (!result.success) {
      return;
    }

    if (result.data.type === HostResponseTypes.CredentialCipherRequest) {
      const { type: _type, ...request } = result.data;
      void executeCredentialCipherRequest(credentialCipher, request)
        .then((reply) => {
          if (!exitedHostProcesses.has(child)) {
            child.postMessage({ type: HostMessageTypes.CredentialCipherResult, ...reply });
          }
        })
        .catch(() => {
          // Host 已退出时只能放弃回包；任何凭据输入/结果都不得进入日志。
        });
      return;
    }

    if (result.data.type === HostResponseTypes.CredentialKeyShareRequest) {
      const { requestId, targetBaseDir } = result.data;
      // 修复原因（ZCT-2120723935487688704）：切换数据存储路径只复制凭据文件，新根缺少系统条目，
      // 重启后掉登录且无法重新登录。Host 只提供数据根；凭据路径由 Main 按 copyDataDirectory 的
      // 目标布局推导，密钥不离开 Main，也不开放对目标目录的加解密。
      const share = isAbsolute(targetBaseDir)
        ? credentialCipher.shareKeyWithCopiedCredentials(
            // OpenZWork（WP-03 唯一数据根）：凭据文件随数据根常量，不用上游 .zcode 字面量。
            join(targetBaseDir, OPENZWORK_DATA_DIR_NAME, "v2", "credentials.json"),
          )
        : Promise.reject(new Error("Data root must be absolute"));
      void share
        .then(
          () => ({ ok: true }),
          () => ({ ok: false, errorCode: CREDENTIAL_KEY_SHARE_UNAVAILABLE_ERROR_CODE }),
        )
        .then((reply) => {
          dependencies.logger.info(`[credential-key-share] ${reply.ok ? "completed" : "failed"}`);
          if (!exitedHostProcesses.has(child)) {
            child.postMessage({
              type: HostMessageTypes.CredentialKeyShareResult,
              requestId,
              ...reply,
            });
          }
        })
        .catch(() => {
          // Host 已退出时只能放弃回包；原生异常不进入日志，避免泄露系统细节。
        });
      return;
    }

    if (result.data.type === HostResponseTypes.DatabaseStartupState) {
      databaseStartupRelay.receive(result.data.state);
      return;
    }

    if (result.data.type === HostResponseTypes.Log) {
      hostLogRelay.onStructuredLog(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.ResourceUsageSnapshotResult) {
      resolveHostResourceUsageResult(label, result.data);
      return;
    }

    // fork 净化：上游 ToolExecResource/McpResourceSamples/McpTelemetry/PluginTelemetry/RemoteConversationTelemetry/
    // SessionCreateTelemetry 六类 host→main 遥测路由随官方遥测链剥离（详见文件头注释）。
    if (result.data.type === HostResponseTypes.LocalMediaPreviewPathAuthorizeRequest) {
      const request = result.data;
      const authorize = dependencies.authorizeLocalMediaPreviewPath;
      if (!authorize) {
        child.postMessage({
          type: HostMessageTypes.LocalMediaPreviewPathAuthorizeResult,
          requestId: request.requestId,
          ok: false,
          error: "Local media preview path authorization is unavailable.",
        });
        return;
      }
      void authorize(request.path)
        .then((path) => {
          child.postMessage({
            type: HostMessageTypes.LocalMediaPreviewPathAuthorizeResult,
            requestId: request.requestId,
            ok: true,
            path,
          });
        })
        .catch((error) => {
          child.postMessage({
            type: HostMessageTypes.LocalMediaPreviewPathAuthorizeResult,
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (result.data.type === HostResponseTypes.PluginSandboxRegisterRequest) {
      const request = result.data;
      const register = dependencies.registerPluginSandbox;
      const reply = (payload: PluginSandboxRegisterResultPayload) =>
        child.postMessage({ type: HostMessageTypes.PluginSandboxRegisterResult, ...payload });
      if (!register || win.isDestroyed() || request.ownerWebContentsId !== win.webContents.id) {
        reply({
          requestId: request.requestId,
          ok: false,
          error: "Plugin UI sandbox is unavailable.",
        });
        return;
      }
      void Promise.resolve()
        // schema 的 refine 已按 contentKind 校验归属（扩展视图无会话，其他类型必须有会话）；
        // zod 的推导类型表达不出这层判别，这里收窄成契约的判别联合。
        .then(() => register(request as PluginSandboxRegisterRequestPayload))
        .then((handle) => reply({ requestId: request.requestId, ok: true, ...handle }))
        .catch((error: unknown) =>
          reply({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return;
    }

    // fork 净化：上游 CuaOperationState 投影（D-14 CUA 链）与 FeedbackLogArchive 委托
    // （WP-07 反馈云端链）不随入；ProviderProvisioningLane 属 data-sync 域（本机配置推送远端设备），保留。
    if (result.data.type === HostResponseTypes.ProviderProvisioningLaneRequest) {
      const request = result.data;
      const lanes = dependencies.providerProvisioningLanes;
      const reply = (status: ProviderProvisioningLaneStatus) =>
        child.postMessage({
          type: HostMessageTypes.ProviderProvisioningLaneResult,
          requestId: request.requestId,
          status,
        });
      // 没有协调器（例如未接线的测试宿主）时回「无 lane」：Host 请求总有应答，不靠超时收尾。
      if (!lanes) {
        reply({ lane: "none" });
        return;
      }
      void (
        request.action === "retry"
          ? lanes.retry(request.sourceServerId)
          : lanes.getStatus(request.sourceServerId, { waitForIdle: request.action === "wait" })
      ).then(reply, (error: unknown) => {
        // 协调器的查询与重试不会抛出；万一抛出也要应答，避免 Renderer 一直停在「同步中」。
        dependencies.logger.warn("[provider-provisioning] lane request failed", {
          action: request.action,
          error: error instanceof Error ? error.message : String(error),
        });
        reply({ lane: "none" });
      });
      return;
    }
    if (result.data.type === HostResponseTypes.BrowserExecuteRequest) {
      // browser-use：main 用 WebContentsView+CDP 执行命令（handleBrowserExecuteRequest）。
      // 缺省实现时返回 backend_unavailable，保证通道打通但不阻塞。
      const requestId = result.data.requestId;
      const handler = dependencies.handleBrowserExecuteRequest;
      const fallback = {
        ok: false as const,
        error: {
          code: "backend_unavailable",
          message: "browser executor not ready",
        },
        elapsedMs: 0,
      };
      void (
        handler
          ? handler({
              win,
              requestId,
              controlScopeId: result.data.controlScopeId,
              browserId: result.data.browserId,
              browserGeneration: result.data.browserGeneration,
              sessionId: result.data.sessionId,
              turnId: result.data.turnId,
              workspaceKey: result.data.workspaceKey,
              workspacePath: result.data.workspacePath,
              workspaceIdentity: result.data.workspaceIdentity,
              remoteSessionId: result.data.remoteSessionId,
              clientMode: result.data.clientMode,
              sessionContext: result.data.sessionContext,
              command: result.data.command,
            }).catch((error: unknown) => ({
              ok: false as const,
              error: {
                code: "execution_error",
                message: error instanceof Error ? error.message : String(error),
              },
              elapsedMs: 0,
            }))
          : Promise.resolve(fallback)
      ).then((commandResult) => {
        child.postMessage({
          type: HostMessageTypes.BrowserExecuteResult,
          requestId,
          result: commandResult,
        });
      });
      return;
    }

    if (result.data.type === HostResponseTypes.AgentProcessSpawned) {
      registerHostAgentProcess(label, {
        pid: result.data.pid,
        provider: result.data.provider,
        workspacePath: result.data.workspacePath,
        command: result.data.command,
        args: result.data.args,
        startedAt: result.data.startedAt,
      });
      dependencies.onAgentProcessSpawned?.(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.AgentProcessReady) {
      dependencies.onAgentProcessReady?.(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.AgentProcessExited) {
      unregisterHostAgentProcess(label, result.data.pid);
      dependencies.onAgentProcessExited?.(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.AgentProcessError) {
      dependencies.onAgentProcessError?.(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.AgentProcessException) {
      dependencies.onAgentProcessException?.(result.data);
      return;
    }

    if (result.data.type === HostResponseTypes.CronRunResult) {
      dependencies.onCronRunResult?.({
        runId: result.data.runId,
        ok: result.data.ok,
        taskId: result.data.taskId,
        sessionId: result.data.sessionId,
        error: result.data.error,
        failureKind: result.data.failureKind,
      });
      return;
    }

    if (result.data.type === HostResponseTypes.CronSchedulerWakeRequest) {
      dependencies.onCronSchedulerWakeRequested?.(result.data.automationId);
      return;
    }

    if (result.data.type === HostResponseTypes.AgentRunningTaskCountChanged) {
      if (result.data.runningTaskCount > 0) {
        dependencies.hostRunningTaskCountMap.set(child, result.data.runningTaskCount);
      } else {
        dependencies.hostRunningTaskCountMap.delete(child);
      }
      dependencies.logger.info(
        `[app-quit] host running agent sessions updated (${label}) count=${result.data.runningTaskCount}`,
      );
      return;
    }

    if (result.data.type === HostResponseTypes.WorkspaceRunningTaskCountChanged) {
      dependencies.onWorkspaceRunningTaskCountChanged?.(child, {
        workspacePath: result.data.workspacePath,
        workspaceIdentity: result.data.workspaceIdentity,
        runningTaskCount: result.data.runningTaskCount,
      });
      return;
    }
  });

  const shouldAttachRealtimeHost = options?.taskRealtime != null;
  const hostInitMessage: HostInitMessage = shouldAttachRealtimeHost
    ? {
        ...initMessage,
        databaseStartupId: databaseStartupRelay.startupId,
        hostId,
        deliveryKind: options?.taskRealtime?.deliveryKind,
      }
    : { ...initMessage, databaseStartupId: databaseStartupRelay.startupId };

  if (options?.attachInitialServicePort === false) {
    child.postMessage(hostInitMessage);
  } else {
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage(hostInitMessage, [port2]);

    if (options?.onPortReady) {
      options.onPortReady(port1);
    } else {
      win.webContents.postMessage(
        options?.internalChannel ?? InternalChannels.ServicePort,
        options?.internalChannel === InternalChannels.ScopedServicePort
          ? (options.internalPayload ?? null)
          : { databaseStartupId: databaseStartupRelay.startupId },
        [port1],
      );
    }
  }

  const windowId = win.webContents.id;
  const shouldRegisterBroadcast = options?.registerBroadcast ?? true;
  if (shouldRegisterBroadcast) {
    dependencies.broadcastHub.register(windowId, child);
  }

  if (shouldAttachRealtimeHost && dependencies.taskRealtimeBus && options?.taskRealtime) {
    dependencies.taskRealtimeBus.registerHost({
      hostId,
      windowId: win.id,
      child,
      workspaceKeys: options.taskRealtime.workspaceKeys,
      deliveryKind: options.taskRealtime.deliveryKind,
    });
    options.taskRealtime.onHostId?.(hostId);
  }

  registerHostProcess(label, child);

  child.on("exit", (code) => {
    exitedHostProcesses.add(child);
    hostLogRelay.flushRawLogs();
    dependencies.logger.info(`[spawnHostProcess] host process (${label}) exited with code ${code}`);
    dependencies.hostRunningTaskCountMap.delete(child);
    dependencies.hostQuitBlockersMap.delete(child);
    if (shouldRegisterBroadcast) {
      dependencies.broadcastHub.unregister(windowId);
    }
    unregisterHostProcess(label);
    for (const [wcId, process] of dependencies.windowHostProcessMap) {
      if (process === child) {
        dependencies.windowHostProcessMap.delete(wcId);
        break;
      }
    }
  });

  return child;
}

export function disposeHostProcess(
  child: ElectronUtilityProcess,
  label: string,
  disposingHostProcessTimers: WeakMap<ElectronUtilityProcess, ReturnType<typeof setTimeout>>,
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  forceKillDelayMs = 300,
) {
  if (disposingHostProcessTimers.has(child)) {
    return;
  }
  disposingHostProcesses.add(child);

  logger.info(
    `[disposeHostProcess] disposing host process (${label}), pid=${child.pid ?? "unknown"}`,
  );

  try {
    child.postMessage({ type: HostMessageTypes.Dispose });
  } catch (error) {
    logger.warn(`[disposeHostProcess] failed to post dispose to (${label}):`, error);
  }

  // host 收到 Dispose 后需要等待 agent 进程树的 SIGTERM/SIGKILL 兜底完成。
  // 如果 main 仍按 150/300ms 强杀 host，host 会先退出，zcode-cli/app-server 子进程就可能被 init 接管成孤儿。
  const effectiveForceKillDelayMs = Math.max(forceKillDelayMs, 3_500);
  const killTimer = setTimeout(() => {
    disposingHostProcessTimers.delete(child);
    try {
      child.kill();
    } catch (error) {
      logger.warn(`[disposeHostProcess] failed to kill host process (${label}):`, error);
    }
  }, effectiveForceKillDelayMs);

  disposingHostProcessTimers.set(child, killTimer);
  child.once("exit", () => {
    exitedHostProcesses.add(child);
    disposingHostProcesses.delete(child);
    clearTimeout(killTimer);
    disposingHostProcessTimers.delete(child);
  });
}
export function disposeHostProcessAndWait(
  child: ElectronUtilityProcess,
  label: string,
  disposingHostProcessTimers: WeakMap<ElectronUtilityProcess, ReturnType<typeof setTimeout>>,
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  options: {
    forceKillDelayMs?: number;
    waitTimeoutMs?: number;
  } = {},
): Promise<void> {
  // Electron UtilityProcess 不是 Node ChildProcess，没有 exitCode 字段。
  // 右键 Dock 退出会走 before-quit -> disposeHostProcessAndWait；旧判断把运行中的 host
  // 的 undefined exitCode 当成“已退出”。这里改为记录 exit 事件，避免第一次退出漏发 Dispose。
  if (exitedHostProcesses.has(child)) {
    return Promise.resolve();
  }

  const waitTimeoutMs = Math.max(options.waitTimeoutMs ?? 0, 0);

  return new Promise((resolve) => {
    let settled = false;
    let waitTimeout: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (waitTimeout) {
        clearTimeout(waitTimeout);
        waitTimeout = null;
      }
      resolve();
    };

    child.once("exit", () => {
      exitedHostProcesses.add(child);
      settle();
    });

    if (waitTimeoutMs > 0) {
      waitTimeout = setTimeout(() => {
        logger.warn(
          `[disposeHostProcessAndWait] host process exit wait timed out (${label}), pid=${child.pid ?? "unknown"}`,
        );
        settle();
      }, waitTimeoutMs);
      waitTimeout.unref?.();
    }

    disposeHostProcess(child, label, disposingHostProcessTimers, logger, options.forceKillDelayMs);
  });
}
