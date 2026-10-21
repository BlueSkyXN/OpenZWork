import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";

export function createSnapshot(
  overrides: Partial<AppUsageSnapshot> & { range?: AppUsageRange } = {},
): AppUsageSnapshot {
  return {
    range: overrides.range ?? "all",
    generatedAt: 0,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 20_650_000_000,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 0,
      totalTurns: 0,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 0,
      currentStreakDays: 5,
      longestSessionMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
      longestStreakDays: 34,
      peakDayTokens: 370_000_000,
      favoriteModel: null,
    },
    heatmap: {
      startDate: null,
      endDate: null,
      maxTokens: 370_000_000,
      weeks: [],
    },
    dailyModelUsage: [],
    models: [],
    tools: [],
    ...overrides,
  };
}

