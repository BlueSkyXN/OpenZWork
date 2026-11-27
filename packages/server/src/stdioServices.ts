import { join, resolve } from "node:path";
import {
  createLocalServices,
  getZCodeDataRootDir,
  getCredentialsFilePath,
  type ZCodeAgentCommandResolver,
} from "@zcode/services/node";
import {
  createServerCredentialCipher,
  prepareServerCredentialFile,
  prepareServerCredentialStorage,
  readAssignedCredentialsFile,
  ZCODE_CREDENTIALS_FILE_ENV,
} from "@zcode/shared/credential-security";
import type { IChannel } from "@zcode/rpc";
import {
  parseServiceAuthorityMode,
  ZCODE_REMOTE_HTTP_PROXY_ENV_KEY,
  ZCODE_REMOTE_NO_PROXY_ENV_KEY,
  ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
} from "@zcode/shared";

// OpenZWork(OZ-F011)：Web 与 stdio 在创建服务前完成同机凭据隔离：
// 当共享库已被 Desktop 固定为 OS 来源且未配置外部管理密钥时，原子发布 <dataRoot>/server/credentials/
// 并写入 ZCODE_CREDENTIALS_FILE，使 Server 服务与拉起的 Agent 子进程继承同一隔离凭据文件。
export async function prepareServerEntryCredentials(options?: {
  env?: NodeJS.ProcessEnv;
  dataRootDir?: string;
  sharedFilePath?: string;
}): Promise<string> {
  const env = options?.env ?? process.env;
  const assignedFilePath = readAssignedCredentialsFile(env);
  if (assignedFilePath) {
    await prepareServerCredentialStorage({ filePath: assignedFilePath, env });
    return assignedFilePath;
  }
  const dataRootDir = options?.dataRootDir ?? getZCodeDataRootDir();
  const sharedFilePath = options?.sharedFilePath ?? getCredentialsFilePath();
  const serverFilePath = resolve(join(dataRootDir, "server", "credentials", "credentials.json"));
  // OpenZWork(OZ-F011)：dev:web 首次启动时也要准备凭据，只有监听就绪通知依赖发行版父进程。
  const selectedFilePath = await prepareServerCredentialFile({
    sharedFilePath,
    serverFilePath,
    env,
  });
  if (selectedFilePath === serverFilePath) {
    env[ZCODE_CREDENTIALS_FILE_ENV] = selectedFilePath;
  }
  return selectedFilePath;
}

export interface CreateStdioServicesOptions {
  topicResourceRelayChannel?: () => IChannel;
  env?: Record<string, string | undefined>;
  zcodeBuiltinProviderConfigFilePath: string;
  zcodeAgentCommandResolver?: ZCodeAgentCommandResolver;
}

export interface RemoteAgentNetworkOptions {
  httpProxy?: string;
  noProxy?: string;
}

export function resolveRemoteAgentNetworkFromEnv(
  env: Record<string, string | undefined>,
): RemoteAgentNetworkOptions | undefined {
  if (env[ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]?.trim() !== "1") {
    return undefined;
  }
  return {
    httpProxy: env[ZCODE_REMOTE_HTTP_PROXY_ENV_KEY]?.trim() || undefined,
    noProxy: env[ZCODE_REMOTE_NO_PROXY_ENV_KEY]?.trim() || undefined,
  };
}

export async function createStdioServices(options: CreateStdioServicesOptions) {
  const env = options.env ?? process.env;
  const authorityModeParseResult = parseServiceAuthorityMode(env);
  const remoteAgentNetwork = resolveRemoteAgentNetworkFromEnv(env);
  // 旧 stdio 入口也必须在发布 ready 前验证存储，不能在同步到一半时才失败。
  // cipher 与 createLocalServices 内的凭据服务共用同一路径解析入口。
  const credentialCipherProvider = await createServerCredentialCipher({
    filePath: getCredentialsFilePath(),
    env,
  });
  // 远程 Desktop 的呈现能力必须从 stdio 入口收到的 authority mode 进入 Services 推导链。
  // 测试注入 resolver 只用于在 spawn 前观察最终命令，不改变生产默认 resolver。
  const services = createLocalServices({
    credentialCipherProvider,
    zcodeBuiltinProviderConfigFilePath: options.zcodeBuiltinProviderConfigFilePath,
    topicResourceRelayChannel: options.topicResourceRelayChannel,
    serviceAuthorityMode: authorityModeParseResult.mode,
    zcodeAgentCommandResolver: options.zcodeAgentCommandResolver,
    remoteAgentNetwork,
  });

  return {
    authorityModeParseResult,
    services,
  };
}
