import { describe, expect, it, vi } from "vitest";
import { WEB_REMOTE_CONTROL_RELAY_AUTH_PROOF_VECTORS } from "@zcode/shared";
import {
  createNodeWebRemoteControlRelayAuthProvider,
  createWebRemoteControlRelayAuthStorageProvider,
} from "./index.js";

describe("HMAC relay public adapters", () => {
  it("generates the protocol proof vectors for both relay roles", () => {
    const provider = createNodeWebRemoteControlRelayAuthProvider();
    for (const vector of WEB_REMOTE_CONTROL_RELAY_AUTH_PROOF_VECTORS) {
      expect(
        provider.calculateProof(vector.passHash, vector.nonce, vector.role, vector.deviceSid),
      ).toBe(vector.proof);
    }
  });
  it("clears a partial persisted identity before reuse", async () => {
    const patchSettings = vi.fn(async () => {});
    const deleteCredential = vi.fn(async () => {});
    const storage = createWebRemoteControlRelayAuthStorageProvider({
      loadSettings: async () => ({
        recentProjects: [],
        locale: "zh-CN",
        webRemoteControlExternalRelayDevice: { deviceSid: "device-1" },
      }),
      patchSettings,
      credentialService: {
        load: async () => null,
        save: async () => {},
        delete: deleteCredential,
      },
    });
    expect(await storage.load()).toBeUndefined();
    expect(patchSettings).toHaveBeenCalledWith({ webRemoteControlExternalRelayDevice: undefined });
    expect(deleteCredential).toHaveBeenCalledOnce();
  });
});
