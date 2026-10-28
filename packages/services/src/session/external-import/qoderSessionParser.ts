import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { ZCodePersistedMessage } from "@zcode/shared";
import {
  extractClaudeNativeSessionHeadInfo,
  parseClaudeNativeSessionRecords,
} from "#src/session/claude-native/claudeNativeSessionImportParser.js";
import { readJsonLinesFileHead } from "#src/session/claude-native/sessionHistoryJsonl.js";
import type { JsonLineRecord } from "#src/session/claude-native/jsonLineRecord.js";
import type { ExternalImportedSessionSource } from "#src/session/external-import/externalImportedSessionTypes.js";

/**
 * Qoder / Qoder CN 原生会话 jsonl 与 Claude Code 同构（uuid/parentUuid/message.content[]，
 * 实物验证见 local/cross-client-import-sync-research-20261028.md §3.1），
 * 因此直接复用 claude-native 的可见消息提取与噪音过滤，仅落不同的 provider/migrationSource。
 */
export function parseQoderSessionHeadInfo(entries: readonly JsonLineRecord[]): {
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
} {
  return extractClaudeNativeSessionHeadInfo(entries);
}

export async function parseQoderSessionFile(params: {
  filePath: string;
  sessionId: string;
  workspacePath: string;
}): Promise<ExternalImportedSessionSource> {
  const [raw, sourceStat] = await Promise.all([
    readFile(params.filePath, "utf-8"),
    stat(params.filePath),
  ]);
  const sourceContentSha256 = createHash("sha256").update(raw).digest("hex");
  const records: JsonLineRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as JsonLineRecord);
    } catch {
      // 单行损坏跳过，保持与 claude-native 相同的尽力解析语义。
    }
  }

  const parsed = parseClaudeNativeSessionRecords({
    records,
    workspacePath: params.workspacePath,
    sessionId: params.sessionId,
    sourcePath: params.filePath,
    fallbackCreatedAt: Math.trunc(sourceStat.birthtimeMs),
    fallbackUpdatedAt: Math.trunc(sourceStat.mtimeMs),
  });

  // Qoder 侧模型名（qfmodel/auto 等）不迁移：claude-native 解析会把来源模型写进
  // assistant 消息与 parsed.model，这里按 claude 导入同样的边界清洗（spec 不变量 2）。
  const messages: ZCodePersistedMessage[] = parsed.messages.map((message) => {
    const { model: _model, ...rest } = message;
    return rest as ZCodePersistedMessage;
  });

  return {
    provider: "qoder",
    sessionId: params.sessionId,
    workspacePath: parsed.workspacePath,
    sourcePath: params.filePath,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    ...(parsed.title ? { title: parsed.title } : {}),
    migrationSource: "qoder",
    sourceContentSha256,
    messages,
  };
}

export async function readQoderSessionHeadRecords(filePath: string): Promise<JsonLineRecord[]> {
  return readJsonLinesFileHead(filePath, 16);
}
