/**
 * workflow-query 标准调用示例：Desktop Host 装配时以启动事实判定共享资格，
 * 结果作为 `shareLocalWorkflowQueryRuntime` 传入 createLocalServices。
 */
import { resolveShareLocalWorkflowQueryRuntime } from "./contract.js";

export function exampleResolveShareLocalWorkflowQueryRuntime(hostEnv: {
  runtimeSurface: "desktop_local_host" | "remote_workspace_host";
  hasCustomCommandResolver: boolean;
}): boolean {
  // 自定义命令/相对 DB/远端 Host 一律走 false 分支（逐项目查询 key），见 CONTRACT.md。
  return resolveShareLocalWorkflowQueryRuntime({
    runtimeSurface: hostEnv.runtimeSurface,
    hasCustomCommandResolver: hostEnv.hasCustomCommandResolver,
    agentServerCommandEnv: process.env.ZCODE_AGENT_SERVER_COMMAND,
    sessionDbPathEnv: process.env.ZCODE_SESSION_DB_PATH,
  });
}
