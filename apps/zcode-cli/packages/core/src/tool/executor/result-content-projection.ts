import {
  modelMessageContentToText,
  type ModelMessageContent,
  type ModelMessageContentBlock,
} from "@zcode/contracts";
import type { ToolEntry, ToolResultSerialization } from "../types.js";

const TOOL_REFERENCE_TEXT_TRUNCATION_MARKER = "[Tool result text truncated by resultBudget]";

export function projectToolReferenceContent(
  modelContent: ModelMessageContent,
  maxTextBytes: number,
  direction: "head" | "tail",
):
  | Pick<ToolResultSerialization, "modelContent" | "content" | "returnedBytes" | "truncated">
  | undefined {
  if (
    !Array.isArray(modelContent) ||
    !modelContent.some((block) => block.type === "tool_reference") ||
    !modelContent.every((block) => block.type === "text" || block.type === "tool_reference")
  )
    return undefined;

  // 引用既是 schema 加载协议也是发现状态，不能按展示文本截断或转成 artifact。
  // 仅裁剪文本，原始引用及块顺序必须保留；展示内容和计量统一从最终块派生。
  const truncated = Buffer.byteLength(joinTextBlocks(modelContent), "utf8") > maxTextBytes;
  let projected: ModelMessageContentBlock[] = modelContent;
  if (truncated) {
    const marker = fitStringToBytes(TOOL_REFERENCE_TEXT_TRUNCATION_MARKER, maxTextBytes, "head");
    let remainingBytes = maxTextBytes - Buffer.byteLength(marker, "utf8");
    let hasText = marker.length > 0;
    const ordered = direction === "tail" ? [...modelContent].reverse() : modelContent;
    projected = ordered.flatMap((block): ModelMessageContentBlock[] => {
      if (block.type !== "text") return [block];
      const textBudget = Math.max(0, remainingBytes - (hasText ? 2 : 0));
      const text = fitStringToBytes(block.text, textBudget, direction);
      if (text.length > 0) {
        remainingBytes -= Buffer.byteLength(text, "utf8") + (hasText ? 2 : 0);
        hasText = true;
      }
      if (text.length < block.text.length) remainingBytes = 0;
      return text ? [{ ...block, text }] : [];
    });
    if (direction === "tail") projected.reverse();
    if (marker) projected.push({ type: "text", text: marker });
  }
  const content = stringifyModelContentForSerialization(projected);
  return {
    modelContent: projected,
    content,
    returnedBytes: Buffer.byteLength(content, "utf8"),
    truncated,
  };
}

// OpenZWork 净化：上游此处导出 Official CUA 截断标记/错误与 projectOfficialCuaStructuredContent
// （@zcode/zcode-cua 帧 contract 域）；该域已净化，保留我方 Hook 附加投影。

export function appendHookToStringContent(
  content: string,
  suffix: string,
  maxBytes: number,
  previewDirection: "head" | "tail",
): HookStringProjection {
  const augmentedContent = `${content}${suffix}`;
  if (Buffer.byteLength(augmentedContent, "utf8") <= maxBytes) {
    return { content: augmentedContent, truncated: false };
  }
  return {
    content: fitContentWithSuffix(content, maxBytes, suffix, previewDirection),

    truncated: true,
  };
}


export function appendHookToPersistedArtifactPreview(
  content: string,
  suffix: string,
  maxHookBytes: number,
): HookStringProjection {
  const fittedSuffix = fitStringToBytes(suffix, maxHookBytes, "head");
  return {
    content: `${content}${fittedSuffix}`,
    truncated: Buffer.byteLength(suffix, "utf8") > maxHookBytes,
  };
}

export function projectHookAugmentedModelContent(input: {
  artifactPreview: boolean;
  contentProjection: HookStringProjection;
  hookContext: string;
  maxModelBytes: number;
  modelContent: ModelMessageContent;
  previewDirection: "head" | "tail";
  suffix: string;
}): ModelMessageContent {
  if (input.artifactPreview) return input.contentProjection.content;
  if (!input.contentProjection.truncated) {
    return appendHookContextToModelContent(input.modelContent, input.hookContext);
  }
  if (!hasPreservedStructuredBlocks(input.modelContent)) return input.contentProjection.content;

  const textContent = budgetedTextFromStructuredContent(input.modelContent);
  const budgetedText = fitContentWithSuffix(
    textContent,
    input.maxModelBytes,
    input.suffix,
    input.previewDirection,
  );
  return [
    ...input.modelContent.filter(shouldPreserveStructuredBlock),
    ...(budgetedText.length > 0 ? [{ type: "text" as const, text: budgetedText }] : []),
  ];
}


export function fitContentWithSuffix(
  content: string,
  maxBytes: number,
  suffix: string,
  direction: "head" | "tail",
): string {
  if (maxBytes <= 0) return "";
  const suffixContent = fitStringToBytes(suffix, maxBytes, "head");
  const remainingBytes = maxBytes - Buffer.byteLength(suffixContent, "utf8");
  if (remainingBytes <= 0) return suffixContent;
  return `${fitStringToBytes(content, remainingBytes, direction)}${suffixContent}`;
}

function joinTextBlocks(content: ModelMessageContentBlock[]): string {
  return content
    .filter(
      (block): block is Extract<ModelMessageContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

export function stringifyModelContentForSerialization(content: ModelMessageContent): string {
  return typeof content === "string" ? content : modelMessageContentToText(content);
}

export function isEmptyModelContent(content: ModelMessageContent): boolean {
  if (typeof content === "string") return content.trim() === "";
  if (content.length === 0) return true;
  return content.every((block) => {
    if (block.type !== "text") return false;
    return typeof block.text !== "string" || block.text.trim() === "";
  });
}

export function stringifyOutputForModel(output: unknown, entry: ToolEntry): ModelMessageContent {
  if (entry.formatModelContent) return entry.formatModelContent(output);
  if (typeof output === "string") return output;
  if (output === undefined) return "";

  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return String(output);
  }
}

function fitStringToBytes(value: string, maxBytes: number, direction: "head" | "tail"): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate =
      direction === "tail"
        ? chars.slice(chars.length - mid).join("")
        : chars.slice(0, mid).join("");
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return direction === "tail"
    ? chars.slice(chars.length - low).join("")
    : chars.slice(0, low).join("");
}
