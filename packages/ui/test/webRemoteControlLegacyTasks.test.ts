// @vitest-environment jsdom
import {
  webRemoteControlLegacyTaskSyncSchema,
  DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
  type IPlatformService,
  type WebRemoteControlStatus,
} from "@zcode/shared";
import type { ProjectTree, ProjectTask, VirtualProject } from "@zcode/services";
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildLegacyRemoteDirectorySnapshot,
  useWebRemoteControlLegacyTaskSync,
} from "@/root/rootPlatformWorkspaceSync.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";

const h = vi.hoisted(() => ({ directory: null as null | { tree: ProjectTree; loading: boolean } }));
vi.mock("@/project-sidebar/index.js", () => ({ useOptionalProjectDirectory: () => h.directory }));
vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn() } }));
afterEach(() => {
  cleanup();
  h.directory = null;
  vi.clearAllMocks();
});

function project(id: string, path?: string): VirtualProject {
  return {
    id,
    hostId: "local",
    name: id,
    nameOverridden: true,
    roots: path ? [{ rootPath: path, position: 0, isPrimary: true }] : [],
    position: 0,
    pinned: false,
    deleted: false,
    createdAt: 1,
    updatedAt: 2,
  };
}
function task(path: string, extra: Partial<ProjectTask> = {}): ProjectTask {
  return {
    taskId: path,
    traceId: "trace",
    title: "History",
    workspacePath: path,
    createdAt: 1,
    updatedAt: 2,
    mode: "default",
    status: "completed",
    projectId: null,
    hostId: "local",
    pinned: false,
    archived: false,
    ...extra,
  };
}
const workspaces = [{ workspacePath: "/open", label: "Open", kind: "local" as const }];
const build = (tree: ProjectTree) =>
  buildLegacyRemoteDirectorySnapshot(workspaces, tree, "No folders");

it("目录覆盖未打开、无任务、无 root 项目与历史 cwd，软删项目不提供新项目入口", () => {
  const result = build({
    projects: [
      project("Closed", "/closed"),
      project("Empty", "/empty"),
      project("Rootless"),
      { ...project("Deleted", "/deleted"), deleted: true },
    ],
    tasks: [
      task("/closed", { projectId: "Closed", pinned: true }),
      task("/historical", { archived: true }),
      task("/deleted", { projectId: "Deleted" }),
    ],
  });
  expect(result.workspaces.map((w) => w.workspacePath)).toEqual(
    expect.arrayContaining(["/open", "/closed", "/empty", "No folders", "/historical", "/deleted"]),
  );
  expect(result.tasks).toHaveLength(3);
  expect(result.tasks[0]).toMatchObject({ pinned: true, workspaceLabel: "Closed" });
  expect(result.tasks[1]).toMatchObject({ archived: true, workspacePath: "/historical" });
  expect(result.projects).toContainEqual({ workspaceKey: "/closed", projectIds: ["Closed"] });
  expect(result.projects).not.toContainEqual(expect.objectContaining({ projectIds: ["Deleted"] }));
  const rootless = result.workspaces.find((w) => w.label === "Rootless")!;
  expect(rootless.kind).toBe("local");
  expect(rootless.workspaceIdentity).toBe(JSON.stringify(["openzwork-local-project", "Rootless"]));
  expect(
    webRemoteControlLegacyTaskSyncSchema.safeParse({
      tasks: result.tasks,
      directory: {
        windowControlSessionId: "sid",
        workspaces: result.workspaces,
        projects: result.projects,
      },
    }).success,
  ).toBe(true);
});

it("同目录的多个项目保留全部归属，多 root 历史保留原 cwd", () => {
  const first = project("A", "/same");
  first.roots.push({ rootPath: "/secondary", position: 1, isPrimary: false });
  const result = build({
    projects: [first, project("B", "/same")],
    tasks: [task("/secondary", { projectId: "A" })],
  });
  expect(result.projects).toContainEqual({ workspaceKey: "/same", projectIds: ["A", "B"] });
  expect(result.projects).toContainEqual({ workspaceKey: "/secondary", projectIds: ["A"] });
  expect(result.workspaces.find((w) => w.workspacePath === "/same")?.label).toBe("A / B");
  expect(result.tasks[0]?.workspacePath).toBe("/secondary");
});

it("远端仅投影现有已连接身份，使用当前 session 且不伪造未打开远端", () => {
  const remote = {
    workspacePath: "/same",
    workspaceIdentity: "remote-id",
    remoteSessionId: "new",
    label: "Remote",
    kind: "remote" as const,
    connectionState: "connected" as const,
  };
  const result = buildLegacyRemoteDirectorySnapshot(
    [...workspaces, remote],
    {
      projects: [{ ...project("Remote closed", "/remote-closed"), hostId: "server" }],
      tasks: [
        task("/same"),
        task("/same", { hostId: "server", workspaceIdentity: "remote-id" }),
        task("/remote-closed", { hostId: "server", workspaceIdentity: "unopened" }),
      ],
    },
    "No folders",
  );
  expect(result.tasks).toHaveLength(2);
  expect(result.tasks[1]).toMatchObject({ workspaceIdentity: "remote-id", remoteSessionId: "new" });
  expect(result.workspaces.some((w) => w.workspacePath === "/remote-closed")).toBe(false);
});

it("复用实时活动和组织字段，旧持久化 running 不伪装成正在运行", () => {
  const result = build({
    projects: [],
    tasks: [
      attachTaskListRowActivity(task("/live", { pinned: true }), {
        phase: "running",
        lastActivityAt: 99,
        hasBackgroundWork: true,
      }),
      task("/old", { status: "running" }),
    ],
  });
  expect(result.tasks[0]).toMatchObject({
    displayStatus: "running",
    updatedAt: 99,
    pinned: true,
    hasBackgroundWork: true,
  });
  expect(result.tasks[1]?.displayStatus).toBe("idle");
});

it("官方运行态发布原子目录；改名同步，停止或换模式后不发布，迟到初始状态不覆盖事件", async () => {
  let listener!: (status: WebRemoteControlStatus) => void;
  const initial = Promise.withResolvers<WebRemoteControlStatus>();
  const sync = vi.fn();
  const unsubscribe = vi.fn();
  const platform = {
    syncWebRemoteControlLegacyTasks: sync,
    getWebRemoteControlStatus: () => initial.promise,
    onWebRemoteControlStatusChanged: (next: typeof listener) => {
      listener = next;
      return unsubscribe;
    },
  } as unknown as IPlatformService;
  h.directory = { tree: { projects: [project("Closed", "/closed")], tasks: [] }, loading: false };
  const tabs = [] as Parameters<typeof useWebRemoteControlLegacyTaskSync>[0]["tabs"];
  const { rerender, unmount } = renderHook(() =>
    useWebRemoteControlLegacyTaskSync({
      platform,
      tabs,
      enabled: true,
      rootlessLabel: "No folders",
    }),
  );
  expect(sync).not.toHaveBeenCalled();
  const active: WebRemoteControlStatus = {
    status: "running",
    sessionId: "sid",
    connection: { ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS, mode: "official" },
  };
  await act(async () => listener(active));
  expect(sync).toHaveBeenCalledTimes(1);
  await act(async () => initial.resolve({ status: "idle" }));
  h.directory = {
    tree: { projects: [{ ...project("Closed", "/closed"), name: "Renamed" }], tasks: [] },
    loading: false,
  };
  rerender();
  expect(sync).toHaveBeenLastCalledWith(
    [],
    expect.objectContaining({
      windowControlSessionId: "sid",
      workspaces: [expect.objectContaining({ label: "Renamed" })],
    }),
  );
  const count = sync.mock.calls.length;
  await act(async () =>
    listener({ ...active, connection: { ...active.connection!, mode: "direct" } }),
  );
  rerender();
  expect(sync).toHaveBeenCalledTimes(count);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
