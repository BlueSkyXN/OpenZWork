export interface BotCredentialKeyMigrationBot {
  id: string;
  credentialRef?: string;
  webhookSecretRef?: string;
}

export interface BotCredentialKeyMigrationConfig<Bot extends BotCredentialKeyMigrationBot> {
  bots: Bot[];
}

export interface BotCredentialKeyStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// 本地 v3 bot-config 只在首次读取时导入；secret refs 随配置迁移，绝不联网获取或上报。
/** Copy legacy Bot keys before persisting references; delete old keys only after config commit. */
export async function migrateBotCredentialKeys<
  Bot extends BotCredentialKeyMigrationBot,
  Config extends BotCredentialKeyMigrationConfig<Bot>,
>(params: {
  config: Config;
  credentialStore: BotCredentialKeyStore;
  writeConfig(config: Config): Promise<Config>;
  resolveCredentialValue?(key: string, value: string): Promise<string> | string;
  buildCredentialKey(botId: string): string;
  buildWebhookSecretKey(botId: string): string;
  warn(message: string, error?: unknown): void;
}): Promise<{ config: Config; changed: boolean }> {
  let changed = false;
  const obsoleteCredentialKeys: string[] = [];
  const bots: Bot[] = [];

  for (const bot of params.config.bots) {
    let nextBot = bot;
    for (const entry of [
      {
        field: "credentialRef" as const,
        suffix: "credential",
        buildKey: params.buildCredentialKey,
      },
      {
        field: "webhookSecretRef" as const,
        suffix: "webhook-secret",
        buildKey: params.buildWebhookSecretKey,
      },
    ]) {
      const legacyKey = `bot:${bot.id}:${entry.suffix}`;
      if (nextBot[entry.field] !== legacyKey) continue;
      const storedValue = await params.credentialStore.load(legacyKey);
      if (storedValue === null) {
        params.warn(`legacy Bot credential missing key=${legacyKey}; retaining reference`);
        continue;
      }
      const nextKey = entry.buildKey(bot.id);
      let value = storedValue;
      if (params.resolveCredentialValue) {
        try {
          value = await params.resolveCredentialValue(legacyKey, storedValue);
        } catch (error) {
          params.warn(
            `legacy Bot credential decrypt failed key=${legacyKey}; retaining reference`,
            error,
          );
          continue;
        }
      }
      await params.credentialStore.save(nextKey, value);
      nextBot = { ...nextBot, [entry.field]: nextKey };
      obsoleteCredentialKeys.push(legacyKey);
      changed = true;
    }
    bots.push(nextBot);
  }

  if (!changed) return { config: params.config, changed: false };

  // 配置引用先原子提交后再删旧 key，避免升级中断后新旧两边都不可用。
  const config = await params.writeConfig({ ...params.config, bots } as Config);
  for (const oldKey of obsoleteCredentialKeys) {
    try {
      await params.credentialStore.delete(oldKey);
    } catch (error) {
      // 旧 key 清理失败不回滚已提交的新引用；下次启动不再依赖该旧 key。
      params.warn(`legacy Bot credential cleanup failed key=${oldKey}`, error);
    }
  }
  return { config, changed: true };
}
