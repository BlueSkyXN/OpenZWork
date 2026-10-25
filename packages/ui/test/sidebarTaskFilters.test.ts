import { describe, expect, it } from "vitest";
import type { ProjectTask, VirtualProject } from "@/project-sidebar/contract.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { filterSidebarTree, sortProjectsByActivity } from "@/project-sidebar/task-filters.js";

const task = (id: string, patch: Partial<ProjectTask> = {}): ProjectTask => ({
  taskId: id,
  workspacePath: "/work",
  title: id,
  mode: "default",
  traceId: id,
  hostId: "local",
  projectId: "a",
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  archived: false,
  ...patch,
});
const project = (id: string, hostId = "local"): VirtualProject => ({
  id,
  hostId,
  name: id,
  nameOverridden: false,
  roots: [],
  position: 0,
  pinned: false,
  deleted: false,
  createdAt: 0,
  updatedAt: 0,
});
describe("侧栏筛选与项目活动排序", () => {
  it("OCC03：筛选在完整树上组合，包含置顶，不改原树或组织属性", () => {
    const waiting = attachTaskListRowActivity(task("waiting", { unreadAt: 1, pinned: true }), {
      phase: "running",
      lastActivityAt: 30,
      hasBackgroundWork: false,
      pendingInteractions: { permissionCount: 1, userInputCount: 0 },
    });
    const other = task("other", { unreadAt: 1, projectId: "b" });
    const source = { projects: [project("a"), project("b")], tasks: [waiting, other] };
    const shown = filterSidebarTree(source, { unreadOnly: true, status: "waiting" });
    expect(shown.tasks).toEqual([waiting]);
    expect(shown.projects.map((p) => p.id)).toEqual(["a"]);
    expect(source.tasks).toEqual([waiting, other]);
    expect(shown.tasks[0]).toBe(waiting);
  });
  it("OCC03：运行包含后台工作；待处理独立；残留 running 不推断完成", () => {
    const background = attachTaskListRowActivity(task("background"), {
      phase: "completedSuccess",
      lastActivityAt: 1,
      hasBackgroundWork: true,
    });
    const unknown = task("stale", { status: "running" });
    const failed = task("failure", { status: "error" });
    const completed = task("finished", { status: "completed" });
    const tree = { projects: [project("a")], tasks: [background, unknown, failed, completed] };
    expect(filterSidebarTree(tree, { unreadOnly: false, status: "running" }).tasks).toEqual([
      background,
    ]);
    expect(filterSidebarTree(tree, { unreadOnly: false, status: "failed" }).tasks).toEqual([
      failed,
    ]);
    expect(filterSidebarTree(tree, { unreadOnly: false, status: "finished" }).tasks).toEqual([
      completed,
    ]);
  });
  it("OCC04：按 Host+projectId 隔离，置顶和离线位置保留，同时间沿手动顺序", () => {
    const a = project("a"),
      offline = project("offline"),
      remote = project("a", "remote"),
      pin = { ...project("pin"), pinned: true },
      b = project("b");
    const order = [pin, a, offline, b, remote];
    const tasks = [
      task("a", { updatedAt: 10 }),
      task("b", { projectId: "b", updatedAt: 30 }),
      task("remote", { hostId: "remote", updatedAt: 50 }),
    ];
    const availability = new Map([[JSON.stringify(["local", "offline"]), { online: false }]]);
    expect(sortProjectsByActivity(order, tasks, availability)).toEqual([
      pin,
      remote,
      offline,
      b,
      a,
    ]);
    const tied = [task("a", { updatedAt: 50 }), task("b", { projectId: "b", updatedAt: 50 })];
    expect(sortProjectsByActivity([b, a], tied)).toEqual([b, a]);
    expect(order).toEqual([pin, a, offline, b, remote]);
  });
  it("OCC04：活动使用实时投影；改名的项目 updatedAt 不参与；归档不制造时间", () => {
    const a = { ...project("a"), updatedAt: 999 },
      b = project("b");
    const live = attachTaskListRowActivity(
      task("b", { projectId: "b", archived: true, updatedAt: 1 }),
      { phase: "completedSuccess", lastActivityAt: 50, hasBackgroundWork: false },
    );
    expect(sortProjectsByActivity([a, b], [task("a", { updatedAt: 10 }), live])).toEqual([b, a]);
  });
});
