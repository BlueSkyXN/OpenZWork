import type {
  ProjectAvailability,
  ProjectTask,
  ProjectTree,
  ProjectSidebarView,
  VirtualProject,
} from "@/project-sidebar/contract.js";
import {
  getTaskListAttention,
  getTaskListRowActivity,
  isTaskListRowActive,
} from "@/v4/taskListRowActivity.js";
import { projectKey } from "@/project-sidebar/view.js";

export const SIDEBAR_TASK_STATUSES = ["all", "running", "waiting", "failed", "finished"] as const;
export type SidebarTaskStatus = (typeof SIDEBAR_TASK_STATUSES)[number];
export interface SidebarTaskFilters {
  unreadOnly: boolean;
  status: SidebarTaskStatus;
}
export type SidebarProjectSort = "manual" | "activity";
export const DEFAULT_SIDEBAR_TASK_FILTERS: SidebarTaskFilters = {
  unreadOnly: false,
  status: "all",
};

export function readSidebarTaskFilters(saved: {
  unreadOnly?: unknown;
  taskStatus?: unknown;
}): SidebarTaskFilters {
  return {
    unreadOnly: saved.unreadOnly === true,
    status: SIDEBAR_TASK_STATUSES.includes(saved.taskStatus as SidebarTaskStatus)
      ? (saved.taskStatus as SidebarTaskStatus)
      : "all",
  };
}
export function readSidebarProjectSort(saved: {
  projectSort?: unknown;
  order?: unknown;
}): SidebarProjectSort {
  if (saved.projectSort === "activity" || saved.projectSort === "manual") return saved.projectSort;
  return Array.isArray(saved.order) && saved.order.some((key) => typeof key === "string")
    ? "manual"
    : "activity";
}
export function hasSidebarTaskFilters(filters: SidebarTaskFilters): boolean {
  return filters.unreadOnly || filters.status !== "all";
}
export function taskMatchesSidebarFilters(task: ProjectTask, filters: SidebarTaskFilters): boolean {
  if (filters.unreadOnly && !task.unreadAt) return false;
  if (filters.status === "all") return true;
  const attention = getTaskListAttention(task);
  if (filters.status === "waiting") return Boolean(attention);
  if (attention) return false;
  const active = isTaskListRowActive(task);
  if (filters.status === "running") return active;
  if (active) return false;
  const phase = getTaskListRowActivity(task)?.phase;
  if (filters.status === "failed") return phase ? phase === "error" : task.status === "error";
  return phase
    ? phase === "completedSuccess" || phase === "completedInterrupted"
    : task.status === "completed";
}

/** 显示树不进入 Provider，避免筛选污染 composer、归属和未读角标。 */
export function filterSidebarTree(tree: ProjectTree, filters: SidebarTaskFilters): ProjectTree {
  if (!hasSidebarTaskFilters(filters)) return tree;
  const tasks = tree.tasks.filter((task) => taskMatchesSidebarFilters(task, filters));
  const visibleProjects = new Set(
    tasks
      .filter((task) => !task.archived && task.projectId !== null)
      .map((task) => projectKey({ id: task.projectId!, hostId: task.hostId })),
  );
  return {
    ...tree,
    tasks,
    projects: tree.projects.filter((project) => visibleProjects.has(projectKey(project))),
  };
}

export function hasVisibleSidebarTasks(tree: ProjectTree, view: ProjectSidebarView): boolean {
  const projects = new Set(tree.projects.filter((project) => !project.deleted).map(projectKey));
  return tree.tasks.some(
    (task) =>
      !task.archived &&
      (view !== "projects" ||
        task.pinned ||
        (task.projectId === null && task.hostId === "local") ||
        (task.projectId !== null &&
          projects.has(projectKey({ id: task.projectId, hostId: task.hostId })))),
  );
}

/** 活动只读完整事实；固定置顶/离线槽位，排序不覆盖保存的手动序列。 */
export function sortProjectsByActivity(
  manualOrder: readonly VirtualProject[],
  tasks: readonly ProjectTask[],
  availability?: ReadonlyMap<string, ProjectAvailability>,
): VirtualProject[] {
  const activity = new Map<string, number>();
  for (const task of tasks) {
    if (task.projectId === null) continue;
    const key = projectKey({ id: task.projectId, hostId: task.hostId });
    const time = Math.max(
      task.createdAt || 0,
      getTaskListRowActivity(task)?.lastActivityAt ?? task.updatedAt ?? 0,
    );
    if (Number.isFinite(time)) activity.set(key, Math.max(activity.get(key) ?? 0, time));
  }
  const sortable = (project: VirtualProject) =>
    !project.pinned && availability?.get(projectKey(project))?.online !== false;
  const positions = new Map(manualOrder.map((project, index) => [projectKey(project), index]));
  const sorted = manualOrder.filter(sortable).sort((a, b) => {
    const aTime = activity.get(projectKey(a)) ?? a.createdAt ?? 0;
    const bTime = activity.get(projectKey(b)) ?? b.createdAt ?? 0;
    return bTime - aTime || positions.get(projectKey(a))! - positions.get(projectKey(b))!;
  });
  let index = 0;
  return manualOrder.map((project) => (sortable(project) ? sorted[index++]! : project));
}
