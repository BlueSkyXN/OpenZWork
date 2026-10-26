import {
  buildWebRemoteControlExternalQrUrl,
  OFFICIAL_WEB_REMOTE_CONTROL_V1,
  parseWebRemoteControlExternalQrParams,
} from "#src/web-remote-relay/contract.js";

export const pairingUrl = buildWebRemoteControlExternalQrUrl({
  baseUrl: OFFICIAL_WEB_REMOTE_CONTROL_V1.remoteUrl,
  appVersion: OFFICIAL_WEB_REMOTE_CONTROL_V1.pageVersion,
  deviceSid: "device-example",
  passHash: "proof-example",
  timestamp: 1_700_000_000_000,
});
export const pairedDevice = parseWebRemoteControlExternalQrParams(new URL(pairingUrl).searchParams);
