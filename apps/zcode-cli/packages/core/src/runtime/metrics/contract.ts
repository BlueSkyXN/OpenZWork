import type { ModelNetworkStatusEvent, ModelUsage } from "@zcode/contracts";
import {
  mergeMetrics,
  metricsUsageSchema,
  type ConversationMetrics,
} from "@zcode/shared/conversation-metrics";

/** 一次逻辑 model step 的有界摘要；不含旁路，不保留 prompt、headers 或响应正文。 */
export function buildModelStepMetrics(
  events: readonly ModelNetworkStatusEvent[],
  querySource: string,
  status: "completed" | "error" | "cancelled",
  fallbackUsage?: ModelUsage,
): ConversationMetrics {
  const terminals = new Map<
    string,
    Extract<ModelNetworkStatusEvent, { type: "model_request_completed" | "model_request_failed" }>
  >();
  for (const event of events) {
    if (event.querySource !== undefined && event.querySource !== querySource) continue;
    if (event.type !== "model_request_completed" && event.type !== "model_request_failed") continue;
    const key = `${event.requestId}:${event.attempt}`;
    if (!terminals.has(key)) terminals.set(key, event);
  }
  let summary: ConversationMetrics = { requestCount: 0, failureCount: 0, unknownUsageCount: 0 };
  const values = [...terminals.values()];
  if (values.length === 0) {
    const usage = metricsUsageSchema.safeParse(fallbackUsage);
    return {
      requestCount: 1,
      failureCount: status === "completed" ? 0 : 1,
      unknownUsageCount: usage.success ? 0 : 1,
      ...(usage.success
        ? { usage: usage.data, ...(status !== "completed" ? { failedUsage: usage.data } : {}) }
        : {}),
      latest: { status: status === "completed" ? "completed" : "failed" },
    };
  }
  for (const event of values) {
    const completed = event.type === "model_request_completed";
    const usage = metricsUsageSchema.safeParse(event.usage);
    summary = mergeMetrics(summary, {
      requestCount: 1,
      failureCount: completed ? 0 : 1,
      unknownUsageCount: usage.success ? 0 : 1,
      ...(usage.success
        ? { usage: usage.data, ...(!completed ? { failedUsage: usage.data } : {}) }
        : {}),
      latest: {
        status: completed ? "completed" : "failed",
        ...(validDuration(event.durationMs) ? { durationMs: event.durationMs } : {}),
        ...(completed && validDuration(event.timeToFirstContentMs)
          ? { timeToFirstContentMs: event.timeToFirstContentMs }
          : {}),
        ...(completed && validDuration(event.timeToFirstTextMs)
          ? { timeToFirstTextMs: event.timeToFirstTextMs }
          : {}),
        ...(usage.success ? { outputTokens: usage.data.outputTokens } : {}),
      },
    });
  }
  return summary;
}
function validDuration(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
