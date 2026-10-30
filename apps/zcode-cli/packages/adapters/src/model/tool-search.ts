import { TOOL_SEARCH_BETA, type Model, type ToolSearchCapability } from "@zcode/contracts";

const ANTHROPIC_MESSAGES_API_TYPE = "anthropic-messages";

export function resolveToolSearchCapability(
  apiType: string,
  _access: { type: string; mode?: string },
): ToolSearchCapability {
  // OpenZWork 净化：上游按 zhipu coding-plan 套餐 entitlement 默认开启 ToolSearch；
  // 我方无官方套餐域，默认保持关闭，仅协议能力判定随上游用常量。
  const protocolSupported = apiType === ANTHROPIC_MESSAGES_API_TYPE;
  return Object.freeze({ protocolSupported, defaultEnabled: false });

}

export function toolSearchHeaders(headers: Record<string, string> | undefined, enabled?: boolean) {
  if (!enabled) return headers;
  const result = { ...headers };
  const key =
    Object.keys(result).find((name) => name.toLowerCase() === "anthropic-beta") ?? "anthropic-beta";
  result[key] = [
    ...new Set([
      ...(result[key]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? []),
      TOOL_SEARCH_BETA,
    ]),
  ].join(",");
  return result;
}

/** 模型请求能力只由协议与接入方式决定；core 投影据此选择请求形态。 */
export function resolveModelRequestCapabilities(
  apiType: string,
  access: { type: string; mode?: string },
): NonNullable<Model["requestCapabilities"]> {
  return {
    toolSearch: resolveToolSearchCapability(apiType, access),
    // 只在 Anthropic Messages 协议把提醒并入 tool result；OpenAI 兼容协议保持独立的 user 消息。
    foldRemindersIntoToolResults: apiType === ANTHROPIC_MESSAGES_API_TYPE,
  };
}
