/**
 * session-external-import 公开入口（managed module publicEntrypoint）。
 * 调方只从本文件导入；实现细节（repo/parser/service）不对外暴露。
 */
export {
  externalSessionImportRepo,
  relativeSourcePathForProvider,
} from "#src/session/external-import/externalSessionImportRepo.js";
export { importExternalSessions } from "#src/session/external-import/externalSessionImportService.js";
export { migrationSourceForProvider } from "#src/session/external-import/externalImportSource.js";
export type {
  ExternalSessionScanParams,
  ExternalSessionImportParams,
  ExternalSessionCreateParams,
  ExternalSessionImportContract,
} from "#src/session/external-import/contract.js";
export type { ExternalImportedSessionSource } from "#src/session/external-import/externalImportedSessionTypes.js";
