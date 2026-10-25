import { createHash, createHmac, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { sha256Bytes, hmacSha256Bytes } from "../src/web-remote-relay/index.js";
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("matches SHA256 and HMAC with subtle=%s", async (secure) => {
  vi.stubGlobal(
    "crypto",
    secure ? webcrypto : { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
  );
  const bytes = new TextEncoder().encode("远控 V1 test\u0000");
  const key = new TextEncoder().encode("synthetic-key");
  expect(Buffer.from(await sha256Bytes(bytes)).toString("hex")).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(Buffer.from(await hmacSha256Bytes(key, bytes)).toString("hex")).toBe(
    createHmac("sha256", key).update(bytes).digest("hex"),
  );
});
