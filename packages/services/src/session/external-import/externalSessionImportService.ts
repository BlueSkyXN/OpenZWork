import { access, rm } from "node:fs/promises";
import type {
  ZCodeImportSessionsResult,
  ZCodeSessionImportHistory,
  ZCodeTaskMeta,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { externalSessionImportRepo } from "#src/session/external-import/externalSessionImportRepo.js";
import { parseCodexRolloutSessionFile } from "#src/session/external-import/codexRolloutParser.js";
import { parseQoderSessionFile } from "#src/session/external-import/qoderSessionParser.js";
import type { ExternalImportedSessionSource } from "#src/session/external-import/externalImportedSessionTypes.js";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";

const logger = createServiceLogger("external-import");

export interface ExternalSessionImportTaskIndex {
  /** 查同 provider+sessionId 已导入任务的 externalImport 指纹（幂等判断）。 */
  findImportedFingerprint(params: {
    provider: "codex" | "qoder";
    sessionId: string;
    workspaceKey?: string;
  }): Promise<{ taskId: string; sourceContentSha256?: string } | null>;
}

async function workspacePathExists(workspacePath: string): Promise<boolean> {
  try {
    await access(workspacePath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupCreatedArtifacts(paths: readonly string[]): Promise<void> {
  for (const path of new Set(paths)) {
    try {
      await rm(path, { force: true });
    } catch {
      // 清理失败不阻断主流程，与 claude 导入一致。
    }
  }
}

function toImportedHistory(source: ExternalImportedSessionSource): ZCodeSessionImportHistory {
  return {
    source: source.migrationSource,
    title: source.title,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    messages: source.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    })),
  } as ZCodeSessionImportHistory;
}

async function parseExternalSessionFile(params: {
  provider: "codex" | "qoder";
  filePath: string;
  sessionId: string;
  workspacePath: string;
}): Promise<ExternalImportedSessionSource> {
  return params.provider === "codex"
    ? parseCodexRolloutSessionFile({
        filePath: params.filePath,
        sessionId: params.sessionId,
      })
    : parseQoderSessionFile({
        filePath: params.filePath,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
      });
}

export async function importExternalSessions(params: {
  taskIndexRepo: TaskIndexRepo;
  importIndex: ExternalSessionImportTaskIndex;
  provider: "codex" | "qoder";
  workspacePath?: string;
  workspaceIdentity?: string;
  sessionIds: string[];
  createImportedSession: (source: {
    provider: "codex" | "qoder";
    sessionId: string;
    workspacePath: string;
    migrationSource: "codexCli" | "qoder";
    importedHistory: ZCodeSessionImportHistory;
    sourceContentSha256: string;
  }) => Promise<ZCodeTaskMeta>;
  onTaskImported: (meta: ZCodeTaskMeta) => void;
}): Promise<ZCodeImportSessionsResult> {
  const normalizedSessionIds = [
    ...new Set(params.sessionIds.map((item) => item.trim()).filter(Boolean)),
  ];
  const result: ZCodeImportSessionsResult = {
    imported: [],
    skipped: [],
    failed: [],
  };

  logger.info(
    undefined,
    `开始导入外部 session provider=${params.provider} workspaceFilter=${params.workspacePath ?? "all"} count=${normalizedSessionIds.length}`,
  );

  for (const sessionId of normalizedSessionIds) {
    let createdOutputPaths: string[] = [];
    let importedWorkspacePath: string | undefined;
    try {
      const candidate = await externalSessionImportRepo.findImportableSession({
        provider: params.provider,
        sessionId,
        workspacePath: params.workspacePath,
      });
      if (!candidate) {
        result.skipped.push({
          provider: params.provider,
          sessionId,
          reason: "session_not_found_or_workspace_mismatch",
          ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
        });
        continue;
      }

      importedWorkspacePath = candidate.workspacePath;
      if (!(await workspacePathExists(importedWorkspacePath))) {
        result.skipped.push({
          provider: params.provider,
          sessionId,
          reason: "workspace_path_missing",
          workspacePath: importedWorkspacePath,
        });
        continue;
      }

      // 幂等（spec §2.4）：同 provider+sessionId 且来源哈希未变 → 跳过，不重复建会话。
      const fingerprint = await params.importIndex.findImportedFingerprint({
        provider: params.provider,
        sessionId,
      });
      if (fingerprint?.sourceContentSha256) {
        const parsedForHash = await parseExternalSessionFile({
          provider: params.provider,
          filePath: candidate.sourcePath,
          sessionId,
          workspacePath: importedWorkspacePath,
        });
        if (parsedForHash.sourceContentSha256 === fingerprint.sourceContentSha256) {
          result.skipped.push({
            provider: params.provider,
            sessionId,
            reason: "already_imported_unchanged",
            workspacePath: importedWorkspacePath,
          });
          continue;
        }
      }

      const copiedArtifacts = await externalSessionImportRepo.copySessionFileToWorkspace({
        provider: params.provider,
        workspacePath: importedWorkspacePath,
        workspaceIdentity: params.workspacePath ? params.workspaceIdentity : undefined,
        sourcePath: candidate.sourcePath,
      });
      createdOutputPaths = copiedArtifacts.createdOutputPaths;

      const importedSource = await parseExternalSessionFile({
        provider: params.provider,
        filePath: candidate.sourcePath,
        sessionId,
        workspacePath: importedWorkspacePath,
      });

      const meta = await params.createImportedSession({
        provider: params.provider,
        sessionId,
        workspacePath: importedWorkspacePath,
        migrationSource: importedSource.migrationSource,
        importedHistory: toImportedHistory(importedSource),
        sourceContentSha256: importedSource.sourceContentSha256,
      });
      params.onTaskImported(meta);

      result.imported.push({
        provider: params.provider,
        sessionId,
        taskId: meta.taskId,
        workspacePath: meta.workspacePath,
      });
    } catch (error) {
      await cleanupCreatedArtifacts(createdOutputPaths);
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        undefined,
        `导入外部 session 失败 provider=${params.provider} session=${sessionId}`,
        error,
      );
      result.failed.push({
        provider: params.provider,
        sessionId,
        reason,
        ...(importedWorkspacePath ? { workspacePath: importedWorkspacePath } : {}),
      });
    }
  }

  logger.info(
    undefined,
    `外部 session 导入完成 provider=${params.provider} imported=${result.imported.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  );
  return result;
}
