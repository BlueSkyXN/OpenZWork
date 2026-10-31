import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWebRemoteControlSessionEventsFixture } from "./e2e/helpers/web-remote-control-session-events-fixture.js";
import { once } from "node:events";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type {
  WebRemoteControlRelayIncomingMessage,
  WebRemoteControlRelayRole,
} from "@zcode/shared";
import { createNodeWebRemoteControlRelayAuthProvider } from "../src/main/web-remote-relay/index.js";
import { createLocalPairingRelay } from "./e2e/helpers/local-pairing-relay.js";

function waitFor(socket: WebSocket, type: string) {
  return new Promise<WebRemoteControlRelayIncomingMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Missing ${type}`));
    }, 3_000);
    const listener = (raw: unknown) => {
      const message = JSON.parse(String(raw)) as WebRemoteControlRelayIncomingMessage;
      if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", listener);
    }
    socket.on("message", listener);
  });
}

describe("隔离远控配对 fixture", () => {
  it("手机 Web 入口通过实际 Vite 代理连接隔离 relay", async () => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const root = await mkdtemp(join(tmpdir(), "relay-web-fixture-"));
    const settingsFile = join(root, "settings.json");
    await writeFile(settingsFile, "{}");
    let close: (() => Promise<void>) | undefined;
    let socket: WebSocket | undefined;
    try {
      close = await prepareWebRemoteControlSessionEventsFixture({
        settingsFile,
        credentialsFile: join(root, "credentials.json"),
        workspacePath: root,
        webUrl: `http://127.0.0.1:${port}/remote/v4`,
      });
      socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await once(socket, "open");
      const response = waitFor(socket, "device_register_ack");
      socket.send(JSON.stringify({ type: "device_register_init", pass_hash: "fixture-pass-hash" }));
      expect(await response).toMatchObject({ type: "device_register_ack" });
    } finally {
      socket?.terminate();
      await close?.();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("拒绝错误证明，通过真实鉴权计算配对后转发，并保留设备重连身份", async () => {
    const relay = await createLocalPairingRelay();
    const sockets: WebSocket[] = [];
    const auth = createNodeWebRemoteControlRelayAuthProvider();
    const passHash = auth.createPassHash("fixture-only-pairing-password");
    const connect = async () => {
      const socket = new WebSocket(relay.wsUrl);
      sockets.push(socket);
      await once(socket, "open");
      return socket;
    };
    const authenticate = async (
      socket: WebSocket,
      deviceSid: string,
      role: WebRemoteControlRelayRole,
      valid = true,
    ) => {
      const challenge = waitFor(socket, "auth_challenge");
      socket.send(JSON.stringify({ type: "auth_init", role, device_sid: deviceSid }));
      const message = await challenge;
      if (message.type !== "auth_challenge") throw new Error("Missing challenge");
      const result = waitFor(socket, valid ? "auth_ack" : "error");
      socket.send(
        JSON.stringify({
          type: "auth_response",
          device_sid: deviceSid,
          proof: valid ? auth.calculateProof(passHash, message.nonce, role, deviceSid) : "wrong",
        }),
      );
      return result;
    };
    try {
      const desktop = await connect();
      const registered = waitFor(desktop, "device_register_ack");
      desktop.send(JSON.stringify({ type: "device_register_init", pass_hash: passHash }));
      const registration = await registered;
      if (registration.type !== "device_register_ack") throw new Error("Missing registration");
      const deviceSid = registration.device_sid;
      expect(await authenticate(desktop, deviceSid, "device")).toMatchObject({
        pair_status: "waiting",
      });
      const mobile = await connect();
      expect(await authenticate(mobile, deviceSid, "terminal", false)).toMatchObject({
        code: "AUTH_FAILED",
      });
      const unauthorized = waitFor(mobile, "error");
      mobile.send(JSON.stringify({ type: "data", payload: { rejected: true } }));
      expect(await unauthorized).toMatchObject({ code: "AUTH_FAILED" });
      expect(await authenticate(mobile, deviceSid, "terminal")).toMatchObject({
        pair_status: "matched",
      });
      const received = waitFor(desktop, "data");
      mobile.send(JSON.stringify({ type: "data", payload: { retained: "workspace" } }));
      expect(await received).toMatchObject({ payload: { retained: "workspace" } });
      const closed = once(desktop, "close");
      desktop.close();
      await closed;
      expect(await authenticate(await connect(), deviceSid, "device")).toMatchObject({
        device_sid: deviceSid,
        pair_status: "matched",
      });
    } finally {
      for (const socket of sockets) socket.terminate();
      await relay.close();
    }
  });
});
