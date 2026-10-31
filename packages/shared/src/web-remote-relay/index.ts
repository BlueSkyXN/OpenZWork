// 新源码原来散落在 legacy 根目录，CI 无法确认归属；公开入口统一收口到受管模块。
export * from "#src/web-remote-relay/contract.js";
export * from "#src/web-remote-relay/domain/retry.js";
export * from "#src/web-remote-relay/domain/heartbeatTiming.js";
export * from "#src/web-remote-relay/domain/webRemoteControlActions.js";
// 手机日志通道（mobile-log / mobile-log-pull）报文 schema 与上限。
export * from "#src/web-remote-relay/mobileLog.js";
export { WebRemoteControlV2Heartbeat } from "#src/web-remote-relay/adapters/heartbeat.js";

// OpenZWork：browserCrypto 与 connection domain（我方远控/bots 保留域，自建 relay 场景消费）
// 与上游 mobile push 通知 domain 一并保留导出。
export { sha256Bytes, hmacSha256Bytes } from "./adapters/browserCrypto.js";

export * from "./domain/connection.js";
// OpenZWork 拆分：连接设置域从 contract.ts 拆出（行数上限），导出面不变。
export * from "./domain/connectionSettings.js";
export { OFFICIAL_WEB_REMOTE_CONTROL_V1 } from "./v1Endpoint.js";
export {
  collectMobilePushEvents,
  type MobilePushObservation,
} from "#src/web-remote-relay/domain/notification.js";
