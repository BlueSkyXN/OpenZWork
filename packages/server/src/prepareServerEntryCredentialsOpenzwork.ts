import { join, resolve } from "node:path";
import {
  prepareServerCredentialFile,
  prepareServerCredentialStorage,
  readAssignedCredentialsFile,
  ZCODE_CREDENTIALS_FILE_ENV,
} from "@zcode/shared/credential-security";
import { getCredentialsFilePath, getZCodeDataRootDir } from "@zcode/services/node";

// OpenZWork(OZ-F011)：独立 Web 入口与 zcode-server-cli 对齐同机凭据隔离：
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
