import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  prepareServerCredentialFile,
  prepareServerCredentialStorage,
  readAssignedCredentialsFile,
  resolveServerCredentialFile,
  ZCODE_CREDENTIALS_FILE_ENV,
} from "@zcode/shared/credential-security";
import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
  getCredentialsFilePath,
  getZCodeDataRootDir,
} from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";

// OpenZWork(OZ-F011)：独立 Web 入口与 zcode-server-cli 对齐同机凭据隔离：
// 当共享库已被 Desktop 固定为 OS 来源且未配置外部管理密钥时，原子发布 <dataRoot>/server/credentials/
// 并写入 ZCODE_CREDENTIALS_FILE，使 Server 服务与拉起的 Agent 子进程继承同一隔离凭据文件。
export async function prepareEntryHttpCredentials(options?: {
  standalone?: boolean;
  env?: NodeJS.ProcessEnv;
  dataRootDir?: string;
  sharedFilePath?: string;
}): Promise<string> {
  const env = options?.env ?? process.env;
  const standalone = options?.standalone ?? false;
  const assignedFilePath = readAssignedCredentialsFile(env);
  if (assignedFilePath) {
    if (standalone) {
      await prepareServerCredentialStorage({ filePath: assignedFilePath, env });
    }
    return assignedFilePath;
  }
  const dataRootDir = options?.dataRootDir ?? getZCodeDataRootDir();
  const sharedFilePath = options?.sharedFilePath ?? getCredentialsFilePath();
  const serverFilePath = resolve(join(dataRootDir, "server", "credentials", "credentials.json"));
  const selectedFilePath = standalone
    ? await prepareServerCredentialFile({
        sharedFilePath,
        serverFilePath,
        env,
      })
    : await resolveServerCredentialFile({
        sharedFilePath,
        serverFilePath,
      });
  if (selectedFilePath === serverFilePath) {
    env[ZCODE_CREDENTIALS_FILE_ENV] = selectedFilePath;
  }
  return selectedFilePath;
}

async function main(): Promise<void> {
  const standalone = process.argv.includes("--prepare-credentials");
  await prepareEntryHttpCredentials({ standalone });
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
