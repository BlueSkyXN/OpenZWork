// OpenZWork 保留口径：官方 V1 网页是免登录远控路径（PR#51），用户显式选择时才使用。
// 与上游 V2 账号通道并行保留；独立文件避免 contract.ts 超出架构行数上限。
/** 用户显式选择官方 V1 时才使用这些地址。 */
export const OFFICIAL_WEB_REMOTE_CONTROL_V1 = {
  relayWsUrl: "wss://zcode.z.ai/ws",
  remoteUrl: "https://zcode.z.ai/remote/v4",
  /** 3.14.3 会拒收带 inputOrigin 的队列；使用支持该字段的 V1 网页，设备仍报真实版本。 */
  pageVersion: "3.15.2",
} as const;
