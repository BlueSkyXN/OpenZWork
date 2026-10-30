/** Desktop IPC 与远端 Host 复用同一 MCP 文件 owner，避免两套项目路径规则分叉。 */
import { createMcpSyncService } from "@zcode/services/node";
import type {
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";

export type { McpConfigKeyName, OpenCodeMcpServerConfig, McpSourceDescriptor } from "./types.js";
export { MCP_SOURCE_DESCRIPTORS, getSourceDescriptor } from "./types.js";
export { migrateLegacyCommonMcp } from "./legacy.js";

const directoryService = createMcpSyncService();
export async function loadCliMcpFromUserDirectory(
  request?: LoadCliMcpFromUserDirectoryRequest,
): Promise<LoadCliMcpFromUserDirectoryResult> {
  return directoryService.loadMcpFromUserDirectory(request);}

export async function saveCliMcpToUserDirectory(
  payload: SaveCliMcpToUserDirectoryRequest,
): Promise<void> {
  // fork 保留：MCP 文件 owner 委托 services 层 createMcpSyncService（含 data-sync 域导入导出），
  // 上游在本文件内联目录读写实现（b36db2f6 已把该实现收敛进 services 层），不回退。
  await directoryService.saveMcpToUserDirectory(payload);}
