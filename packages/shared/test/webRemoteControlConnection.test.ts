import { describe, expect, it } from "vitest";
import {
  buildWebRemoteControlExternalQrUrl,
  parseWebRemoteControlExternalQrParams,
  webRemoteControlConnectionSettingsSchema,
  webRemoteControlConnectionProfilesSchema,
  resolveWebRemoteControlBrowserRelayUrl,
  DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
  appSettingsSchema,
  getWebRemoteControlProfileId,
  normalizeWebRemoteControlConnectionProfile,
} from "../src/index.js";

describe("V1 connection settings and QR", () => {
  it("defaults to direct and rejects invalid listen ports", () => {
    expect(
      webRemoteControlConnectionSettingsSchema.parse(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS)
        .mode,
    ).toBe("direct");
    expect(
      webRemoteControlConnectionSettingsSchema.safeParse({
        ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
        direct: { listenHost: "0.0.0.0", port: -1, publicUrl: "" },
      }).success,
    ).toBe(false);
  });
  it("round trips an explicit relay while retaining old origin fallback", () => {
    const url = buildWebRemoteControlExternalQrUrl({
      baseUrl: "https://phone.example/remote/",
      deviceSid: "device",
      passHash: "test-hash",
      timestamp: 1,
      relayWsUrl: "wss://relay.example/ws",
    });
    const params = parseWebRemoteControlExternalQrParams(new URL(url).searchParams)!;
    expect(params.relayWsUrl).toBe("wss://relay.example/ws");
    expect(resolveWebRemoteControlBrowserRelayUrl("https://phone.example", params.relayWsUrl)).toBe(
      "wss://relay.example/ws",
    );
    expect(resolveWebRemoteControlBrowserRelayUrl("http://phone.example")).toBe(
      "ws://phone.example/ws",
    );
  });
  it("normalizes and validates a non-empty unique profile list", () => {
    const lan = normalizeWebRemoteControlConnectionProfile({
      ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
      name: " 局域网 ",
    });
    const relay = {
      ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
      profileId: "vpn-relay",
      mode: "self-hosted" as const,
    };

    expect(getWebRemoteControlProfileId(lan)).toBe("default");
    expect(lan.name).toBe("局域网");
    expect(webRemoteControlConnectionProfilesSchema.parse([lan, relay])).toHaveLength(2);
    expect(
      appSettingsSchema.parse({
        recentProjects: [],
        locale: "zh-CN",
        webRemoteControlConnections: [lan, relay],
      }).webRemoteControlConnections,
    ).toHaveLength(2);
    expect(
      webRemoteControlConnectionProfilesSchema.safeParse([
        { ...lan, profileId: "vpn-relay" },
        relay,
      ]).success,
    ).toBe(false);
    expect(webRemoteControlConnectionProfilesSchema.safeParse([]).success).toBe(false);
  });
  it("rejects invalid QR relay schemes and mixed content", () => {
    expect(
      parseWebRemoteControlExternalQrParams(
        new URLSearchParams("sid=x&hash=y&t=1&relay=javascript:bad"),
      ),
    ).toBeNull();
    expect(() =>
      resolveWebRemoteControlBrowserRelayUrl("https://phone.example", "ws://relay.example/ws"),
    ).toThrow();
    expect(() =>
      resolveWebRemoteControlBrowserRelayUrl(
        "https://phone.example",
        "wss://user:pass@relay.example/ws",
      ),
    ).toThrow();
  });
});
