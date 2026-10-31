/* eslint-disable max-lines -- App 用量跨进程协议的 schema 与类型集中维护。 */
import { z } from "zod";

export const ESTIMATED_TOKEN_CHAR_DIVISOR = 3;

// OpenZWork 净化：官方 Coding Plan 用量 / Start Plan 权益 / BigModel monitor 接口类型不随上游恢复；
// 本文件只保留 App Usage（agent 数据库本地统计）协议面。
// ── App Usage（agent 数据库真实统计）────────────────────────────────
export const APP_USAGE_RANGES = ["all", "7d", "30d"] as const;
export type AppUsageRange = (typeof APP_USAGE_RANGES)[number];

export const appUsageFavoriteModelSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
  share: z.number(),
});

export const appUsageSummarySchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheHitRate: z.number(),
  totalSessions: z.number(),
  totalTurns: z.number(),
  toolCallCount: z.number(),
  toolErrorRate: z.number(),
  modelErrorRate: z.number(),
  avgTimeToFirstTokenMs: z.number().nullable(),
  avgTurnDurationMs: z.number().nullable(),
  activeDays: z.number(),
  currentStreakDays: z.number(),
  longestSessionMs: z.number(),
  longestStreakDays: z.number(),
  peakDayTokens: z.number(),
  favoriteModel: appUsageFavoriteModelSchema.nullable(),
});

export const appUsageHeatmapCellSchema = z.object({
  date: z.string(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  totalTokens: z.number(),
  turnCount: z.number(),
  toolCallCount: z.number(),
});

export const appUsageHeatmapWeekSchema = z.object({
  weekIndex: z.number(),
  days: z.array(appUsageHeatmapCellSchema.nullable()),
});

export const appUsageHeatmapSchema = z.object({
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  maxTokens: z.number(),
  weeks: z.array(appUsageHeatmapWeekSchema),
});

export const appUsageDailyModelItemSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
});

export const appUsageDailyModelUsageSchema = z.object({
  date: z.string(),
  models: z.array(appUsageDailyModelItemSchema),
});

export const appUsageModelUsageSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  requestCount: z.number(),
  share: z.number(),
});

export const appUsageToolUsageSchema = z.object({
  toolName: z.string(),
  callCount: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  avgDurationMs: z.number().nullable(),
});

export const appUsageProjectSchema = z.object({ id: z.string(), name: z.string() });
export const appUsageSessionSchema = z.object({
  sessionId: z.string(),
  title: z.string().nullable(),
  mainTokens: z.number().nonnegative(),
  subagentTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  childSessionCount: z.number().int().nonnegative(),
});
export type AppUsageSession = z.infer<typeof appUsageSessionSchema>;
export const appUsageSessionTotalsSchema = z.object({
  mainTokens: z.number().nonnegative(),
  subagentTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
});
export const appUsageQueryParamsSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES),
    timeZone: z.string().optional(),
    until: z.number().int().nonnegative().optional(),
    sessionIds: z.array(z.string().min(1).max(512)).max(100000).optional(),
  })
  .strict();
export const appUsageSessionsParamsSchema = appUsageQueryParamsSchema
  .extend({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const appUsageSessionsResultSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES),
    generatedAt: z.number(),
    timeZone: z.string(),
    source: z.literal("agent-db"),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    rows: z.array(appUsageSessionSchema),
    totalCount: z.number().int().nonnegative(),
    childSessionCount: z.number().int().nonnegative(),
    totals: appUsageSessionTotalsSchema,
  })
  .strict();
export type AppUsageSessionsResult = z.infer<typeof appUsageSessionsResultSchema>;
export const appUsageSessionsPageSchema = appUsageSessionsResultSchema.extend({
  rows: z.array(
    appUsageSessionSchema.extend({
      membership: z.enum(["project", "unassigned", "not-in-task-list"]),
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
    }),
  ),
  projects: z.array(appUsageProjectSchema),
  projectId: z.string().nullable().optional(),
});
export type AppUsageSessionsPage = z.infer<typeof appUsageSessionsPageSchema>;
export const APP_USAGE_PROJECT_NOT_FOUND = "project-not-found";

export const appUsageSnapshotSchema = z.object({
  range: z.enum(APP_USAGE_RANGES),
  generatedAt: z.number(),
  timeZone: z.string(),
  source: z.literal("agent-db"),
  projects: z.array(appUsageProjectSchema).optional(),
  projectId: z.string().nullable().optional(),
  summary: appUsageSummarySchema,
  heatmap: appUsageHeatmapSchema,
  dailyModelUsage: z.array(appUsageDailyModelUsageSchema),
  models: z.array(appUsageModelUsageSchema),
  tools: z.array(appUsageToolUsageSchema),
});

export type AppUsageSummary = z.infer<typeof appUsageSummarySchema>;
export type AppUsageHeatmapCell = z.infer<typeof appUsageHeatmapCellSchema>;
export type AppUsageHeatmapWeek = z.infer<typeof appUsageHeatmapWeekSchema>;
export type AppUsageHeatmap = z.infer<typeof appUsageHeatmapSchema>;
export type AppUsageDailyModelItem = z.infer<typeof appUsageDailyModelItemSchema>;
export type AppUsageDailyModelUsage = z.infer<typeof appUsageDailyModelUsageSchema>;
export type AppUsageModelUsage = z.infer<typeof appUsageModelUsageSchema>;
export type AppUsageToolUsage = z.infer<typeof appUsageToolUsageSchema>;
export type AppUsageFavoriteModel = z.infer<typeof appUsageFavoriteModelSchema>;
export type AppUsageSnapshot = z.infer<typeof appUsageSnapshotSchema>;

/** AI 只读查询使用与统计页相同的 Host 服务；项目 ID 只由 Host 解释。 */
export const appUsageToolParamsSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES).default("30d"),
    projectId: z.string().min(1).max(512).nullable().optional(),
    timeZone: z.string().max(100).optional(),
  })
  .strict();
export const appUsageToolResultSchema = z.object({ report: z.string().max(128000) }).strict();
