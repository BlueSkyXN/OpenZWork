import { z } from "zod";

/** 用户显式选择官方 V1 时才使用这些地址。 */
export const OFFICIAL_WEB_REMOTE_CONTROL_V1 = {
  relayWsUrl: "wss://zcode.z.ai/ws",
  remoteUrl: "https://zcode.z.ai/remote/v4",
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
