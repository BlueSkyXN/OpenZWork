import type { Locale } from "@zcode/shared";

/**
 * WP-E1a settings hint copy. Keep each string identical to the locale catalog while
 * making the exact visible messages independently testable without loading React UI.
 */
export const MEMORY_MIGRATION_HINTS: Record<Locale, string> = {
  "zh-CN":
    "开启后将读取本机 ~/.openzwork/cli/memories 下保存的工作区记忆；旧版本（~/.zcode）的数据会在应用启动时自动迁移。",
  "en-US":
    "When enabled, workspace memories saved under ~/.openzwork/cli/memories on this device will be read. Data from the previous version (~/.zcode) is migrated automatically on app startup.",
};

export function getMemoryMigrationHint(locale: Locale): string {
  return MEMORY_MIGRATION_HINTS[locale];
}
