// fork 净化：远控保留。本地 HMAC/directGateway 变体（contract/adapters）保持我方导出；
// 上游新增的手机日志通道（mobileLogSink/mobileLogPull/mobileLogPullExport）与
// 手机侧动作请求（actionRequests/rendererAction）为远控中性功能，随上游采用；
// 官方 V2 账号通道导出（webRemoteControlV2Http、webRemoteControlDeviceStorage、
// webRemoteControlTransport、mobilePushConnection）属官方 http/token 域，全部剥离。
export type * from "./contract.js";
export { createNodeWebRemoteControlRelayAuthProvider } from "./adapters/authProvider.js";
export {
  createWebRemoteControlRelayAuthStorageProvider,
  WEB_REMOTE_CONTROL_EXTERNAL_RELAY_PASS_HASH_CREDENTIAL_KEY,
} from "./adapters/authStorage.js";
export { createWebRemoteControlDirectGateway } from "./adapters/directGateway.js";
export {
  createWebRemoteControlConnectionProvider,
  createScopedWebRemoteControlAuthStorage,
} from "./adapters/connectionProvider.js";
export {
  respondToWebRemoteControlActionRequest,
  type RunWebRemoteControlRendererAction,
  type WebRemoteControlActionRequestPayload,
} from "./webRemoteControlActionRequests.js";
export { runWebRemoteControlActionInRenderer } from "./webRemoteControlRendererAction.js";
export {
  createMobileLogSink,
  MOBILE_LOG_SINK_DEFAULTS,
  sanitizeMobileLogPathSegment,
  serializeMobileLogEntry,
  type MobileLogSink,
  type MobileLogSinkTarget,
} from "./mobileLogSink.js";
export {
  createMobileLogPullCoordinator,
  decodeCompressedMobileLogShard,
  MobileLogPullError,
  type MobileLogPullErrorCode,
  type MobileLogPullQuery,
  type MobileLogPullShard,
  type MobileLogPullSummary,
} from "./mobileLogPull.js";
export {
  MOBILE_LOG_PULL_DEFAULT_WINDOW_MS,
  pullAndExportMobileLogs,
  type MobileLogPullExportDependencies,
} from "./mobileLogPullExport.js";
