/**
 * session-external-import 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 真实调用方见 packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts
 * 的 scanImportableExternalSessions / importExternalSessions。
 */
import type {
  ExternalSessionImportContract,
  ExternalSessionImportParams,
  ExternalSessionScanParams,
} from "./contract.js";

export async function exampleScanExternalSessions(
  contract: ExternalSessionImportContract,
  params: ExternalSessionScanParams,
) {
  // 扫描只读外部目录；按当前 workspace 过滤出候选。
  return await contract.scanImportableSessions(params);
}

export async function exampleImportExternalSessions(
  contract: ExternalSessionImportContract,
  params: ExternalSessionImportParams,
) {
  // 导入由调用方提供 createImportedSession（建真实会话 + 写任务索引）；
  // 同来源哈希未变时重导幂等跳过。
  return await contract.importSessions(params);
}
