// OpenZWork 拆分：QR 配对域在 domain/connectionSettings，V1 入口常量在 v1Endpoint。
import {
  buildWebRemoteControlExternalQrUrl,
  parseWebRemoteControlExternalQrParams,
} from "#src/web-remote-relay/index.js";
import { OFFICIAL_WEB_REMOTE_CONTROL_V1 } from "#src/web-remote-relay/v1Endpoint.js";

export const pairingUrl = buildWebRemoteControlExternalQrUrl({
  baseUrl: OFFICIAL_WEB_REMOTE_CONTROL_V1.remoteUrl,
  appVersion: OFFICIAL_WEB_REMOTE_CONTROL_V1.pageVersion,
  deviceSid: "device-example",
  passHash: "proof-example",
  timestamp: 1_700_000_000_000,
});
export const pairedDevice = parseWebRemoteControlExternalQrParams(new URL(pairingUrl).searchParams);
