// ============================================================
// OpenAI Responses provider-native WebSearch encoding
// ============================================================

// OpenZWork(OZ-C013): Responses 协议的原生搜索。
// `WebSearch` 的内部 provider-native 请求在 providerKind=openai 时编码为
// `openai.tools.webSearch`（服务端 `web_search` 工具）。`allowed_domains` 透传为
// `filters.allowedDomains`；`maxUses` 只影响搜索次数上限，忽略不影响正确性。
// 屏蔽域名没有对应参数，静默忽略会让模型拿到它明确要排除的来源，因此在编码阶段
// 报错、不发出请求（spec WSR-04）。
import { openai } from "@ai-sdk/openai";
import type { TextStreamPart, ToolSet } from "ai";
import { ModelErrorCode, type ModelStreamEvent } from "@zcode/contracts";
import { AiSdkModelAdapterError } from "./errors.js";

export function toOpenAiResponsesWebSearchTool(input: {
  allowedDomains?: string[];
  blockedDomains?: string[];
}): ToolSet[string] {
  if (input.blockedDomains && input.blockedDomains.length > 0) {
    throw new AiSdkModelAdapterError(
      ModelErrorCode.InvalidModelRequest,
      "OpenAI Responses web_search does not support blocked_domains filtering",
    );
  }

  return openai.tools.webSearch(
    input.allowedDomains && input.allowedDomains.length > 0
      ? { filters: { allowedDomains: input.allowedDomains } }
      : {},
  ) as ToolSet[string];
}

export function toOpenAiResponsesWebSearchSource(
  chunk: Extract<TextStreamPart<ToolSet>, { type: "source" }>,
): ModelStreamEvent | undefined {
  if (chunk.sourceType !== "url" || !/^https?:\/\//i.test(chunk.url) || !URL.canParse(chunk.url)) {
    return undefined;
  }
  const { id, title, url } = chunk;
  return { type: "source", source: { type: "source", sourceType: "url", id, title, url } };
}
