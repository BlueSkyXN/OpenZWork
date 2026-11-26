import {
  ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY,
  ZCODE_MCP_NODE_REPL_BROWSER_USE_META_KEY,
  ZCODE_MCP_NODE_REPL_COMPUTER_USE_META_KEY,
} from "@zcode/contracts/mcp";
// OpenZWork 净化：上游另导入 ZCODE_MCP_NODE_REPL_CUA_APP_META_KEY 与 @zcode/zcode-cua 的
// frame-contract/host-display-contract（官方 CUA 域）；该域已净化。
import { matchBrowserScreenshotImageIndices, type NodeReplRunResult } from "@zcode/core/repl";
import type { NodeReplCallFacts } from "./call-ledger/contract.js";

import type { CallToolResult } from "@modelcontextprotocol/server";

type EmbeddedContentBlock = CallToolResult["content"][number];

interface EmbeddedMcpResult {
  content: EmbeddedContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

function parseEmbeddedMcpResult(value: string): EmbeddedMcpResult | undefined {
  const trimmed = value.trim();
  const json = trimmed.startsWith("=>") ? trimmed.slice(2).trim() : trimmed;
  if (!json.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.content)) return undefined;
    if (
      candidate.content.some(
        (block) => !block || typeof block !== "object" || typeof (block as { type?: unknown }).type !== "string",
      )
    ) {
      return undefined;
    }
    return {
      content: candidate.content as EmbeddedContentBlock[],
      ...(typeof candidate.isError === "boolean" ? { isError: candidate.isError } : {}),
      ...(candidate.structuredContent && typeof candidate.structuredContent === "object"
        ? { structuredContent: candidate.structuredContent as Record<string, unknown> }
        : {}),
      ...(candidate._meta && typeof candidate._meta === "object"
        ? { _meta: candidate._meta as Record<string, unknown> }
        : {}),
    };
  } catch {
    return undefined;
  }
}


const NO_CALL_FACTS: NodeReplCallFacts = {
  cuaApps: [],
  browserScreenshots: [],
  browserUse: false,
  computerUse: false,
};

/**
 * 组装 MCP 工具结果。run 来自 Worker 的结果消息，cell 能冒充它，所以只当作内容；
 * 可信 key 只取主线程账本记下的 facts（20-node-repl-call-ledger.md「结果组装」）。
 */
export function toMcpRunResult(
  run: NodeReplRunResult,
  facts: NodeReplCallFacts = NO_CALL_FACTS,
): CallToolResult {

  const textParts: string[] = [];
  // SDK 结果通过专用 sink 写入后，不能再从 run.result/console 日志解析第二份副本。
  // 否则模型的 JSON.stringify 会把 image base64 降成普通文本，破坏 image/image_ref 邻接关系。
  const structuredResults = run.structuredResults ?? [];
  const embedded =
    structuredResults.length === 0 && !run.error && run.result !== undefined
      ? parseEmbeddedMcpResult(run.result)
      : undefined;
  const responseMeta = { ...run.responseMeta };
  for (const structured of structuredResults) {
    if (structured._meta) Object.assign(responseMeta, structured._meta);
  }
  if (embedded?._meta) Object.assign(responseMeta, embedded._meta);
  // 该 key 决定 core 是否把原图落盘，不能允许 REPL 代码通过
  // setResponseMeta 伪造来源；只接受按账本里真实截图匹配出的下标（见下）。
  delete responseMeta[ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY];

  // 同款处置：producer 的应用元数据决定工具卡显示哪个 App 的名称和图标。它经
  // `projectToHost` -> `nodeRepl.emitStructuredResult` 到达上面的合并循环，而那个 API 挂在模型
  // 可见的 REPL globals 上 —— cell 里自己 emit 一份就能让卡片声称操作了别的应用。因此这里
  // 无条件丢弃，只接受主线程 CUA broker 记进账本的身份。
  // 修复原因（MR !3207 评审 CR-01）：原来取 run.cuaApp、run.browserScreenshotImageIndices，而 run 是
  // Worker 的结果消息，cell 能经 worker_threads 冒充它；这两个字段现在一律忽略。
  // OpenZWork 净化：上游还按 CUA 账本写回 zcode/nodeReplCuaApp（官方 CUA 域）；该域已净化。
  // 同款处置：core 据这两个键给会话打 browser_use / computer_use 标签。cell 经 sandbox 通道写的同名键
  // 一律丢弃，只按两个 broker 记进账本的事实写回（session-features-header.md「BUA/CUA 标签的补充规则」）。
  delete responseMeta[ZCODE_MCP_NODE_REPL_BROWSER_USE_META_KEY];
  delete responseMeta[ZCODE_MCP_NODE_REPL_COMPUTER_USE_META_KEY];
  if (facts.browserUse) responseMeta[ZCODE_MCP_NODE_REPL_BROWSER_USE_META_KEY] = true;
  if (facts.computerUse) responseMeta[ZCODE_MCP_NODE_REPL_COMPUTER_USE_META_KEY] = true;
  const structuredContent = structuredResults.flatMap(
    (structured) => structured.content as EmbeddedContentBlock[],
  );
  const structuredContentResult = [...structuredResults]
    .reverse()
    .find((structured) => structured.structuredContent !== undefined);
  const structuredIsError = structuredResults.some((structured) => structured.isError === true);
  if (run.error) {
    // node_repl 若用 message-only 隐藏通用 MCP 失败前缀，只消费
    // 模型结果文本的分析链路无法区分成功与失败。返回 error.message 和失败工具的恢复说明，
    // 通用 bridge 根据 isError 投影稳定标记，错误类型、堆栈和失败前日志继续省略。
    textParts.push(run.error.message);
  } else {
    if (run.logs) textParts.push(run.logs);
    if (structuredResults.length === 0 && run.result !== undefined && !embedded) {
      textParts.push(`=> ${run.result}`);
    }
  }

  // SDK 抛错后仍需传递失败工具的恢复说明，排除重复错误消息。
  const failedContent = structuredResults
    .filter((result) => result.isError === true)
    .flatMap((result) => result.content as EmbeddedContentBlock[])
    .filter(
      (block) =>
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text !== run.error?.message,
    );

  const content = [
    ...(run.error
      ? failedContent
      : structuredResults.length > 0
        ? structuredContent
        : (run.images ?? []).map((image) => ({
            type: "image" as const,
            data: image.base64,
            mimeType: image.mimeType,
          }))),
    ...(structuredResults.length > 0
      ? // 结构化观察已携带截图；模型再次 emitImage 同一张图时，只保留结构化结果中的副本。
        (run.images ?? [])
          .filter(
            (image) =>
              !structuredContent.some(
                (block) =>
                  block.type === "image" &&
                  (block as { data?: string }).data === image.base64,
              ),
          )
          .map((image) => ({
            type: "image" as const,
            data: image.base64,
            mimeType: image.mimeType,
          }))
      : []),
    ...(embedded?.content ?? []),
    ...(textParts.length > 0 ? [{ type: "text" as const, text: textParts.join("\n") }] : []),
  ];

  // 文本领先会使部分兼容网关丢弃后续图片，将图片块排在文本块之前。
  const mediaBlocks: EmbeddedContentBlock[] = [];
  const remainingBlocks: EmbeddedContentBlock[] = [];
  for (const block of content) {
    if (block.type === "image") mediaBlocks.push(block);
    else remainingBlocks.push(block);
  }
  const orderedContent = [...mediaBlocks, ...remainingBlocks];
  // 只用账本确认的截图字节，按最终位置回写索引，避免排序后误标其他图片。
  const images = orderedContent.flatMap((block, index) =>
    block.type === "image" ? [{ index, base64: block.data, mimeType: block.mimeType }] : [],
  );
  const browserScreenshotContentIndices = matchBrowserScreenshotImageIndices(
    images,
    facts.browserScreenshots,
  ).map((index) => images[index]!.index);

  return {
    content:
      orderedContent.length > 0 ? orderedContent : [{ type: "text" as const, text: "(no output)" }],
    ...(run.error || embedded?.isError || structuredIsError ? { isError: true } : {}),
    ...(structuredContentResult?.structuredContent !== undefined
      ? { structuredContent: structuredContentResult.structuredContent }
      : embedded?.structuredContent !== undefined
        ? { structuredContent: embedded.structuredContent }
        : {}),
    ...(Object.keys(responseMeta).length > 0 ||
    (run.images?.length ?? 0) > 0 ||
    structuredContent.some((block) => block.type === "image")
      ? {
          _meta: {
            ...responseMeta,
            ...((run.images?.length ?? 0) > 0 || structuredContent.some((block) => block.type === "image")
              ? { "zcode/nodeReplEmittedImage": true }
              : {}),
            ...(browserScreenshotContentIndices && browserScreenshotContentIndices.length > 0
              ? {
                  [ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY]:
                    browserScreenshotContentIndices,
                }
              : {}),
          },
        }
      : {}),
  };
}
