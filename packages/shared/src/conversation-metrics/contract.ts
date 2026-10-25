import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = z.number().nonnegative();
export const metricsUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
});
export type MetricsUsage = z.infer<typeof metricsUsageSchema>;
export const latestRequestMetricsSchema = z.object({
  status: z.enum(["completed", "failed"]),
  durationMs: duration.optional(),
  timeToFirstContentMs: duration.optional(),
  timeToFirstTextMs: duration.optional(),
  outputTokens: count.optional(),
});
export type LatestRequestMetrics = z.infer<typeof latestRequestMetricsSchema>;
/** 有界结算摘要；usage 包含已报告失败消耗，failedUsage 是其中的子集。 */
export const conversationMetricsSchema = z.object({
  requestCount: count,
  failureCount: count,
  unknownUsageCount: count,
  usage: metricsUsageSchema.optional(),
  failedUsage: metricsUsageSchema.optional(),
  latest: latestRequestMetricsSchema.optional(),
});
export type ConversationMetrics = z.infer<typeof conversationMetricsSchema>;
export const modelStepMetricsSchema = conversationMetricsSchema.extend({
  messageId: z.string().min(1),
  /** 主链成功 result 的既有累计口径；只在冷重建时使用。 */
  mainUsage: metricsUsageSchema.optional(),
});
export type ModelStepMetrics = z.infer<typeof modelStepMetricsSchema>;

export function mergeMetricsUsage(
  a: MetricsUsage | undefined,
  b: MetricsUsage | undefined,
): MetricsUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cacheReadTokens !== undefined && b.cacheReadTokens !== undefined
      ? { cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens }
      : {}),
    ...(a.cacheWriteTokens !== undefined && b.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens }
      : {}),
  };
}

/** 只合并独立事实；调用方负责 messageId/requestId 的去重。 */
export function mergeMetrics(
  a: ConversationMetrics | undefined,
  b: ConversationMetrics,
): ConversationMetrics {
  return {
    requestCount: (a?.requestCount ?? 0) + b.requestCount,
    failureCount: (a?.failureCount ?? 0) + b.failureCount,
    unknownUsageCount: (a?.unknownUsageCount ?? 0) + b.unknownUsageCount,
    usage: mergeMetricsUsage(a?.usage, b.usage),
    failedUsage: mergeMetricsUsage(a?.failedUsage, b.failedUsage),
    latest: b.latest,
  };
}

export function tokensPerSecond(latest: LatestRequestMetrics | undefined): number | null {
  if (
    !latest ||
    latest.status !== "completed" ||
    latest.outputTokens === undefined ||
    latest.durationMs === undefined ||
    latest.timeToFirstContentMs === undefined
  )
    return null;
  const generationMs = latest.durationMs - latest.timeToFirstContentMs;
  return generationMs > 0 ? (latest.outputTokens * 1000) / generationMs : null;
}

/** 子任务读取现有 durable parts；旧记录未知，重复 part 不累计。 */
export function metricsFromParts(
  parts: readonly { type: string; modelMetrics?: unknown }[],
): ConversationMetrics | undefined {
  const seen = new Set<string>();
  let summary: ConversationMetrics | undefined;
  for (const part of parts) {
    if (part.type !== "step-start") continue;
    const parsed = modelStepMetricsSchema.safeParse(part.modelMetrics);
    if (!parsed.success || seen.has(parsed.data.messageId)) continue;
    seen.add(parsed.data.messageId);
    summary = mergeMetrics(summary, parsed.data);
  }
  return summary;
}
