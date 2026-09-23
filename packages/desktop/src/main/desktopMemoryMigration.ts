import { migrateLegacyProjectMemories, type MemoryMigrationLogger } from "@zcode/shared/node";

/**
 * Desktop 启动链的迁移入口。由 main 在 setDataBaseDir 与 host/window 创建之间 await；
 * 将根与 logger 显式注入，便于隔离验收自定义 dataBaseDir，同时失败只告警、不阻塞启动。
 */
export async function runDesktopMemoryMigration(input: {
  sourceMemoriesRoot: string;
  targetStorageRoot: string;
  logger: MemoryMigrationLogger;
}): Promise<void> {
  try {
    await migrateLegacyProjectMemories(input);
  } catch (error) {
    input.logger.warn(
      `legacy memory migration failed, will retry on next launch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
