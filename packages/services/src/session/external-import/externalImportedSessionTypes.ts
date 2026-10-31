import type {
  ZCodeImportSessionSourceProvider,
  ZCodePersistedMessage,
  ZCodeTaskMigrationSource,
} from "@zcode/shared";

/**
 * 多来源外部会话导入的统一中间形态（docs/spec/external-session-import.md §2.3）。
 * claude 来源继续走 claude-native 模块产出 ClaudeNativeImportedSessionSource，
 * 这里承载 codex / qoder 两个新来源，字段语义与 claude-native 保持对齐。
 */
export interface ExternalImportedSessionSource {
  provider: Exclude<ZCodeImportSessionSourceProvider, "claude">;
  sessionId: string;
  workspacePath: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  model?: string;
  /** 与 provider 对应的迁移标记（codex→codexCli，qoder→qoder）；禁止复用 claudeCode。 */
  migrationSource: Exclude<ZCodeTaskMigrationSource, "claudeCode">;
  /** 来源文件全文 sha256；幂等重导按它判断"来源是否变化"（spec §2.4）。 */
  sourceContentSha256: string;
  messages: ZCodePersistedMessage[];
}
