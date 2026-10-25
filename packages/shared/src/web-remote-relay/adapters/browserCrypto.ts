import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";

/** 局域网 HTTP 没有 subtle；使用相同算法，保持配对 proof 和附件 checksum 字节一致。 */
export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (globalThis.crypto?.subtle)
    return new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
    );
  return sha256(bytes);
}

export async function hmacSha256Bytes(
  keyBytes: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) return hmac(sha256, keyBytes, message);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyBytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, Uint8Array.from(message).buffer),
  );
}
