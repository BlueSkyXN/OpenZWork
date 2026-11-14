/**
 * workflow-query lane 的共享契约：共享资格判定与常量。
 *
 * spec：docs/specs/saved-workflow-query-lifecycle-openzwork.md。补丁 OW-P024。
 * 资格判定是纯函数：Desktop Host 装配时以启动事实调用一次，UI/RPC 调用方无法自行开启。
 */
import { isAbsolute } from "node:path";

/** 查询 lane 的空闲回收阈值；与 mcp-status 同源的既有 5 分钟语义。 */
export const WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS = 5 * 60_000;

/** Host 装配层掌握的启动事实；逐项含义见 spec「共享资格」。 */
export interface ShareLocalWorkflowQueryRuntimeInput {
  /** 本 Host 的运行面；只有本地 Desktop Host 才有 Main 固定 DB 的前提。 */
  runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  /** Host 装配是否注入了自定义 agent command resolver（zcodeAgentCommandResolver）。 */
  hasCustomCommandResolver: boolean;
  /** Host 进程环境的 ZCODE_AGENT_SERVER_COMMAND 原值；存在即自定义命令覆盖。 */
  agentServerCommandEnv?: string;
  /** Host 进程环境的 ZCODE_SESSION_DB_PATH 原值；须为 Main 注入的绝对路径。 */
  sessionDbPathEnv?: string;
}

/**
 * 判定两项工作流读取是否共用独立 workflow-query carrier。
 *
 * 只有「本地 Desktop + 默认命令链 + Main 固定绝对 DB」同时成立才共享：共享载体打开的
 * 数据库必须与逐项目载体一致（Env 40 高于用户 10/项目 20），且自定义命令可能指向
 * 未知版本 CLI。默认 false。
 */
export function resolveShareLocalWorkflowQueryRuntime(
  input: ShareLocalWorkflowQueryRuntimeInput,
): boolean {
  if (input.runtimeSurface !== "desktop_local_host") return false;
  if (input.hasCustomCommandResolver) return false;
  if (input.agentServerCommandEnv?.trim()) return false;
  const sessionDbPath = input.sessionDbPathEnv?.trim();
  if (!sessionDbPath || !isAbsolute(sessionDbPath)) return false;
  return true;
}
