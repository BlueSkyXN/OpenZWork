/**
 * Node-only shared utilities.
 *
 * This subpath must not be imported by renderer/browser bundles.
 */
export { acquireFileLock } from "./node/atomicFileLock.js";
export { isUserHomeDirectory } from "./node/userHomeBoundary.js";
// OpenZWork 净化口径修订：desktop 主链的网络诊断面板（main handler/UI 面板）已删，
// 但 zcode-cli adapters 的 MCP fetch 仍需 withoutNetworkCapture 在 capture 上下文外执行
// （无 capture 激活时是纯 passthrough，无官方域行为）。恢复该 re-export，createNodeNetworkCapture
// 仍不导出——desktop 侧无消费者，官方网络诊断域维持删除。
export { createNodeNetworkCapture, withoutNetworkCapture } from "./node/networkCapture.js";
export {
  GEN_UI_OUTPUT_ROOT_ENV,
  GEN_UI_OUTPUT_DIRECTORY,
  getGenUiOutputDirectory,
} from "./node/genUiPaths.js";
export { scanOfficialPluginCacheRoots } from "./node/officialPluginCache.js";
export {
  migrateUserSubagentMarkdown,
  migrateSubagentStateFile,
} from "./node/subagentMarkdownMigration.js";
export {
  atomicWritePrivateTextFile,
  backupCorruptFile,
  withFileLock,
  type SharedFileLockOptions,
} from "./node/privateFilePersistence.js";
export {
  getMemoryMigrationMarkerPath,
  memoryMigrationMarkerSchema,
  migrateLegacyProjectMemories,
  type MemoryMigrationLogger,
  type MemoryMigrationMarker,
  type MemoryMigrationResult,
} from "./node/memoryMigration.js";
export {
  createNodeSelfResourceSampler,
  NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  type NodeSelfResourceSampler,
  type NodeSelfResourceSamplerOptions,
} from "./node/nodeSelfResourceTelemetry.js";
