import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  providerProvisioningEnvelopeSchema,
  type ProviderProvisioningEnvelope,
} from "@zcode/shared";
import type {
  PersonalProviderConfigRepository,
  ProviderConfigLayerSnapshot,
} from "@zcode/provider";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@zcode/provider-node";
import type { CredentialCipherProvider } from "../credential/providers/credentialCipherProvider.js";

const CREDENTIAL_FILE_NAME = "credentials.json";

export interface ProviderProvisioningSource {
  read(syncId: string): Promise<ProviderProvisioningEnvelope>;
}

export interface ProviderProvisioningSourceOptions {
  readonly personalRepository: PersonalProviderConfigRepository;
  readonly credentialFilePath: string;
  readonly personalConfigFilePath: string;
  readonly cipherProvider?: CredentialCipherProvider;
}

/** 从 Local Environment 读取可 Provision 的事实；不会读取或导出完整 Registry Snapshot。 */
export function createProviderProvisioningSource(
  options: ProviderProvisioningSourceOptions,
): ProviderProvisioningSource {
  return {
    async read(syncId: string): Promise<ProviderProvisioningEnvelope> {
      const personal = await readProvisionablePersonalConfig(
        options.personalRepository,
        options.personalConfigFilePath,
      );
      // 默认与规则来自同一份持锁读取，不能把两次读取的值拼成不存在的配置版本。
      const personalConfig = encodeProviderConfigFile(personal).config;
      return providerProvisioningEnvelopeSchema.parse({
        // 上游 v2 防止旧 Target 把缺失历史账号 Key 当删除；净化版仅分发 Personal Config。
        schemaVersion: 2,
        syncId,
        personalConfig,
        credentials: [],
      });
    },
  };
}

/** 分发读取不能把坏文件的内存降级当成权威；Source 与 Target 使用同一完整读取约束。 */
export async function readProvisionablePersonalConfig(
  repository: PersonalProviderConfigRepository,
  filePath: string,
): Promise<ProviderConfigLayerSnapshot> {
  const personal = await repository.read();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      const rules = personal.models.toPersonalJSON();
      // 首次尚无 Personal 文件是合法空配置；已有内容后文件消失不能继续导出旧快照。
      if (
        personal.providers.keys().length === 0 &&
        rules.providerModelRules.length === 0 &&
        rules.manualProviderModelRules.length === 0 &&
        !personal.providerOrder?.length &&
        personal.defaultModelSelection === undefined
      )
        return personal;
    }
    throw new Error(`本地 Personal Provider Config 无法同步: ${filePath}`, { cause: error });
  }
  try {
    const decoded = decodeProviderConfigFile(JSON.parse(raw) as unknown);
    const actualRevision = createHash("sha256")
      .update(JSON.stringify(encodeProviderConfigFile(decoded)))
      .digest("hex");
    if (actualRevision !== personal.revision) {
      throw new Error("Personal Provider Config 在读取期间发生变化");
    }
    return personal;
  } catch (error) {
    throw new Error(`本地 Personal Provider Config 无法同步: ${filePath}`, { cause: error });
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function resolveCredentialFilePath(appConfigDir: string): string {
  return join(appConfigDir, CREDENTIAL_FILE_NAME);
}

/** 保留调用接口；OpenZWork 无独立凭据同步白名单，不能枚举并删除其它客户端的旧 Key。 */
export async function listProviderProvisioningCredentialKeys(
  _credentialFilePath: string,
): Promise<readonly string[]> {
  return [];
}
