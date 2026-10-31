import { z } from "zod";

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
