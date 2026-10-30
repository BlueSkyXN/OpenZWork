import { z } from "zod";

// 请求与 WebSocket 消息严格校验 V2，HTTP 响应允许新增字段。
// OpenZWork 保留口径：官方 V1 网页是免登录远控路径（PR#51），用户显式选择时才使用；与上游 V2 账号通道并行保留。
/** 用户显式选择官方 V1 时才使用这些地址。 */
export const OFFICIAL_WEB_REMOTE_CONTROL_V1 = {
  relayWsUrl: "wss://zcode.z.ai/ws",
  remoteUrl: "https://zcode.z.ai/remote/v4",
  /** 3.14.3 会拒收带 inputOrigin 的队列；使用支持该字段的 V1 网页，设备仍报真实版本。 */
  pageVersion: "3.15.2",
} as const;
const unixSeconds = z.number().int().min(0).max(253_402_300_799);
const identifier = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim().length > 0);
const deviceSid = identifier.refine((value) => new TextEncoder().encode(value).length <= 128);
const meta = z.strictObject({
  name: z.string().optional(),
  platform: z.string().optional(),
  version: z.string().optional(),
});
const role = z.enum(["device", "terminal"]);
const pairStatus = z.enum(["waiting", "matched"]);
const errorCode = z.enum(["AUTH_FAILED", "WRONG_PARAM", "KICKED", "INTERNAL", "DEVICE_OFFLINE"]);
const authInit = z.strictObject({
  type: z.literal("auth_init"),
  device_sid: deviceSid,
  meta: meta.optional(),
  client_ts: unixSeconds.optional(),
});

export type WebRemoteControlRelayV2Role = z.infer<typeof role>;
export type WebRemoteControlRelayV2PairStatus = z.infer<typeof pairStatus>;
export type WebRemoteControlRelayV2ErrorCode = z.infer<typeof errorCode>;
export type WebRemoteControlRelayV2Meta = z.infer<typeof meta>;
export type WebRemoteControlRelayV2AuthInit = z.infer<typeof authInit>;

const pairStatusQuery = z.strictObject({
  type: z.literal("pair_status_query"),
  client_ts: unixSeconds.optional(),
});
const outgoingData = z.strictObject({
  type: z.literal("data"),
  payload: z.json(),
  client_ts: unixSeconds.optional(),
});
export const mobilePushRunSchema = z.strictObject({
  workspace_id: identifier,
  session_id: identifier,
  run_id: identifier,
});
export type MobilePushRun = z.infer<typeof mobilePushRunSchema>;
export const mobilePushEventSchema = z.strictObject({
  version: z.literal(1),
  locale: z.enum(["zh-CN", "en-US"]).optional(),
  session_title: z.string().max(512).optional(),
  desktop_platform: z.enum(["windows", "macos", "linux"]).optional(),
  event_id: identifier,
  kind: z.enum(["question", "approval", "plan", "task_completed", "task_failed"]),
  workspace_id: identifier,
  session_id: identifier,
  run_id: identifier,
  interaction_id: identifier.optional(),
  state: z.enum(["open", "resolved"]),
  occurred_at: unixSeconds,
});
export type MobilePushEvent = z.infer<typeof mobilePushEventSchema>;
export type MobilePushStatus = "available" | "unavailable" | "unknown";
const outgoingMessage = z.discriminatedUnion("type", [authInit, pairStatusQuery, outgoingData]);
export type WebRemoteControlRelayV2PairStatusQuery = z.infer<typeof pairStatusQuery>;
export type WebRemoteControlRelayV2OutgoingData = z.infer<typeof outgoingData>;
export type WebRemoteControlRelayV2OutgoingMessage = z.infer<typeof outgoingMessage>;

export function parseWebRemoteControlRelayV2OutgoingMessage(
  value: unknown,
): WebRemoteControlRelayV2OutgoingMessage | null {
  const result = outgoingMessage.safeParse(value);
  return result.success ? result.data : null;
}

const authAck = z.strictObject({
  type: z.literal("auth_ack"),
  device_sid: deviceSid,
  terminal_sid: z.string().optional(),
  pair_status: pairStatus,
  server_ts: unixSeconds.optional(),
});
const pairStatusAck = z.strictObject({
  type: z.literal("pair_status_ack"),
  terminal_sid: z.string().optional(),
  pair_status: pairStatus,
  server_ts: unixSeconds.optional(),
});
const incomingData = z.strictObject({
  type: z.literal("data"),
  payload: z.json(),
  server_ts: unixSeconds.optional(),
});
const relayError = z.strictObject({
  type: z.literal("error"),
  code: errorCode,
  message: z.string().optional(),
  server_ts: unixSeconds.optional(),
});
const incomingMessage = z.discriminatedUnion("type", [
  authAck,
  pairStatusAck,
  incomingData,
  relayError,
]);
export type WebRemoteControlRelayV2AuthAck = z.infer<typeof authAck>;
export type WebRemoteControlRelayV2PairStatusAck = z.infer<typeof pairStatusAck>;
export type WebRemoteControlRelayV2IncomingData = z.infer<typeof incomingData>;
export type WebRemoteControlRelayV2Error = z.infer<typeof relayError>;
export type WebRemoteControlRelayV2IncomingMessage = z.infer<typeof incomingMessage>;

export function parseWebRemoteControlRelayV2IncomingMessage(
  value: unknown,
): WebRemoteControlRelayV2IncomingMessage | null {
  const result = incomingMessage.safeParse(value);
  return result.success ? result.data : null;
}

export const WEB_REMOTE_CONTROL_RELAY_V2_HTTP = {
  register: { method: "POST", path: "/api/v1/remote/device" },
  list: { method: "GET", path: "/api/v1/remote/device" },
  delete: { method: "POST", path: "/api/v1/remote/device/delete" },
  token: { method: "POST", path: "/api/v1/remote/token" },
} as const;

export const webRemoteControlConnectionSettingsSchema = z
  .object({
    mode: z.enum(["direct", "self-hosted", "official"]),
    direct: z
      .object({
        listenHost: z.string().trim().min(1).max(253),
        port: z.number().int().min(0).max(65535),
        publicUrl: z.string().trim().max(2048),
      })
      .strict(),
    relay: z
      .object({
        wsUrl: z.string().trim().max(2048),
        pageUrl: z.string().trim().max(2048),
      })
      .strict(),
  })
  .strict();

export type WebRemoteControlConnectionSettings = z.infer<
  typeof webRemoteControlConnectionSettingsSchema
>;

export const DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS: WebRemoteControlConnectionSettings = {
  mode: "direct",
  direct: { listenHost: "0.0.0.0", port: 0, publicUrl: "" },
  relay: { wsUrl: "", pageUrl: "" },
};

export function validateWebRemoteControlUrl(value: string, kind: "page" | "relay"): string {
  const url = new URL(value);
  const protocols = kind === "page" ? ["http:", "https:"] : ["ws:", "wss:"];
  if (!protocols.includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error(
      kind === "page"
        ? "请输入不含账号、查询参数或片段的 HTTP/HTTPS 页面地址"
        : "请输入不含账号、查询参数或片段的 WS/WSS relay 地址",
    );
  }
  return url.toString();
}

export type WebRemoteControlThemeSeed = "light" | "dark" | "zai-light" | "zai-dark" | "system";

export interface WebRemoteControlRelayDeviceMeta {
  platform: string;
  version: string;
  name: string;
}

export interface WebRemoteControlMobileViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface WebRemoteControlMobileScreenInfo {
  width: number;
  height: number;
}

export interface WebRemoteControlMobileDeviceInfo extends WebRemoteControlRelayDeviceMeta {
  userAgent?: string;
  language?: string;
  languages?: string[];
  browserPlatform?: string;
  viewport?: WebRemoteControlMobileViewportInfo;
  screen?: WebRemoteControlMobileScreenInfo;
  timezone?: string;
  online?: boolean;
  updatedAt: number;
}

export type WebRemoteControlRelayRole = "device" | "terminal";
// Bugfix: zcode-remote-hub 当前只会把配对状态表示为 waiting/matched；
// KICKED、WRONG_PARAM 等是 error code，不是 pair_status。这里收窄共享类型，
// 避免客户端把不存在的 rejected/kicked 配对状态误判成桌面端 WS 需要关闭。
export type WebRemoteControlRelayPairStatus = "waiting" | "matched";
export type WebRemoteControlRelayErrorCode =
  | "AUTH_FAILED"
  | "DEVICE_OFFLINE"
  | "KICKED"
  | "WRONG_PARAM"
  | "INTERNAL";

export interface WebRemoteControlRelayOutgoingBase {
  client_ts?: number;
}

export interface WebRemoteControlRelayIncomingBase {
  server_ts?: number;
}

export interface WebRemoteControlRelayDeviceRegisterInit extends WebRemoteControlRelayOutgoingBase {
  type: "device_register_init";
  device_mid: string;
  pass_hash: string;
  meta: WebRemoteControlRelayDeviceMeta;
}

export interface WebRemoteControlRelayDeviceRegisterAck extends WebRemoteControlRelayIncomingBase {
  type: "device_register_ack";
  device_sid: string;
}

export interface WebRemoteControlRelayAuthInit extends WebRemoteControlRelayOutgoingBase {
  type: "auth_init";
  role: WebRemoteControlRelayRole;
  device_sid: string;
  meta: WebRemoteControlRelayDeviceMeta;
}

export interface WebRemoteControlRelayAuthChallenge extends WebRemoteControlRelayIncomingBase {
  type: "auth_challenge";
  nonce: string;
}

export interface WebRemoteControlRelayAuthResponse extends WebRemoteControlRelayOutgoingBase {
  type: "auth_response";
  device_sid: string;
  proof: string;
}

export interface WebRemoteControlRelayAuthAck extends WebRemoteControlRelayIncomingBase {
  type: "auth_ack";
  device_sid: string;
  terminal_sid?: string;
  pair_status: WebRemoteControlRelayPairStatus;
}

export interface WebRemoteControlRelayPairStatusQuery extends WebRemoteControlRelayOutgoingBase {
  type: "pair_status_query";
  device_sid: string;
}

export interface WebRemoteControlRelayPairStatusAck extends WebRemoteControlRelayIncomingBase {
  type: "pair_status_ack";
  terminal_sid?: string;
  pair_status: WebRemoteControlRelayPairStatus;
}

export interface WebRemoteControlRelayDataMessage<TPayload = unknown>
  extends WebRemoteControlRelayOutgoingBase, WebRemoteControlRelayIncomingBase {
  type: "data";
  payload: TPayload;
}

export interface WebRemoteControlRelayError extends WebRemoteControlRelayIncomingBase {
  type: "error";
  code: WebRemoteControlRelayErrorCode;
  message: string;
}

export interface WebRemoteControlRelayAuthProofVector {
  passHash: string;
  nonce: string;
  role: WebRemoteControlRelayRole;
  deviceSid: string;
  proof: string;
}

export const WEB_REMOTE_CONTROL_RELAY_AUTH_PROOF_VECTORS: WebRemoteControlRelayAuthProofVector[] = [
  {
    passHash: "dGVzdF9oYXNo",
    nonce: "nonce-1",
    role: "device",
    deviceSid: "device-1",
    proof: "XK0m7u-26VS88uk7ISAX5Z_9pjzq8jqyP77N-HkCsPE",
  },
  {
    passHash: "dGVzdF9oYXNo",
    nonce: "nonce-1",
    role: "terminal",
    deviceSid: "device-1",
    proof: "YkqkJy-p-iZK1g1AcoGd0Q83REOggX1EygWkcxW4oLU",
  },
];

export interface WebRemoteControlExternalQrParams {
  deviceSid: string;
  passHash: string;
  timestamp: number;
  deviceMid?: string;
  deviceName?: string;
  appVersion?: string;
  theme?: WebRemoteControlThemeSeed;
  relayWsUrl?: string;
}

export interface BuildWebRemoteControlExternalQrUrlOptions extends WebRemoteControlExternalQrParams {
  baseUrl: string;
}

function readNonEmptySearchParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

export function isWebRemoteControlThemeSeed(value: unknown): value is WebRemoteControlThemeSeed {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zai-light" ||
    value === "zai-dark" ||
    value === "system"
  );
}

export function buildWebRemoteControlExternalQrUrl({
  baseUrl,
  deviceSid,
  passHash,
  timestamp,
  deviceMid,
  deviceName,
  appVersion,
  theme,
  relayWsUrl,
}: BuildWebRemoteControlExternalQrUrlOptions): string {
  const url = new URL(baseUrl);
  if (relayWsUrl) url.searchParams.set("relay", validateWebRemoteControlUrl(relayWsUrl, "relay"));
  url.searchParams.set("sid", deviceSid);
  url.searchParams.set("hash", passHash);
  url.searchParams.set("t", String(timestamp));

  if (deviceMid?.trim()) {
    url.searchParams.set("mid", deviceMid);
  }
  if (deviceName?.trim()) {
    url.searchParams.set("name", deviceName);
  }
  if (appVersion?.trim()) {
    url.searchParams.set("app_version", appVersion);
  }
  void theme;
  // Bugfix: 手机端主题现在固定走本地默认 dark，不再通过二维码 URL 透传 theme。
  // 之前 theme 参数会把桌面端主题耦合到手机首次进入行为，后续维护和排障都更复杂。
  // 这里保留入参仅做向后兼容，避免旧调用点一次性改动过大。

  return url.toString();
}

export function parseWebRemoteControlExternalQrParams(
  params: URLSearchParams,
): WebRemoteControlExternalQrParams | null {
  const deviceSid = readNonEmptySearchParam(params, "sid");
  const passHash = readNonEmptySearchParam(params, "hash");
  const rawTimestamp = readNonEmptySearchParam(params, "t");
  const timestamp = rawTimestamp ? Number(rawTimestamp) : Number.NaN;
  const theme = readNonEmptySearchParam(params, "theme");
  const relayWsUrl = readNonEmptySearchParam(params, "relay");
  try {
    if (relayWsUrl) validateWebRemoteControlUrl(relayWsUrl, "relay");
  } catch {
    return null;
  }

  if (!deviceSid || !passHash || !Number.isFinite(timestamp)) {
    return null;
  }

  return {
    deviceSid,
    passHash,
    timestamp,
    ...(relayWsUrl ? { relayWsUrl } : {}),
    ...(readNonEmptySearchParam(params, "mid")
      ? { deviceMid: readNonEmptySearchParam(params, "mid") }
      : {}),
    ...(readNonEmptySearchParam(params, "name")
      ? { deviceName: readNonEmptySearchParam(params, "name") }
      : {}),
    ...(readNonEmptySearchParam(params, "app_version")
      ? { appVersion: readNonEmptySearchParam(params, "app_version") }
      : {}),
    ...(isWebRemoteControlThemeSeed(theme) ? { theme } : {}),
  };
}
