// OpenZWork 净化口径：上游本文件承载 ARMS/产品遥测（renderer 事件 schema、sanitizer、plan 身份快照）。
// 净化后仅保留 conversation-telemetry 远端链（移动端远端会话事件发往用户自建远端 server）所需的
// 最小事件形态与清洗函数；本地不再上报 ARMS，UI mode 归一化退化为透传。
export interface TelemetryEventPayload {
  elementName: string;
  eventType: string;
  eventRegion?: string;
  eventText?: string;
  eventExtraDetail: Record<string, string | number | boolean | null | undefined>;
  context?: Record<string, unknown>;
  userId?: string;
  talkId?: string;
  messageId?: string;
}

const TELEMETRY_TEXT_MAX_LENGTH = 512;
const TELEMETRY_EVENT_DETAIL_MAX_KEYS = 40;

export function normalizeTelemetryUiMode(value: unknown): string {
  return typeof value === "string" && value ? value : "unknown";
}

export function sanitizeTelemetryEventDetail(
  elementName: string,
  detail: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(detail).slice(0, TELEMETRY_EVENT_DETAIL_MAX_KEYS)) {
    if (value === undefined) continue;
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean" || value === null
          ? String(value)
          : JSON.stringify(value);
    out[key] =
      text.length > TELEMETRY_TEXT_MAX_LENGTH ? text.slice(0, TELEMETRY_TEXT_MAX_LENGTH) : text;
  }
  void elementName;
  return out;
}

export function sanitizeTelemetrySkillName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
}

// 上游 PlanIdentitySnapshot 取自 usage-stats（官方套餐域）。净化后远端事件只保留
// 归因所需的两个字段；无套餐上下文时由调用方传 null。
export interface PlanIdentitySnapshot {
  generatedAt?: number;
  planStatus: string;
  planProductId: string;
}
