import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { ZCodePersistedMessage } from "@zcode/shared";
import { deriveSessionTitle } from "#src/session/sessionTitle.js";
import { readJsonLinesFileHead } from "#src/session/claude-native/sessionHistoryJsonl.js";
import {
  isObjectRecord,
  readTrimmedString,
  type JsonLineRecord,
} from "#src/session/claude-native/jsonLineRecord.js";
import type { ExternalImportedSessionSource } from "#src/session/external-import/externalImportedSessionTypes.js";

/**
 * Codex rollout jsonl 里 developer/system 注入块的已知标签。
 * 这些是 Codex 客户端自行写入的 instructions/app-context，不是用户可见消息，
 * 直接导入会把外部产品的运行时指令混进我方会话（spec §2.3 复用规则）。
 */
const CODEX_INJECTED_PREFIX_RE =
  /^<(environment_instructions|environment_context|app-context|user_instructions|INSTRUCTIONS)>[\s\S]*?<\/\1>\s*/i;

/** AGENTS.md 注入的头部行：Codex 会把 "# AGENTS.md instructions for ..." 开头的块塞进 user 消息。 */
const CODEX_AGENTS_MD_HEADER_RE =
  /^#\s+AGENTS\.md instructions for[^\n]*\n+(?:<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\n*)?/;

const CODEX_ROLLOUT_FILENAME_SESSION_ID_RE =
  /rollout-[\dT:-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu;

function normalizeCodexVisibleText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function stripCodexInjectedPrefix(text: string): string {
  // 环境块曾被当作首条问题；只剥离 user 的连续注入前缀，避免全局替换吞掉正文引用和回答示例。
  let rest = text.replace(CODEX_AGENTS_MD_HEADER_RE, "").trim();
  for (;;) {
    const next = rest.replace(CODEX_INJECTED_PREFIX_RE, "").trim();
    if (next === rest) return rest;
    rest = next;
  }
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return Math.trunc(value);
    }
    if (value > 1_000_000_000) {
      return Math.trunc(value * 1000);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readCodexPayload(entry: JsonLineRecord): Record<string, unknown> | undefined {
  return isObjectRecord(entry.payload) ? entry.payload : undefined;
}

function extractCodexMessageText(payload: Record<string, unknown>): string | null {
  const content = payload.content;
  if (typeof content === "string") {
    const normalized = normalizeCodexVisibleText(content);
    return normalized.length > 0 ? normalized : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .flatMap((item): string[] => {
      if (typeof item === "string") {
        const normalized = normalizeCodexVisibleText(item);
        return normalized.length > 0 ? [normalized] : [];
      }
      if (!isObjectRecord(item)) {
        return [];
      }
      // 只取 input_text/output_text；input_image 等二进制内容不属于可导入文本。
      if (item.type !== "text" && item.type !== "input_text" && item.type !== "output_text") {
        return [];
      }
      const normalized = normalizeCodexVisibleText(readTrimmedString(item.text) ?? "");
      return normalized.length > 0 ? [normalized] : [];
    })
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function extractCodexVisibleMessage(
  entry: JsonLineRecord,
): { role: "user" | "assistant"; content: string; timestamp?: number } | null {
  if (readTrimmedString(entry.type) !== "response_item") {
    return null;
  }
  const payload = readCodexPayload(entry);
  if (!payload || readTrimmedString(payload.type) !== "message") {
    return null;
  }
  // role=developer 是 Codex 客户端注入的指令通道（AGENTS.md、app-context 等），不是用户输入。
  const role = readTrimmedString(payload.role);
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const rawText = extractCodexMessageText(payload);
  if (!rawText) {
    return null;
  }
  const content = role === "user" ? stripCodexInjectedPrefix(rawText) : rawText;
  if (content.length === 0) {
    return null;
  }
  return {
    role,
    content,
    timestamp: toTimestampMs(entry.timestamp),
  };
}

export function extractCodexRolloutSessionId(fileName: string): string | null {
  const match = CODEX_ROLLOUT_FILENAME_SESSION_ID_RE.exec(fileName);
  return match?.[1]?.toLowerCase() ?? null;
}

export function parseCodexRolloutSessionHeadInfo(entries: readonly JsonLineRecord[]): {
  workspacePath?: string;
  previewTitle?: string;
  createdAt?: number;
} {
  let workspacePath: string | undefined;

  for (const entry of entries) {
    if (workspacePath === undefined && readTrimmedString(entry.type) === "session_meta") {
      const payload = readCodexPayload(entry);
      const cwd = payload ? readTrimmedString(payload.cwd) : undefined;
      if (cwd) {
        workspacePath = cwd;
      }
    }
    const visible = extractCodexVisibleMessage(entry);
    if (!visible) {
      continue;
    }
    return {
      workspacePath,
      previewTitle: deriveSessionTitle(visible.content, []),
      createdAt: visible.timestamp,
    };
  }

  return { workspacePath };
}

export async function parseCodexRolloutSessionFile(params: {
  filePath: string;
  sessionId: string;
}): Promise<ExternalImportedSessionSource> {
  const [raw, sourceStat] = await Promise.all([
    readFile(params.filePath, "utf-8"),
    stat(params.filePath),
  ]);
  const sourceContentSha256 = createHash("sha256").update(raw).digest("hex");

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records: JsonLineRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as JsonLineRecord);
    } catch {
      // 单行损坏跳过，与外部产品"尽力导入"语义一致；不中断整个会话。
    }
  }

  const headInfo = parseCodexRolloutSessionHeadInfo(records.slice(0, 64));
  const workspacePath = headInfo.workspacePath;
  if (!workspacePath) {
    throw new Error(
      `[external-import] Codex rollout ${params.sessionId} 缺少 session_meta.cwd，无法归属 workspace`,
    );
  }

  const messages: ZCodePersistedMessage[] = [];
  let firstVisibleUserTimestamp: number | undefined;
  let lastTimestamp: number | undefined;
  let pendingAssistantContent = "";
  let pendingAssistantTimestamp: number | undefined;
  let currentTurnIndex = -1;

  const flushPendingAssistant = () => {
    if (!pendingAssistantContent || currentTurnIndex < 0) {
      pendingAssistantContent = "";
      pendingAssistantTimestamp = undefined;
      return;
    }
    messages.push({
      role: "assistant",
      content: pendingAssistantContent,
      timestamp: pendingAssistantTimestamp ?? lastTimestamp ?? Date.now(),
      turnIndex: currentTurnIndex,
    });
    pendingAssistantContent = "";
    pendingAssistantTimestamp = undefined;
  };

  for (const entry of records) {
    const visible = extractCodexVisibleMessage(entry);
    if (!visible) {
      continue;
    }
    if (visible.role === "user") {
      flushPendingAssistant();
      currentTurnIndex += 1;
      firstVisibleUserTimestamp ??= visible.timestamp;
      if (visible.timestamp !== undefined) {
        lastTimestamp = visible.timestamp;
      }
      messages.push({
        role: "user",
        content: visible.content,
        timestamp: visible.timestamp ?? lastTimestamp ?? Date.now(),
        turnIndex: currentTurnIndex,
      });
      continue;
    }
    if (currentTurnIndex < 0) {
      continue;
    }
    pendingAssistantContent += pendingAssistantContent ? `\n\n${visible.content}` : visible.content;
    pendingAssistantTimestamp = visible.timestamp ?? pendingAssistantTimestamp;
    if (pendingAssistantTimestamp !== undefined) {
      lastTimestamp = pendingAssistantTimestamp;
    }
  }
  flushPendingAssistant();

  if (messages.length === 0) {
    throw new Error(`[external-import] Codex rollout ${params.sessionId} 没有可导入的可见消息`);
  }

  const fallbackUpdatedAt = Math.trunc(sourceStat.mtimeMs);
  const updatedAt = lastTimestamp ?? fallbackUpdatedAt;
  const createdAt = firstVisibleUserTimestamp ?? headInfo.createdAt ?? fallbackUpdatedAt;

  return {
    provider: "codex",
    sessionId: params.sessionId,
    workspacePath,
    sourcePath: params.filePath,
    createdAt,
    updatedAt: Math.max(createdAt, updatedAt),
    title: deriveSessionTitle(messages.find((item) => item.role === "user")?.content ?? "", []),
    // Codex 来源的模型名不迁移：清洗边界与 claude 导入一致（spec 不变量 2）。
    migrationSource: "codexCli",
    sourceContentSha256,
    messages,
  };
}

export async function readCodexRolloutHeadRecords(filePath: string): Promise<JsonLineRecord[]> {
  return readJsonLinesFileHead(filePath, 24);
}
