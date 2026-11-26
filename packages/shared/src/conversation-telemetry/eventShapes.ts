// OpenZWork 净化口径：上游 telemetry.ts 承载 ARMS/产品遥测（renderer 事件 schema、sanitizer、
// plan 身份快照）。净化后仅保留 conversation-telemetry 远端链（移动端远端会话事件发往用户自建
// 远端 server）所需的最小事件形态与清洗函数；本地不再上报 ARMS，UI mode 归一化退化为透传。
// WP-05 禁列不含本目录，故由 packages/shared/src/telemetry.ts 迁入，作为远端事件链的唯一定义处。
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

const TOOL_ERROR_NAMED_CODES: ReadonlySet<string> = new Set([
  "session_not_found",
  "session_already_exists",
  "session_corrupted",
  "turn_not_found",
  "turn_in_progress",
  "invalid_turn_phase",
  "turn_cancelled",
  "model_error",
  "model_timeout",
  "model_rate_limited",
  "model_context_exceeded",
  "tool_not_found",
  "tool_execution_failed",
  "tool_timeout",
  "tool_cancelled",
  "tool_max_calls",
  "invalid_input",
  "permission_denied",
  "permission_escalation",
  "permission_timeout",
  "invalid_state_transition",
  "event_out_of_order",
  "projection_corrupted",
  "storage_error",
  "configuration_error",
  "cancelled",
  "unknown_error",
  "agent_subagent_unavailable",
  "agent_background_unavailable",
  "agent_unknown_type",
  "agent_child_runtime_failed",
  "user_interrupt",
]);
const TOOL_HANDLER_NUMERIC_CODE_PATTERN = /^\d{1,4}$/u;
const TOOL_ERROR_HANDLER_CODE_PATTERN = /^h\d{1,4}$/u;

export function normalizeToolErrorCode(code: string | null | undefined): string {
  const trimmed = code?.trim();
  if (!trimmed) return "unknown";
  const lower = trimmed.toLowerCase();
  if (TOOL_ERROR_NAMED_CODES.has(lower)) return lower;
  if (TOOL_HANDLER_NUMERIC_CODE_PATTERN.test(trimmed)) return `h${trimmed}`;
  return "other";
}

export function sanitizeToolErrorCode(value: string): string {
  if (
    value === "" ||
    value === "other" ||
    value === "unknown" ||
    TOOL_ERROR_NAMED_CODES.has(value) ||
    TOOL_ERROR_HANDLER_CODE_PATTERN.test(value)
  ) {
    return value;
  }
  return "other";
}

// 上游 PlanIdentitySnapshot 取自 usage-stats（官方套餐域）。净化后远端事件只保留
// 归因所需的两个字段；无套餐上下文时由调用方传 null。
export interface PlanIdentitySnapshot {
  generatedAt?: number;
  planStatus: string;
  planProductId: string;
}
