import assert from "node:assert/strict";
import test from "node:test";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { createAppUsageService } from "../src/app-usage/appUsageService.js";

const EMPTY_SNAPSHOT = appUsageSnapshotSchema.parse({
  range: "30d",
  generatedAt: 1,
  timeZone: "UTC",
  source: "agent-db",
  summary: {
    totalTokens: 0,
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
    currentStreakDays: 0,
    longestSessionMs: 0,
    longestStreakDays: 0,
    peakDayTokens: 0,
    favoriteModel: null,
  },
  heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
  dailyModelUsage: [],
  models: [],
  tools: [],
});

test("only a confirmed Desktop local Host may query the local usage facade", async () => {
  let calls = 0;
  const service = createAppUsageService({
    runtimeSurface: "desktop_local_host",
    serviceAuthorityMode: "desktop-local",
    zcodeAgentService: {
      async getAppUsageStats(params) {
        calls += 1;
        assert.deepEqual(params, {
          range: "7d",
          timeZone: "Asia/Kolkata",
        });
        return EMPTY_SNAPSHOT;
      },
    },
  });
  const snapshot = await service.getAppUsageStats({ range: "7d", timeZone: "Asia/Kolkata" });
  assert.equal(snapshot.source, "agent-db");
  assert.equal(calls, 1);
});

test("unconfirmed and remote authorities fail closed without an Agent request", async () => {
  let calls = 0;
  for (const authority of [
    {
      runtimeSurface: "remote_workspace_host" as const,
      serviceAuthorityMode: "desktop-attached-remote" as const,
    },
    { runtimeSurface: undefined, serviceAuthorityMode: "standalone-server" as const },
  ]) {
    const service = createAppUsageService({
      ...authority,
      zcodeAgentService: {
        async getAppUsageStats() {
          calls += 1;
          return EMPTY_SNAPSHOT;
        },
      },
    });
    await assert.rejects(service.getAppUsageStats({ range: "all" }), /Desktop 本地 Host/);
  }
  assert.equal(calls, 0);
});
