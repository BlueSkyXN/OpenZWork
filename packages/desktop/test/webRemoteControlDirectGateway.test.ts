import { WebRemoteControlDeviceTransport } from "../src/main/webRemoteControlTransport.js";
import { createNodeWebRemoteControlRelayAuthProvider } from "../src/main/web-remote-relay/index.js";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWebRemoteControlDirectGateway,
  createWebRemoteControlConnectionProvider,
  createScopedWebRemoteControlAuthStorage,
} from "../src/main/web-remote-relay/index.js";
import { DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS, type AppSettings } from "@zcode/shared";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function staticRoot() {
  const root = await mkdtemp(join(tmpdir(), "openzwork-v1-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<title>Remote fixture</title>");
  return root;
}
const auth = { deviceSid: "synthetic-device", passHash: "synthetic-pass-hash" };
async function gateway() {
  const controller = new AbortController();
  const server = await createWebRemoteControlDirectGateway({
    listenHost: "127.0.0.1",
    port: 0,
    staticRoot: await staticRoot(),
    signal: controller.signal,
    auth,
  });
  cleanup.push(server.dispose);
  return {
    ...server,
    controller,
    origin: `http://127.0.0.1:${server.port}`,
    url: `ws://127.0.0.1:${server.port}/ws`,
  };
}
async function client(url: string) {
  const socket = new WebSocket(`${url}?mid=synthetic-device-mid`);
  const messages: Array<Record<string, unknown>> = [];
  socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  cleanup.push(() => socket.terminate());
  await once(socket, "open");
  return {
    socket,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    async next(type: string) {
      await vi.waitFor(() => expect(messages.some((message) => message.type === type)).toBe(true));
      return messages.splice(
        messages.findIndex((message) => message.type === type),
        1,
      )[0]!;
    },
  };
}
async function authenticate(
  peer: Awaited<ReturnType<typeof client>>,
  role: "device" | "terminal",
  proof?: string,
) {
  peer.send({ type: "auth_init", role, device_sid: auth.deviceSid });
  const challenge = await peer.next("auth_challenge");
  peer.send({
    type: "auth_response",
    device_sid: auth.deviceSid,
    proof:
      proof ??
      createHmac("sha256", auth.passHash)
        .update(`${challenge.nonce}|${role}|${auth.deviceSid}`)
        .digest("base64url"),
  });
  return peer.next(proof ? "error" : "auth_ack");
}

describe("direct V1 gateway", () => {
  it("拒绝无法解析的 Upgrade 地址后仍可提供页面", async () => {
    const server = await gateway();
    const socket = createConnection(server.port, "127.0.0.1");
    cleanup.push(() => socket.destroy());
    await once(socket, "connect");
    const closed = once(socket, "close");
    socket.write(
      `GET http://% HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`,
    );
    await closed;
    expect((await fetch(`${server.origin}/remote/`)).status).toBe(200);
  });
  it("pairs the real desktop transport including its mid query and HMAC provider", async () => {
    const server = await gateway();
    const onStateChange = vi.fn();
    const onPayload = vi.fn();
    const transport = new WebRemoteControlDeviceTransport({
      relayWsUrl: server.url,
      deviceMid: "synthetic-mid",
      auth: { mode: "persisted", ...auth },
      meta: { platform: "test", version: "3.16.1", name: "synthetic" },
      authProvider: createNodeWebRemoteControlRelayAuthProvider(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      onRegisteredAuth: vi.fn(),
      onInvalidPersistedAuth: async () => {},
      onStateChange,
      onPayload,
      onError: vi.fn(),
    });
    cleanup.push(() => transport.dispose());
    transport.start();
    await vi.waitFor(() => expect(onStateChange).toHaveBeenCalledWith("waiting_terminal"));
    const terminal = await client(server.url);
    await authenticate(terminal, "terminal");
    await vi.waitFor(() => expect(onStateChange).toHaveBeenCalledWith("paired"));
    terminal.send({
      type: "data",
      payload: { zcode_type: "bootstrap-request", requestId: "synthetic-request" },
    });
    await vi.waitFor(() =>
      expect(onPayload).toHaveBeenCalledWith(
        expect.objectContaining({ zcode_type: "bootstrap-request" }),
      ),
    );
  });
  it("serves only phone assets, pairs both roles and forwards both directions", async () => {
    const server = await gateway();
    expect(await (await fetch(`${server.origin}/remote/`)).text()).toContain("Remote fixture");
    expect((await fetch(`${server.origin}/remote/%2e%2e/secret`)).status).toBe(404);
    expect((await fetch(`${server.origin}/`, { redirect: "manual" })).headers.get("location")).toBe(
      "/remote/",
    );
    const device = await client(server.url);
    expect(await authenticate(device, "device")).toMatchObject({ pair_status: "waiting" });
    const terminal = await client(server.url);
    expect(await authenticate(terminal, "terminal")).toMatchObject({ pair_status: "matched" });
    terminal.send({ type: "data", payload: { request: "synthetic" } });
    expect(await device.next("data")).toMatchObject({ payload: { request: "synthetic" } });
    device.send({ type: "data", payload: { response: "synthetic" } });
    expect(await terminal.next("data")).toMatchObject({ payload: { response: "synthetic" } });
    server.controller.abort();
    await server.dispose();
    await expect(fetch(`${server.origin}/remote/`)).rejects.toThrow();
  });
  it.each(["wrong-proof", "register", "unauthenticated-data", "replayed-proof"])(
    "rejects %s",
    async (scenario) => {
      const server = await gateway();
      const peer = await client(server.url);
      const closed = once(peer.socket, "close");
      if (scenario === "wrong-proof")
        expect(await authenticate(peer, "terminal", "invalid")).toMatchObject({
          code: "AUTH_FAILED",
        });
      else if (scenario === "replayed-proof") {
        await authenticate(peer, "terminal");
        peer.send({ type: "auth_response", device_sid: auth.deviceSid, proof: "unused" });
      } else
        peer.send(
          scenario === "register"
            ? { type: "device_register_init", pass_hash: "new" }
            : { type: "data", payload: "unauthorized" },
        );
      expect((await closed)[0]).toBe(1008);
    },
  );
  it("a replaced terminal cannot forward payloads to the current device", async () => {
    const server = await gateway();
    const device = await client(server.url);
    await authenticate(device, "device");
    const previous = await client(server.url);
    await authenticate(previous, "terminal");
    const closed = once(previous.socket, "close");
    const current = await client(server.url);
    await authenticate(current, "terminal");
    await closed;
    current.send({ type: "data", payload: "current" });
    expect(await device.next("data")).toMatchObject({ payload: "current" });
  });
});

describe("connection configuration and credential ownership", () => {
  function credentials() {
    const values = new Map<string, string>();
    return {
      values,
      service: {
        load: vi.fn(async (key: string) => values.get(key)),
        save: vi.fn(async (key: string, value: string) => {
          values.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          values.delete(key);
        }),
      },
    };
  }
  it("isolates credentials by normalized endpoint and window, without touching legacy", async () => {
    const { service, values } = credentials();
    values.set("web-remote-control:external-relay:pass_hash", "legacy");
    const a = createScopedWebRemoteControlAuthStorage(service, "wss://a.example/ws\nwindow:1");
    await a.save(auth);
    for (const scope of ["wss://b.example/ws\nwindow:1", "wss://a.example/ws\nwindow:2"])
      expect(await createScopedWebRemoteControlAuthStorage(service, scope).load()).toBeUndefined();
    expect(await a.load()).toEqual(auth);
    expect(values.get("web-remote-control:external-relay:pass_hash")).toBe("legacy");
  });
  it("loads env defaults, honors explicit official selection and commits only on success", async () => {
    const { service } = credentials();
    let settings: AppSettings = { recentProjects: [], locale: "zh-CN" };
    const patchSettings = vi.fn(async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch };
    });
    const provider = createWebRemoteControlConnectionProvider({
      credentialService: service,
      loadSettings: async () => settings,
      patchSettings,
      staticRoot: "unused",
      relayWsEnv: "wss://self.example/ws",
      pageUrlEnv: "https://self.example/remote/",
    });
    expect((await provider.getSettings()).mode).toBe("self-hosted");
    const connection = await provider.prepare(
      1,
      { ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS, mode: "official" },
      new AbortController().signal,
    );
    expect(connection.relayWsUrl).toBe("wss://zcode.z.ai/ws");
    expect(patchSettings).not.toHaveBeenCalled();
    await connection.commit();
    expect((await provider.getSettings()).mode).toBe("official");
  });
  it("keeps direct windows independent and abort closes only its own listener", async () => {
    const { service } = credentials();
    const provider = createWebRemoteControlConnectionProvider({
      credentialService: service,
      loadSettings: async () => ({ recentProjects: [], locale: "zh-CN" }),
      patchSettings: async () => {},
      staticRoot: await staticRoot(),
    });
    const settings = {
      ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
      direct: { listenHost: "127.0.0.1", port: 0, publicUrl: "" },
    };
    const controller = new AbortController();
    const a = await provider.prepare(1, settings, controller.signal);
    cleanup.push(a.dispose);
    const b = await provider.prepare(2, settings, new AbortController().signal);
    cleanup.push(b.dispose);
    expect((await a.authStorageProvider.load())?.deviceSid).not.toBe(
      (await b.authStorageProvider.load())?.deviceSid,
    );
    controller.abort();
    await a.dispose();
    await expect(fetch(a.mobileRemoteControlUrl)).rejects.toThrow();
    expect((await fetch(b.mobileRemoteControlUrl)).status).toBe(200);
    expect(service.save).not.toHaveBeenCalled();
  });
});
