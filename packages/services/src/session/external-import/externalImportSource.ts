import type { ZCodeImportSessionSourceProvider, ZCodeTaskMigrationSource } from "@zcode/shared";

/**
 * provider（来源产品）到 migrationSource（任务索引迁移标记）的唯一换算。
 * 防统计污染的过滤链按 migrationSource 生效，新增来源必须在这里登记自己的新值，
 * 禁止复用已有来源的标记（见 docs/spec/external-session-import.md 不变量 1）。
 */
export function migrationSourceForProvider(
  provider: ZCodeImportSessionSourceProvider,
): ZCodeTaskMigrationSource {
  switch (provider) {
    case "claude":
      return "claudeCode";
    case "codex":
      return "codexCli";
    case "qoder":
      return "qoder";
  }
}
