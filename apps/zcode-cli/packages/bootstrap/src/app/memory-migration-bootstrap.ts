import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePath } from "@zcode/adapters/config";
import { DefaultRuntimeConfig } from "@zcode/contracts";
import {
  migrateLegacyProjectMemories,
  type MemoryMigrationLogger,
} from "@zcode/shared/node";

/**
 * CLI 默认 storage 根的引导迁移单一入口。隔离为可测试函数，保证 createZCodeApp
 * 在建立 runtime 前先尝试同一迁移；显式 custom storage 不创建默认目录，只发诊断日志。
 */
export async function migrateDefaultCliStorageMemories(input: {
  storageRoot: string;
  sourceMemoriesRoot: string;
  logger: MemoryMigrationLogger;
  defaultStorageRoot?: string;
}): Promise<void> {
  const defaultStorageRoot =
    input.defaultStorageRoot ?? resolvePath(DefaultRuntimeConfig.storage.dir);
  if (input.storageRoot !== defaultStorageRoot) {
    input.logger.info(
      `skip legacy memory migration for custom storage dir: source=${input.sourceMemoriesRoot} target=${input.storageRoot}`,
    );
    return;
  }

  try {
    await migrateLegacyProjectMemories({
      sourceMemoriesRoot: input.sourceMemoriesRoot,
      targetStorageRoot: input.storageRoot,
      logger: input.logger,
    });
  } catch (error) {
    input.logger.warn(
      `legacy memory migration failed, will retry on next launch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function getLegacyProjectMemoriesRoot(): string {
  return join(homedir(), ".zcode", "cli", "memories");
}
