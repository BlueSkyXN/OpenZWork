import type {
  AppUsageStatsParams,
  CreateAppUsageServiceOptions,
  IAppUsageService,
} from "./appUsage.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  APP_USAGE_PROJECT_NOT_FOUND,
  type AppUsageSnapshot,
  type AppUsageSessionsPage,
} from "@zcode/shared";
import type { ProjectTree } from "../project/contract.js";

const logger = createServiceLogger("app-usage-service");
const MAX_TOOL_REPORT_BYTES = 120_000;

/** 大列表只裁剪报告投影；保留完整汇总、总条数和合法 JSON，避免工具预算截断 JSON。 */
export function buildAppUsageToolReport(
  snapshot: AppUsageSnapshot,
  page: AppUsageSessionsPage,
): string {
  const report = {
    range: snapshot.range,
    timeZone: snapshot.timeZone,
    generatedAt: snapshot.generatedAt,
    retentionDays: 30,
    source: snapshot.source,
    projectId: snapshot.projectId,
    summary: snapshot.summary,
    projects: [...(snapshot.projects ?? [])],
    models: [...snapshot.models],
    sessions: [...page.rows],
    sessionTotals: page.totals,
    childSessionCount: page.childSessionCount,
    projectsTotalCount: snapshot.projects?.length ?? 0,
    modelsTotalCount: snapshot.models.length,
    sessionsTotalCount: page.totalCount,
    truncated: page.totalCount > page.rows.length,
  };
  const lists = [report.projects, report.models, report.sessions];
  let serialized = JSON.stringify(report);
  while (Buffer.byteLength(serialized, "utf8") > MAX_TOOL_REPORT_BYTES) {
    const largest = lists.reduce((left, right) =>
      Buffer.byteLength(JSON.stringify(left), "utf8") >=
      Buffer.byteLength(JSON.stringify(right), "utf8")
        ? left
        : right,
    );
    if (!largest.length) throw new Error("Usage summary exceeds the report size limit");
    largest.splice(Math.floor(largest.length / 2));
    report.truncated = true;
    serialized = JSON.stringify(report);
  }
  return serialized;
}

/** Host 归属同一请求只读一次；过往被移除的项目下现存任务按未归类处理。 */
export function resolveUsageScope(tree: ProjectTree, projectId?: string | null) {
  const projects = tree.projects.filter((project) => !project.deleted);
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  if (projectId != null && !projectMap.has(projectId)) {
    throw Object.assign(new Error("项目不存在或已删除，请重新选择项目"), {
      code: APP_USAGE_PROJECT_NOT_FOUND,
    });
  }
  const tasks = new Map(tree.tasks.map((task) => [task.taskId, task]));
  const membership = (
    sessionId: string,
  ): Pick<AppUsageSessionsPage["rows"][number], "membership" | "projectId" | "projectName"> => {
    const task = tasks.get(sessionId);
    if (!task) return { membership: "not-in-task-list", projectId: null, projectName: null };
    const project = task.projectId ? projectMap.get(task.projectId) : undefined;
    return project
      ? { membership: "project", projectId: project.id, projectName: project.name }
      : { membership: "unassigned", projectId: null, projectName: null };
  };
  return {
    projects: projects.map(({ id, name }) => ({ id, name })),
    membership,
    sessionIds:
      projectId === undefined
        ? undefined
        : [
            ...new Set(
              tree.tasks
                .filter((task) => membership(task.taskId).projectId === projectId)
                .map((task) => task.taskId),
            ),
          ],
  };
}

/** 仅通过可信本机 Host 查询用量事实，不保存快照或维护第二份归属。 */
export function createAppUsageService(options: CreateAppUsageServiceOptions): IAppUsageService {
  const requireLocal = () => {
    if (
      options.runtimeSurface !== "desktop_local_host" ||
      options.serviceAuthorityMode !== "desktop-local"
    )
      throw new Error("本地 App Usage 仅支持 Desktop 本地 Host");
  };
  const scopeFor = async (projectId?: string | null) => {
    if (!options.readProjectTree) throw new Error("项目用量查询不可用，请更新本地 Host");
    return resolveUsageScope(await options.readProjectTree(), projectId);
  };
  const base = (params: AppUsageStatsParams) => ({
    range: params.range,
    ...(params.timeZone ? { timeZone: params.timeZone } : {}),
    ...(params.until !== undefined ? { until: params.until } : {}),
  });
  return {
    async getAppUsageStats(params) {
      requireLocal();
      try {
        if (!params.includeProjects && params.projectId === undefined)
          return await options.zcodeAgentService.getAppUsageStats(base(params));
        const scope = await scopeFor(params.projectId);
        const snapshot = await options.zcodeAgentService.getAppUsageStats({
          ...base(params),
          ...(scope.sessionIds !== undefined ? { sessionIds: scope.sessionIds } : {}),
        });
        return {
          ...snapshot,
          projects: scope.projects,
          ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
        };
      } catch (error) {
        logger.warn("读取 App Usage 快照失败", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    async getAppUsageSessions(params) {
      requireLocal();
      if (!options.zcodeAgentService.getAppUsageSessions)
        throw new Error("当前 Agent 不支持会话分页查询");
      const scope = await scopeFor(params.projectId);
      const page = await options.zcodeAgentService.getAppUsageSessions({
        ...base(params),
        offset: params.offset,
        limit: params.limit,
        ...(scope.sessionIds !== undefined ? { sessionIds: scope.sessionIds } : {}),
      });
      return {
        ...page,
        projects: scope.projects,
        ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
        rows: page.rows.map((row) => ({ ...row, ...scope.membership(row.sessionId) })),
      };
    },
  };
}
