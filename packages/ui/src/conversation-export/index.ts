import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import type { V4ConversationRowsRangeResult } from "@zcode/shared/zcode-protocol-v4";
import { extractPlanToolCallContent } from "@/lib/planToolCall.js";
import type {
  ConversationRow,
  ConversationExportOptions,
  ConversationExportRequest,
  ConversationCopyRequest,
  ConversationCopyResult,
  ConversationRowsReader,
} from "./contract.js";

export class ConversationExportError extends Error {
  constructor(readonly code: "changed" | "invalid-page" | "empty") {
    super("conversation-export." + code);
    this.name = "ConversationExportError";
  }
}

/** 只格式化已提交的可见正文；保留原 Markdown，不读取渲染 DOM。 */
export function formatConversationMarkdown(
  rows: readonly ConversationRow[],
  { title, labels }: ConversationExportOptions,
): string {
  const assistantTexts = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.kind !== "assistantText") continue;
    const texts = assistantTexts.get(row.turnId) ?? new Set<string>();
    texts.add(row.text.trim());
    assistantTexts.set(row.turnId, texts);
  }
  const sections: Array<{ role: "user" | "assistant"; turnId: string; text: string }> = [];
  for (const row of rows) {
    let role: "user" | "assistant";
    let text: string;
    if (row.kind === "userInput" && row.origin === "realUser") {
      role = "user";
      const body =
        row.epilogueStart === undefined ? row.text : row.text.slice(0, row.epilogueStart);
      const attachments = (row.attachments ?? []).map(
        (attachment) =>
          "- " + labels.attachment + "：" + attachment.fileName.replace(/[\r\n]+/g, " "),
      );
      text = [body.trimEnd(), ...attachments].filter(Boolean).join("\n\n");
    } else if (row.kind === "assistantText") {
      role = "assistant";
      text = row.text.trimEnd();
    } else if (
      row.kind === "toolCall" &&
      row.toolName === "ExitPlanMode" &&
      (row.status === "success" || row.status === "error" || row.status === "cancelled")
    ) {
      role = "assistant";
      text = extractPlanToolCallContent(row, "").markdown ?? "";
      if (assistantTexts.get(row.turnId)?.has(text.trim())) continue;
    } else {
      continue;
    }
    if (!text.trim()) continue;
    const previous = sections.at(-1);
    if (role === "assistant" && previous?.role === role && previous.turnId === row.turnId) {
      previous.text += "\n\n" + text;
    } else {
      sections.push({ role, turnId: row.turnId, text });
    }
  }
  const heading = title.replace(/[\r\n]+/g, " ").trim();
  return (
    [
      "# " + heading,
      ...sections.map((section) => "## " + labels[section.role] + "\n\n" + section.text),
    ].join("\n\n") + "\n"
  );
}

function verifyVersion(
  expected: V4ConversationRowsRangeResult,
  actual: V4ConversationRowsRangeResult,
): void {
  // revision 只随结构变化增长；seq 可因正文流式增量前进，不因此阻断复制。
  if (
    actual.atLogEpoch !== expected.atLogEpoch ||
    actual.atRevision !== expected.atRevision ||
    actual.atSeq < expected.atSeq
  )
    throw new ConversationExportError("changed");
}

async function readConsistentRows(readPage: ConversationRowsReader): Promise<ConversationRow[]> {
  const first = await readPage({ limit: PROTOCOL_V4_LIMITS.rowsRangeMaxLimit });
  const pages: ConversationRow[][] = [];
  let page = first;
  let previousVersion = first;
  let beforeRowId: number | undefined;
  while (true) {
    verifyVersion(previousVersion, page);
    previousVersion = page;
    if (page.hasMore && page.rows.length === 0) throw new ConversationExportError("invalid-page");
    let previousRowId = -Infinity;
    for (const row of page.rows) {
      if (
        !Number.isFinite(row.rowId) ||
        row.rowId <= previousRowId ||
        (beforeRowId !== undefined && row.rowId >= beforeRowId)
      )
        throw new ConversationExportError("invalid-page");
      previousRowId = row.rowId;
    }
    pages.push(page.rows);
    if (!page.hasMore) break;
    beforeRowId = page.rows[0]!.rowId;
    page = await readPage({ beforeRowId, limit: PROTOCOL_V4_LIMITS.rowsRangeMaxLimit });
  }
  // 最后一页到达后复验，避免最后一次查询期间的 edit/retry 拼接进旧尾部。
  verifyVersion(page, await readPage({ limit: 1 }));
  const rows = pages.reverse().flat();
  if (!rows.length) throw new ConversationExportError("empty");
  return rows;
}

export async function loadConversationMarkdown(
  request: ConversationExportRequest,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return formatConversationMarkdown(await readConsistentRows(request.readPage), request);
    } catch (error) {
      if (!(error instanceof ConversationExportError) || error.code !== "changed" || attempt > 0)
        throw error;
    }
  }
  throw new ConversationExportError("changed");
}

// 仅管理本窗口的剪贴板意图；不是会话状态。菜单卸载后仍可完成，新的复制会淘汰旧结果。
let latestCopyIntent = 0;
export async function copyConversationMarkdown(
  request: ConversationCopyRequest,
): Promise<ConversationCopyResult> {
  const intent = ++latestCopyIntent;
  try {
    const markdown = loadConversationMarkdown({
      ...request,
      readPage: async (params) => {
        if (intent !== latestCopyIntent) throw new Error("conversation-export.superseded");
        const result = await request.readPage(params);
        if (intent !== latestCopyIntent) throw new Error("conversation-export.superseded");
        return result;
      },
    });
    if (request.writeDeferredText) {
      // 写入端需同步接收 Promise；不能等历史读取后才请求 Safari 的剪贴板授权。
      try {
        await request.writeDeferredText(markdown);
      } catch (error) {
        void markdown.catch(() => {});
        throw error;
      }
    } else {
      const text = await markdown;
      if (intent !== latestCopyIntent) return "superseded";
      await request.writeText(text);
    }
    return intent === latestCopyIntent ? "copied" : "superseded";
  } catch (error) {
    if (intent !== latestCopyIntent) return "superseded";
    throw error;
  }
}

export type { ConversationExportLabels, ConversationExportRequest } from "./contract.js";
