import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS } from "@zcode/shared";
import type { WebRemoteControlDirectGatewayOptions } from "../contract.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".md": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};
interface Peer {
  socket: WebSocket;
  role?: "device" | "terminal";
  nonce?: string;
  authenticated: boolean;
}

/** 单窗口 V1 网关只接受预置配对，不持有 workspace 或任务状态。 */
export async function createWebRemoteControlDirectGateway(
  options: WebRemoteControlDirectGatewayOptions,
) {
  const root = resolve(options.staticRoot);
  await access(resolve(root, "index.html"));
  options.signal.throwIfAborted();
  const localAddresses = new Set([
    "127.0.0.1",
    "::1",
    ...Object.values(networkInterfaces()).flatMap(
      (entries) => entries?.map((entry) => entry.address) ?? [],
    ),
  ]);
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (pathname === "/") {
        response.writeHead(302, { Location: "/remote/" }).end();
        return;
      }
      const relative =
        pathname === "/remote" || pathname === "/remote/"
          ? "index.html"
          : pathname.startsWith("/remote/")
            ? pathname.slice(8)
            : "";
      const file = resolve(root, relative);
      if (
        !relative ||
        !file.startsWith(root + sep) ||
        relative.includes("\\") ||
        relative.split("/").some((part) => part.startsWith(".")) ||
        !CONTENT_TYPES[extname(file)]
      ) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readFile(file);
      response.setHeader("Content-Type", CONTENT_TYPES[extname(file)]!);
      response.setHeader("Content-Length", bytes.length);
      response.end(request.method === "HEAD" ? undefined : bytes);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    });
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS.maxPhysicalFrameBytes,
    perMessageDeflate: false,
  });
  const peers = new Set<Peer>();
  const send = (socket: WebSocket, message: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > WEB_REMOTE_CONTROL_RPC_TRANSPORT_LIMITS.maxPhysicalFrameBytes * 2) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  };
  const partner = (peer: Peer) =>
    [...peers].find(
      (candidate) => candidate !== peer && candidate.authenticated && candidate.role !== peer.role,
    );
  const notifyPair = (peer: Peer) => {
    const other = partner(peer);
    const message = { type: "pair_status_ack", pair_status: other ? "matched" : "waiting" };
    send(peer.socket, message);
    if (other) send(other.socket, message);
  };
  server.on("upgrade", (request, socket, head) => {
    // V1 客户端会附加 mid 分片参数；只按 pathname 路由，不能把合法握手当未知路径。
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      // 错误的 Upgrade 请求只关闭当前连接，不能让 URL 解析异常退出 Main。
      socket.destroy();
      return;
    }
    if (pathname !== "/ws" || sockets.clients.size >= 16) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws, request));
  });
  sockets.on("connection", (socket, request) => {
    const peer: Peer = { socket, authenticated: false };
    peers.add(peer);
    const deadline = setTimeout(() => socket.terminate(), 15_000);
    const reject = () => {
      send(socket, { type: "error", code: "AUTH_FAILED", message: "Invalid pairing proof" });
      socket.close(1008, "Invalid pairing proof");
    };
    socket.on("error", () => socket.terminate());
    socket.on("message", (raw, isBinary) => {
      const size = Array.isArray(raw)
        ? raw.reduce((total, part) => total + part.byteLength, 0)
        : raw.byteLength;
      if (isBinary || (!peer.authenticated && size > 8192)) {
        reject();
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw));
      } catch {
        reject();
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        reject();
        return;
      }
      if (message.type === "auth_init") {
        const address = request.socket.remoteAddress?.replace(/^::ffff:/, "");
        if (
          peer.role ||
          message.device_sid !== options.auth.deviceSid ||
          (message.role !== "device" && message.role !== "terminal") ||
          (message.role === "device" && !localAddresses.has(address ?? ""))
        ) {
          reject();
          return;
        }
        peer.role = message.role;
        peer.nonce = randomBytes(32).toString("base64url");
        send(socket, { type: "auth_challenge", nonce: peer.nonce });
      } else if (message.type === "auth_response") {
        if (
          !peer.nonce ||
          peer.authenticated ||
          message.device_sid !== options.auth.deviceSid ||
          typeof message.proof !== "string"
        ) {
          reject();
          return;
        }
        const expected = createHmac("sha256", options.auth.passHash)
          .update(`${peer.nonce}|${peer.role}|${options.auth.deviceSid}`)
          .digest();
        peer.nonce = undefined;
        const actual = Buffer.from(message.proof, "base64url");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          reject();
          return;
        }
        clearTimeout(deadline);
        for (const previous of peers) {
          if (previous !== peer && previous.authenticated && previous.role === peer.role) {
            previous.authenticated = false;
            send(previous.socket, {
              type: "error",
              code: "KICKED",
              message: "Replaced by a new connection",
            });
            previous.socket.close(1000);
          }
        }
        peer.authenticated = true;
        send(socket, {
          type: "auth_ack",
          device_sid: options.auth.deviceSid,
          pair_status: partner(peer) ? "matched" : "waiting",
        });
        notifyPair(peer);
      } else if (!peer.authenticated) reject();
      else if (
        message.type === "pair_status_query" &&
        message.device_sid === options.auth.deviceSid
      )
        notifyPair(peer);
      else if (message.type === "data" && Object.hasOwn(message, "payload")) {
        const other = partner(peer);
        if (other) send(other.socket, { type: "data", payload: message.payload });
      } else reject();
    });
    socket.on("close", () => {
      clearTimeout(deadline);
      const other = peer.authenticated ? partner(peer) : undefined;
      peers.delete(peer);
      if (other) notifyPair(other);
    });
  });
  let closing: Promise<void> | undefined;
  const dispose = () =>
    (closing ??= new Promise<void>((done) => {
      options.signal.removeEventListener("abort", abort);
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.close(() => done());
      server.closeAllConnections();
    }));
  const abort = () => {
    void dispose();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((done, fail) => {
      const onAbort = () => fail(new Error("Direct connection cancelled"));
      options.signal.addEventListener("abort", onAbort, { once: true });
      server.once("error", fail);
      server.listen(options.port, options.listenHost, () => {
        options.signal.removeEventListener("abort", onAbort);
        server.off("error", fail);
        done();
      });
    });
    options.signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Direct listener unavailable");
    return { port: address.port, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
