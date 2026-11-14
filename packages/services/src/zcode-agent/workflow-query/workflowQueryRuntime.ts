/**
 * workflow-query lane 的运行时工厂与载体选择。
 *
 * spec：docs/specs/saved-workflow-query-lifecycle-openzwork.md §2–§3。补丁 OW-P024。
 * 只组合既有 ZCodeAgentProcessManager 的控制面能力（single-flight 启动、默认请求计数、
 * idle 回收、关闭屏障），不新增第二套队列/计时器；不接入 chat 的 useSharedTaskRuntime。
 */
import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import {
  ZCodeAgentProcessManager,
  type ZCodeAgentProcessManagerOptions,
} from "../zcodeAgentProcessManager.js";
import { WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS } from "./contract.js";

/** 控制面选项按 mcp-status 先例转发；useSharedTaskRuntime 不接入。 */
export interface WorkflowQueryRuntimeOptions {
  commandResolver?: ZCodeAgentProcessManagerOptions["commandResolver"];
  presentationSurface?: ZCodeAgentProcessManagerOptions["presentationSurface"];
  requestTimeoutMs?: number;
  processLifecycleReporter?: ZCodeAgentProcessManagerOptions["processLifecycleReporter"];
  resolveSpawnEnv?: ZCodeAgentProcessManagerOptions["resolveSpawnEnv"];
  waitForSpawnAdmission?: ZCodeAgentProcessManagerOptions["waitForSpawnAdmission"];
  spawnFallbackCwd?: string;
  /** 仅供确定性生命周期场景注入短时值；产品缺省 5 分钟。 */
  idleTimeoutMs?: number;
}

export interface WorkflowQueryRuntime {
  /** 独立 manager：与 chat/plugin/mcp-status 互不共享请求队列与 idle timer。 */
  readonly manager: ZCodeAgentProcessManager;
  /** 共享分支的固定载体 workspace（由 agent service 注入管理面路径解析器）。 */
  resolveSharedCarrier(): { workspacePath: string; workspaceIdentity?: string };
  listManagedProcesses(): ReturnType<ZCodeAgentProcessManager["listManagedProcesses"]>;
  disposeAll(): void;
  disposeAllAndWait(): Promise<void>;
}

/**
 * 建立独立 workflow-query manager。`resolveSharedCarrierWorkspacePath` 由 agent service
 * 提供（现有 ensurePluginManagementWorkspacePath 所得管理面目录，复用同一控制面 cwd）。
 */
export function createWorkflowQueryRuntime(
  options: WorkflowQueryRuntimeOptions & {
    resolveSharedCarrierWorkspacePath: () => string;
  },
): WorkflowQueryRuntime {
  const manager = new ZCodeAgentProcessManager({
    commandResolver: options.commandResolver,
    presentationSurface: options.presentationSurface,
    requestTimeoutMs: options.requestTimeoutMs,
    processLifecycleReporter: options.processLifecycleReporter,
    resolveSpawnEnv: options.resolveSpawnEnv,
    waitForSpawnAdmission: options.waitForSpawnAdmission,
    spawnFallbackCwd: options.spawnFallbackCwd,
    lane: "workflow-query",
    idleTimeoutMs: options.idleTimeoutMs ?? WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS,
  });
  return {
    manager,
    resolveSharedCarrier: () => ({ workspacePath: options.resolveSharedCarrierWorkspacePath() }),
    listManagedProcesses: () => manager.listManagedProcesses(),
    disposeAll: () => manager.disposeAll(),
    disposeAllAndWait: () => manager.disposeAllAndWait(),
  };
}

/**
 * 两项读取的载体选择（spec §2 表）：
 * - 共享开关开启且 target 为本地（无 remoteSessionId、identity 非远端）→ 固定管理面 carrier；
 * - 其余带 workspace 的读取（共享关闭/自定义命令/远端/Server）→ 原项目 carrier（按项目分 key）；
 * - 无 workspacePath 的全局读取不经本函数（保持原全局载体选择）。
 *
 * 非共享分支必须原样保留 workspaceIdentity（OW-P024 R1）：ProcessManager 的
 * bind/processKey/命令解析/spawn env 都以 carrier 为准，丢身份会让同路径不同身份的
 * 两个目标合并到同一进程 key，破坏身份隔离（workspaceIdentity 用于身份、
 * workspacePath 用于 IO，见 AGENTS.md「Workspace Identity」）。
 */
export function resolveWorkflowQueryCarrier(
  params: { workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string },
  options: { sharedCarrier: { workspacePath: string }; share: boolean },
): { workspacePath: string; workspaceIdentity?: string } {
  const isLocalTarget =
    !params.remoteSessionId &&
    !(params.workspaceIdentity && isRemoteWorkspaceIdentity(params.workspaceIdentity));
  if (options.share && isLocalTarget) {
    return options.sharedCarrier;
  }
  return {
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
  };
}
