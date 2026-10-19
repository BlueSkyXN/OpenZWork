import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildWebRemoteControlExternalQrUrl,
  parseWebRemoteControlExternalQrParams,
  WebRemoteControlV2Heartbeat,
  WebRemoteControlV2RetryPolicy,
} from "@zcode/shared/web-remote-relay";

afterEach(() => vi.useRealTimers());
describe("relay public boundary", () => {
  it("keeps HMAC pairing material across the public QR contract", () => {
    const pairing = {
      deviceSid: "device-1",
      passHash: "hash+value/with=padding",
      timestamp: 1700000000000,
    };
    const url = new URL(
      buildWebRemoteControlExternalQrUrl({
        baseUrl: "https://relay.example.invalid/remote",
        ...pairing,
      }),
    );
    expect(parseWebRemoteControlExternalQrParams(url.searchParams)).toEqual(pairing);
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
