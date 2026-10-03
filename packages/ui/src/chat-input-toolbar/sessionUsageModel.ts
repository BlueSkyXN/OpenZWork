import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";

export type SessionCumulativeUsage = SessionUsageState["cumulative"];

export interface SessionUsageSummaryModel extends SessionCumulativeUsage {
  totalTokens: number;
}

export function buildSessionUsageSummary(
  usage: SessionCumulativeUsage | null | undefined,
): SessionUsageSummaryModel | null {
  if (!usage) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage;
  const counts = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;

  // 缓存读写已计入输入 token，累计总量不能再次相加。
  const totalTokens = inputTokens + outputTokens;
  if (!Number.isSafeInteger(totalTokens)) return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens };
}
