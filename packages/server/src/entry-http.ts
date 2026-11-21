import { join } from "node:path";
import { prepareServerCredentialStorage } from "@zcode/shared/credential-security";
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

async function main(): Promise<void> {
  // OpenZWork(OZ-F011)：独立 Web 与 stdio 入口共用同一持久凭据准备流程。
  const standalone = process.argv.includes("--prepare-credentials");
  if (standalone) {
    await prepareServerCredentialStorage({ filePath: join(getAppConfigDir(), "credentials.json") });
  }
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

void main().catch((error: unknown) => {
  console.error("[zcode-server:http] startup failed", error);
  process.exitCode = 1;
});
