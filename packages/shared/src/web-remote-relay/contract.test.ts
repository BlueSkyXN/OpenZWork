import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildWebRemoteControlExternalQrUrl,
  OFFICIAL_WEB_REMOTE_CONTROL_V1,
  parseWebRemoteControlExternalQrParams,
  WebRemoteControlV2Heartbeat,
  WebRemoteControlV2RetryPolicy,
} from "@zcode/shared/web-remote-relay";

afterEach(() => vi.useRealTimers());
describe("relay public boundary", () => {
  it("keeps HMAC pairing material and the selected official page across the public QR contract", () => {
    const pairing = {
      deviceSid: "device-1",
      passHash: "hash+value/with=padding",
      timestamp: 1700000000000,
      appVersion: OFFICIAL_WEB_REMOTE_CONTROL_V1.pageVersion,
    };
    const url = new URL(
      buildWebRemoteControlExternalQrUrl({
        baseUrl: OFFICIAL_WEB_REMOTE_CONTROL_V1.remoteUrl,
        ...pairing,
      }),
    );
    expect(url.origin).toBe("https://zcode.z.ai");
    expect(url.pathname).toBe("/remote/v4");
    expect(parseWebRemoteControlExternalQrParams(url.searchParams)).toEqual({
      ...pairing,
      appVersion: "3.15.2",
    });
    url.searchParams.delete("hash");
    expect(parseWebRemoteControlExternalQrParams(url.searchParams)).toBeNull();
  });
  it("keeps replacement history after handshake acknowledgement", () => {
    const retry = new WebRemoteControlV2RetryPolicy(() => 0);
    expect(retry.kickedDelay(1000)).toBe(2000);
    retry.acknowledged();
    expect(retry.kickedDelay(2000)).toBeNull();
  });
  it("cancels heartbeat and deadline when its transport is disposed", () => {
    vi.useFakeTimers();
    const query = vi.fn();
    const expired = vi.fn();
    const heartbeat = new WebRemoteControlV2Heartbeat(query, expired, {
      intervalMs: 10,
      jitterMs: 0,
      ackTimeoutMs: 30,
    });
    heartbeat.acknowledged();
    vi.advanceTimersByTime(10);
    expect(query).toHaveBeenCalledOnce();
    heartbeat.stop();
    vi.advanceTimersByTime(100);
    expect(query).toHaveBeenCalledOnce();
    expect(expired).not.toHaveBeenCalled();
  });
});
