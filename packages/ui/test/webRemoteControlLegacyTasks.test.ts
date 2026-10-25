// @vitest-environment jsdom
import {
  webRemoteControlLegacyTaskTargetsSchema,
  parseWebRemoteControlAppPayload,
  DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
  type IPlatformService,
  type WebRemoteControlStatus,
} from "@zcode/shared";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildLegacyRemoteTaskTargets,
  useWebRemoteControlLegacyTaskSync,
} from "@/root/rootPlatformWorkspaceSync.js";
const h = vi.hoisted(() => ({ list: vi.fn(), subscribe: vi.fn(), controller: {} }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => ({ windowControllerService: h.controller }),
}));
vi.mock("@/v4/windowControllerTaskListRegistry.js", () => ({
  getWindowControllerTaskListRegistry: () => ({
    list: h.list,
    subscribe: h.subscribe,
    getRevision: () => 1,
  }),
}));
vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const task = {
  taskId: "task-a",
  title: "合成历史",
  workspacePath: "/repo",
  createdAt: 1,
  updatedAt: 2,
  provider: "glm",
  sourceAvailability: "online",
  liveStatus: "completed",
} as WindowHostControllerTaskListItem;
it("按完整 workspace 身份投影置顶和归档，并保留当前远端代次", () => {
  const workspaces = [
    { workspacePath: "/repo", label: "Local", kind: "local" as const },
    {
      workspacePath: "/repo",
      workspaceIdentity: "remote-id",
      remoteSessionId: "current",
      label: "Remote",
      kind: "remote" as const,
    },
  ];
  const result = buildLegacyRemoteTaskTargets(workspaces, [
    { kind: "pinned", items: [task] },
    {
      kind: "archived",
      items: [
        { ...task, workspaceIdentity: "remote-id", remoteSessionId: "old" },
        { ...task, workspaceIdentity: "other" },
      ],
    },
  ]);
  expect(result).toHaveLength(2);
  expect(result[0]?.pinned).toBe(true);
  expect(result[1]).toMatchObject({
    workspaceIdentity: "remote-id",
    remoteSessionId: "current",
    archived: true,
  });
  expect(webRemoteControlLegacyTaskTargetsSchema.safeParse(result).success).toBe(true);
  expect(
    parseWebRemoteControlAppPayload({
      zcode_type: "bootstrap-response",
      requestId: "r",
      success: true,
      result: { windowControlSessionId: "s", workspaces, tasks: result },
    }),
  ).toMatchObject({ result: { tasks: result } });
});
it("仅官方运行态订阅，等待完整三组，停止后丢弃在途结果", async () => {
  let statusListener!: (status: WebRemoteControlStatus) => void;
  const unsubscribe = vi.fn();
  h.subscribe.mockReturnValue(unsubscribe);
  const waiting = Promise.withResolvers<{ items: WindowHostControllerTaskListItem[] }>();
  h.list.mockImplementation(async (_key, _version, query) =>
    query.kind === "pinned" ? waiting.promise : { items: query.kind === "timeline" ? [task] : [] },
  );
  const sync = vi.fn();
  const platform = {
    syncWebRemoteControlLegacyTasks: sync,
    getWebRemoteControlStatus: async () => ({ status: "idle" }),
    onWebRemoteControlStatusChanged: (listener: typeof statusListener) => {
      statusListener = listener;
      return vi.fn();
    },
  } as unknown as IPlatformService;
  const tabs = [
    { kind: "workspace", id: "w", workspacePath: "/repo", label: "Repo" },
  ] as unknown as Parameters<typeof useWebRemoteControlLegacyTaskSync>[0]["tabs"];
  renderHook(() => useWebRemoteControlLegacyTaskSync({ platform, tabs, enabled: true }));
  await act(async () => {});
  expect(h.subscribe).not.toHaveBeenCalled();
  await act(async () =>
    statusListener({
      status: "running",
      connection: { ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS, mode: "official" },
    }),
  );
  expect(h.list).toHaveBeenCalledTimes(3);
  expect(sync).not.toHaveBeenCalled();
  await act(async () => statusListener({ status: "idle" }));
  await act(async () => waiting.resolve({ items: [] }));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(sync).not.toHaveBeenCalled();
  await act(async () =>
    statusListener({
      status: "running",
      connection: { ...DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS, mode: "official" },
    }),
  );
  await waitFor(() => expect(sync).toHaveBeenCalledOnce());
  expect(sync.mock.calls[0]?.[0]).toHaveLength(1);
});
