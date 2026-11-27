import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareServerEntryCredentials } from "./stdioServices.js";
import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
} from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";

export { prepareServerEntryCredentials as prepareEntryHttpCredentials } from "./stdioServices.js";

async function main(): Promise<void> {
  const standalone = process.argv.includes("--prepare-credentials");
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
  if (standalone && process.send) {
    // OW-P045：端口归监听进程所有；父进程只在绑定完成后显示地址。
    const startupError = (error: NodeJS.ErrnoException) => {
      console.error(error.code === "EADDRINUSE" ? `Port ${port} is in use. Choose another port with --port.` : error.message);
      process.exit(1);
    };
    server.once("error", startupError);
    server.once("listening", () => {
      server.off("error", startupError);
      if (!process.connected) process.exit(0);
      process.once("disconnect", () => process.exit(0));
      const address = server.address();
      if (address && typeof address !== "string") process.send?.({ type: "web-listening", port: address.port });
    });
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
  void main().catch((error: unknown) => {
    console.error("[zcode-server:http] startup failed", error);
    process.exitCode = 1;
  });
}
