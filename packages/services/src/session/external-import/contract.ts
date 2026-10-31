/**
 * session-external-import 对外契约：多来源外部客户端会话导入（spec
 * docs/spec/external-session-import.md）。调用方（zcodeTaskServiceAdapter）
 * 要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 */
import type {
  ZCodeImportableSessionCandidate,
  ZCodeImportSessionsResult,
  ZCodeImportSessionSourceProvider,
  ZCodeSessionImportHistory,
  ZCodeTaskMeta,
  ZCodeTaskMigrationSource,
} from "@zcode/shared";

export interface ExternalSessionScanParams {
  provider: Exclude<ZCodeImportSessionSourceProvider, "claude">;
  workspacePath?: string;
  modifiedSince?: number;
  limit?: number;
}

export interface ExternalSessionCreateParams {
  provider: Exclude<ZCodeImportSessionSourceProvider, "claude">;
  sessionId: string;
  workspacePath: string;
  migrationSource: Exclude<ZCodeTaskMigrationSource, "claudeCode">;
  importedHistory: ZCodeSessionImportHistory;
  sourceContentSha256: string;
}

export interface ExternalSessionImportParams {
  provider: Exclude<ZCodeImportSessionSourceProvider, "claude">;
  workspacePath?: string;
  workspaceIdentity?: string;
  sessionIds: string[];
  /** 由 adapter 提供：创建真实 ZCode 会话并写任务索引（含 migrationSource/externalImport 指纹）。 */
  createImportedSession: (source: ExternalSessionCreateParams) => Promise<ZCodeTaskMeta>;
  onTaskImported: (meta: ZCodeTaskMeta) => void;
}

export interface ExternalSessionImportContract {
  /**
   * 扫描外部客户端原生会话目录（codex=~/.codex/sessions，qoder=~/.qoder[-cn]/projects）。
   * 只读、头采样解析；无 IO 副作用。claude 来源不走本模块（留在 claude-native）。
   */
  scanImportableSessions(
    params: ExternalSessionScanParams,
  ): Promise<ZCodeImportableSessionCandidate[]>;

  /**
   * 导入选中的外部会话：复制原文件到 agent-config/<provider>/ 备份、解析可见消息、
   * 经 createImportedSession 建会话。幂等：同 provider+sessionId 且来源 sha256 未变 →
   * skipped(already_imported_unchanged)。失败时清理本次已创建的备份文件。
   */
  importSessions(params: ExternalSessionImportParams): Promise<ZCodeImportSessionsResult>;
}
