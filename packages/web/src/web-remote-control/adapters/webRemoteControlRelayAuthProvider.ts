import { hmacSha256Bytes } from "@zcode/shared";
import type { WebRemoteControlRelayRole } from "@zcode/shared";

function base64UrlNoPadding(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function calculateBrowserWebRemoteControlProof(
  passHash: string,
  nonce: string,
  role: WebRemoteControlRelayRole,
  deviceSid: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await hmacSha256Bytes(
    encoder.encode(passHash),
    encoder.encode(`${nonce}|${role}|${deviceSid}`),
  );
  return base64UrlNoPadding(new Uint8Array(signature));
}

export function createBrowserWebRemoteControlRelayAuthProvider() {
  return {
    calculateProof: calculateBrowserWebRemoteControlProof,
  };
}
