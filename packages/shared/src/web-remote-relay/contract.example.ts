import {
  buildWebRemoteControlExternalQrUrl,
  parseWebRemoteControlExternalQrParams,
} from "#src/web-remote-relay/contract.js";

export const pairingUrl = buildWebRemoteControlExternalQrUrl({
  baseUrl: "https://relay.example.invalid/remote",
  deviceSid: "device-example",
  passHash: "proof-example",
  timestamp: 1_700_000_000_000,
});
export const pairedDevice = parseWebRemoteControlExternalQrParams(new URL(pairingUrl).searchParams);
