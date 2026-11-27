import { once } from "node:events";
import type { Socket } from "node:net";
import { withDataDirectoryUse } from "@zcode/shared/data-directory";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareServerEntryCredentials } from "./stdioServices.js";
import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
  getZCodeDataRootDir,
  disposeServiceResourcesAndWait,
} from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";

export { prepareServerEntryCredentials as prepareEntryHttpCredentials } from "./stdioServices.js";

async function main(): Promise<void> {
  const standalone = process.argv.includes("--prepare-credentials");
  const supervised = standalone && typeof process.send === "function";
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  if (supervised) process.once("disconnect", stop);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    // OZ-C009：独立 Web 会在准备凭据时写根目录，租约必须覆盖准备、监听和关闭。
    await withDataDirectoryUse(getZCodeDataRootDir(), () => serveHttp(standalone, supervised, shutdown));
  } finally {
    process.off("disconnect", stop);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

async function serveHttp(
  standalone: boolean,
  supervised: boolean,
  shutdown: AbortController,
): Promise<void> {
  await prepareServerEntryCredentials();
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  const port = process.env["PORT"] === "0" ? 0 : Number(process.env["PORT"]) || 3030;
  const host = process.env["ZCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const topicResourcePeers = createTopicResourcePeers();
  const serverId = resolveHttpServerId();
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
      sourceServerId: serverId,
      zcodeBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: Boolean(authToken),
    });

  try {
    const server = createHttpServer(services, port, {
      serverId,
      workspaceIdentityMapper,
      migrationFailedPathCount,
      virtualProjects: true,
      topicResourcePeers,
      ...(host ? { host } : {}),
      ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
      // OW-P054：无令牌局域网监听须由发行启动器显式传递用户选择。
      allowUnauthenticatedLan: standalone && process.argv.includes("--no-token"),
      ...(authToken ? { authToken, authRequired: true } : {}),
    });
    const sockets = new Set<Socket>();
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    try {
      // OW-P045：端口归监听进程所有；父进程只在绑定完成后显示地址。
      await once(server, "listening");
      if (shutdown.signal.aborted) return;
      if (supervised) {
        if (!process.connected) return;
        const address = server.address();
        if (address && typeof address !== "string") {
          process.send?.({ type: "web-listening", port: address.port }, (error: Error | null) => {
            if (error) shutdown.abort();
          });
        }
      }
      if (!shutdown.signal.aborted) await once(shutdown.signal, "abort");
    } finally {
      const closed = new Promise<void>((done) => server.close(() => done()));
      // HTTP close 会等待已升级的 WebSocket；关闭传输后才能回收对应的服务资源。
      for (const socket of sockets) socket.destroy();
      await closed;
    }
  } finally {
    await disposeServiceResourcesAndWait(services);
  }
}

function isEntryHttpMainModule(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return realpathSync(entryArg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(resolve(entryArg)).href === import.meta.url;
  }
}

if (isEntryHttpMainModule()) {
  void main().then(
    () => process.exit(0),
    (error: NodeJS.ErrnoException) => {
      console.error("[zcode-server:http] startup failed", error.code === "EADDRINUSE"
        ? `Port ${process.env.PORT || 3030} is in use. Choose another port with --port.`
        : error);
      process.exit(1);
    },
  );
}
