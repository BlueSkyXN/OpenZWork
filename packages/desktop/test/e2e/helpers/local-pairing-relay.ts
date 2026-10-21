import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type {
  WebRemoteControlRelayIncomingMessage,
  WebRemoteControlRelayOutgoingMessage,
  WebRemoteControlRelayRole,
} from "@zcode/shared";

interface Peer {
  socket: WebSocket;
  role: WebRemoteControlRelayRole;
  deviceSid: string;
  nonce: string;
  authenticated: boolean;
}

/** 当前无账号 relay 的隔离 fixture；仅转发通过挑战应答的已配对设备消息。 */
export async function createLocalPairingRelay() {
  const devices = new Map<string, string>();
  const peers = new Set<Peer>();
  const server = createServer((_request, response) => response.writeHead(404).end());
  const sockets = new WebSocketServer({ server, path: "/ws" });
  const send = (socket: WebSocket, message: WebRemoteControlRelayIncomingMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const partner = (peer: Peer) =>
    [...peers].find(
      (candidate) =>
        candidate !== peer &&
        candidate.authenticated &&
        candidate.deviceSid === peer.deviceSid &&
        candidate.role !== peer.role,
    );
  const notifyPair = (peer: Peer) => {
    const other = partner(peer);
    const message = {
      type: "pair_status_ack",
      pair_status: other ? "matched" : "waiting",
    } as const;
    send(peer.socket, message);
    if (other) send(other.socket, message);
  };
  sockets.on("connection", (socket) => {
    let peer: Peer | undefined;
    const reject = () =>
      send(socket, { type: "error", code: "AUTH_FAILED", message: "Invalid pairing proof" });
    socket.on("message", (raw) => {
      let message: WebRemoteControlRelayOutgoingMessage;
      try {
        message = JSON.parse(String(raw));
        if (!message || typeof message !== "object") return;
      } catch {
        return;
      }
      if (message.type === "device_register_init") {
        if (typeof message.pass_hash !== "string" || !message.pass_hash) return reject();
        const deviceSid = randomUUID();
        devices.set(deviceSid, message.pass_hash);
        send(socket, { type: "device_register_ack", device_sid: deviceSid });
      } else if (message.type === "auth_init") {
        if (!devices.has(message.device_sid) || !["device", "terminal"].includes(message.role))
          return reject();
        if (peer) peers.delete(peer);
        peer = {
          socket,
          role: message.role,
          deviceSid: message.device_sid,
          nonce: randomUUID(),
          authenticated: false,
        };
        peers.add(peer);
        send(socket, { type: "auth_challenge", nonce: peer.nonce });
      } else if (message.type === "auth_response") {
        // 单次 nonce 绑定设备和角色；错误 proof 不得得到配对资格或转发数据。
        if (!peer || peer.authenticated || message.device_sid !== peer.deviceSid) return reject();
        const expected = createHmac("sha256", devices.get(peer.deviceSid)!)
          .update(`${peer.nonce}|${peer.role}|${peer.deviceSid}`)
          .digest("base64url");
        if (message.proof !== expected) return reject();
        for (const previous of peers) {
          if (
            previous !== peer &&
            previous.authenticated &&
            previous.deviceSid === peer.deviceSid &&
            previous.role === peer.role
          ) {
            previous.authenticated = false;
            previous.socket.close();
          }
        }
        peer.authenticated = true;
        send(socket, {
          type: "auth_ack",
          device_sid: peer.deviceSid,
          pair_status: partner(peer) ? "matched" : "waiting",
        });
        notifyPair(peer);
      } else if (!peer?.authenticated) {
        reject();
      } else if (message.type === "pair_status_query") {
        notifyPair(peer);
      } else if (message.type === "data") {
        const other = partner(peer);
        if (other) send(other.socket, { type: "data", payload: message.payload });
      }
    });
    socket.on("close", () => {
      if (!peer) return;
      const other = partner(peer);
      peers.delete(peer);
      if (other) notifyPair(other);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Pairing relay did not listen");
  const httpUrl = `http://127.0.0.1:${address.port}`;
  return {
    httpUrl,
    wsUrl: `${httpUrl.replace("http:", "ws:")}/ws`,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
