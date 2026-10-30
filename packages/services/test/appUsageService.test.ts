import assert from "node:assert/strict";
import { test } from "vitest";
import { appUsageSnapshotSchema, appUsageSessionsPageSchema } from "@zcode/shared";
import {
  buildAppUsageToolReport,
  createAppUsageService,
} from "../src/app-usage/appUsageService.js";

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

const EMPTY_PAGE = appUsageSessionsPageSchema.parse({
  range: "30d",
  timeZone: "UTC",
  generatedAt: 1,
  source: "agent-db",
  offset: 0,
  limit: 50,
  projects: [],
  rows: [],
  totalCount: 0,
  childSessionCount: 0,
  totals: { mainTokens: 0, subagentTokens: 0, totalTokens: 0 },
});

test("tool report retains query scope and totals while bounding UTF-8 lists", () => {
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    projectId: "p-a",
    projects: [{ id: "p-a", name: "项目 A" }],
    sessions: Array.from({ length: 200 }, (_, index) => ({
      sessionId: `session-${index}`,
      title: "标题".repeat(1000),
      mainTokens: 100,
      subagentTokens: 20,
      totalTokens: 120,
      requestCount: 1,
    })),
    sessionsTotalCount: 300,
  };
  const page = {
    ...EMPTY_PAGE,
    rows: snapshot.sessions.map((row) => ({
      ...row,
      childSessionCount: 1,
      membership: "project" as const,
      projectId: "p-a",
      projectName: "A",
    })),
    totalCount: 300,
  };
  const serialized = buildAppUsageToolReport(snapshot, page);
  const report = JSON.parse(serialized);
  assert.ok(Buffer.byteLength(serialized, "utf8") <= 120_000);
  assert.deepEqual(report.summary, snapshot.summary);
  assert.deepEqual(report.projects, snapshot.projects);
  assert.equal(report.projectId, "p-a");
  assert.equal(report.sessionsTotalCount, 300);
  assert.equal(report.truncated, true);
  assert.ok(report.sessions.length > 0 && report.sessions.length < 200);
  assert.equal(snapshot.sessions.length, 200);
});

test("small tool report keeps every entry and declares its retention", () => {
  const report = JSON.parse(buildAppUsageToolReport(EMPTY_SNAPSHOT, EMPTY_PAGE));
  assert.equal(report.truncated, false);
  assert.equal(report.retentionDays, 30);
  assert.equal(report.generatedAt, EMPTY_SNAPSHOT.generatedAt);
  assert.deepEqual(report.summary, EMPTY_SNAPSHOT.summary);
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

test("project membership comes from Host task IDs, including empty and moved projects", async () => {
  const tree = {
    projects: [
      { id: "p-a", name: "A", deleted: false },
      { id: "p-b", name: "B", deleted: false },
    ],
    tasks: [
      { taskId: "session-a", projectId: "p-a", workspacePath: "/same" },
      { taskId: "session-b", projectId: "p-b", workspacePath: "/same" },
      { taskId: "session-none", projectId: null, workspacePath: "/same" },
    ],
  };
  const requests: import("../src/app-usage/appUsage.js").AppUsageStatsParams[] = [];
  const service = createAppUsageService({
    runtimeSurface: "desktop_local_host",
    serviceAuthorityMode: "desktop-local",
    readProjectTree: async () =>
      tree as unknown as import("../src/project/contract.js").ProjectTree,
    zcodeAgentService: {
      async getAppUsageStats(params) {
        requests.push(params);
        return { ...EMPTY_SNAPSHOT, sessions: [], sessionsTotalCount: 0 };
      },
    },
  });
  const a = await service.getAppUsageStats({
    range: "30d",
    projectId: "p-a",
    includeProjects: true,
  });
  assert.deepEqual(requests.at(-1)?.sessionIds, ["session-a"]);
  assert.deepEqual(a.projects, [
    { id: "p-a", name: "A" },
    { id: "p-b", name: "B" },
  ]);
  tree.tasks[0]!.projectId = "p-b";
  await service.getAppUsageStats({ range: "30d", projectId: "p-a" });
  assert.deepEqual(requests.at(-1)?.sessionIds, []);
  await service.getAppUsageStats({ range: "7d", projectId: null });
  assert.deepEqual(requests.at(-1)?.sessionIds, ["session-none"]);
  await service.getAppUsageStats({ range: "all", includeProjects: true });
  assert.equal(requests.at(-1)?.sessionIds, undefined);
  const count = requests.length;
  await assert.rejects(
    service.getAppUsageStats({ range: "7d", projectId: "missing" }),
    /项目不存在/,
  );
  assert.equal(requests.length, count);
});

test("overview avoids details; paged rows use the same Host scope and label removed tasks", async () => {
  const tree = {
    projects: [
      { id: "a", name: "A", deleted: false },
      { id: "deleted", name: "Old", deleted: true },
    ],
    tasks: [
      { taskId: "a", projectId: "a" },
      { taskId: "none", projectId: null },
      { taskId: "old-project", projectId: "deleted" },
    ],
  };
  let reads = 0,
    detailsCalls = 0;
  const rows = ["a", "none", "old-project", "removed"].map((sessionId, index) => ({
    sessionId,
    title: null,
    mainTokens: (index + 1) * 10,
    subagentTokens: 0,
    totalTokens: (index + 1) * 10,
    requestCount: 1,
    childSessionCount: 0,
  }));
  const select = (ids?: readonly string[]) =>
    rows.filter((row) => ids === undefined || ids.includes(row.sessionId));
  const service = createAppUsageService({
    runtimeSurface: "desktop_local_host",
    serviceAuthorityMode: "desktop-local",
    readProjectTree: async () => {
      reads++;
      return tree as unknown as import("../src/project/contract.js").ProjectTree;
    },
    zcodeAgentService: {
      async getAppUsageStats(params) {
        return {
          ...EMPTY_SNAPSHOT,
          summary: {
            ...EMPTY_SNAPSHOT.summary,
            totalTokens: select(params.sessionIds).reduce((a, r) => a + r.totalTokens, 0),
          },
        };
      },
      async getAppUsageSessions(params) {
        detailsCalls++;
        assert.equal(params.until, 100);
        const chosen = select(params.sessionIds);
        return {
          ...EMPTY_PAGE,
          rows: chosen.slice(params.offset, params.offset + params.limit),
          totalCount: chosen.length,
          totals: {
            mainTokens: chosen.reduce((a, r) => a + r.mainTokens, 0),
            subagentTokens: 0,
            totalTokens: chosen.reduce((a, r) => a + r.totalTokens, 0),
          },
        };
      },
    },
  });
  const overview = await service.getAppUsageStats({
    range: "30d",
    includeProjects: true,
    until: 100,
  });
  assert.equal(detailsCalls, 0);
  assert.equal(reads, 1);
  const all = await service.getAppUsageSessions({ range: "30d", offset: 0, limit: 50, until: 100 });
  assert.equal(reads, 2);
  assert.equal(all.totals.totalTokens, overview.summary.totalTokens);
  assert.deepEqual(
    all.rows.map((row) => row.membership),
    ["project", "unassigned", "unassigned", "not-in-task-list"],
  );
  const a = await service.getAppUsageSessions({
    range: "30d",
    projectId: "a",
    offset: 0,
    limit: 50,
    until: 100,
  });
  const none = await service.getAppUsageSessions({
    range: "30d",
    projectId: null,
    offset: 0,
    limit: 50,
    until: 100,
  });
  assert.equal(
    a.totals.totalTokens +
      none.totals.totalTokens +
      all.rows
        .filter((r) => r.membership === "not-in-task-list")
        .reduce((n, r) => n + r.totalTokens, 0),
    all.totals.totalTokens,
  );
  await assert.rejects(
    service.getAppUsageSessions({
      range: "30d",
      projectId: "deleted",
      offset: 0,
      limit: 50,
      until: 100,
    }),
    { code: "project-not-found" },
  );
});
