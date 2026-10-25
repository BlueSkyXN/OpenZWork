// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskListItemContextActions } from "@/useTaskListItemContextActions.js";
import type { V4ConversationRowsRangeResult } from "@zcode/shared/zcode-protocol-v4";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(async (_text: string) => {}),
  toast: vi.fn(() => 1),
  update: vi.fn(),
  dismiss: vi.fn(),
  ready: true,
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    services: { zcodeAgentService: { conversationRowsRangeV4: mocks.read } },
    remoteSessionId: "attachment",
    rpcReady: mocks.ready,
  }),
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({}) }));
vi.mock("@/hooks/useTaskSessionFilePath.js", () => ({
  useTaskSessionFilePath: () => ({ path: null, exists: false, loading: false }),
}));
vi.mock("@/hooks/useTaskNativeSessionLogFile.js", () => ({
  useTaskNativeSessionLogFile: () => ({ path: null, exists: false, loading: false }),
}));
vi.mock("@/hooks/useWorkspaceProviderConfigFile.js", () => ({
  useWorkspaceProviderConfigFile: () => ({ path: null, exists: false, loading: false }),
}));
vi.mock("@/hooks/useWorkspaceOpenInEditorTarget.js", () => ({
  useWorkspaceOpenInEditorTarget: () => ({ isRemoteWorkspace: true }),
}));
vi.mock("@/components/ui/toast.js", () => ({
  toast: mocks.toast,
  updateToast: mocks.update,
  dismissToast: mocks.dismiss,
}));
vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
const options = {
  workspacePath: "/work",
  workspaceIdentity: "remote-work",
  remoteSessionId: "old-attachment",
  taskId: "selected-task",
  intl: { formatMessage: ({ id }: { id: string }) => id },
};
const response: V4ConversationRowsRangeResult = {
  rows: [
    {
      rowId: 1,
      turnId: "turn",
      createdAt: 1,
      createdAtSeq: 1,
      kind: "userInput",
      origin: "realUser",
      text: "完整正文",
    },
  ],
  hasMore: false,
  atSeq: 1,
  atRevision: 1,
  atLogEpoch: "epoch",
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.ready = true;
});

it("OCC01/02：菜单卸载后仍复制点击目标，沿用解析后的远端 attachment", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.write },
  });
  let release!: (value: V4ConversationRowsRangeResult) => void;
  const held = new Promise<V4ConversationRowsRangeResult>((resolve) => {
    release = resolve;
  });
  mocks.read.mockImplementation(() => held);
  const hook = renderHook(() => useTaskListItemContextActions(options));
  let done!: Promise<void>;
  act(() => {
    done = hook.result.current.handleCopyConversationMarkdown("所选任务");
  });
  expect(mocks.read).toHaveBeenCalledWith({
    workspacePath: "/work",
    workspaceIdentity: "remote-work",
    remoteSessionId: "attachment",
    sessionId: "selected-task",
    limit: 200,
  });
  hook.unmount();
  await act(async () => {
    release(response);
    await done;
  });
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.write.mock.calls[0]?.[0]).toContain("# 所选任务");
  expect(mocks.write.mock.calls[0]?.[0]).toContain("完整正文");
});

it("OCC02：断连不查询，读取失败不写入剪贴板", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.write },
  });
  mocks.ready = false;
  const offline = renderHook(() => useTaskListItemContextActions(options));
  expect(offline.result.current.canCopyConversation).toBe(false);
  await act(() => offline.result.current.handleCopyConversationMarkdown("未连接"));
  expect(mocks.read).not.toHaveBeenCalled();
  offline.unmount();
  mocks.ready = true;
  mocks.read.mockRejectedValue(new Error("private backend payload"));
  const online = renderHook(() => useTaskListItemContextActions(options));
  await act(() => online.result.current.handleCopyConversationMarkdown("读取失败"));
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ message: "conversationExport.failed" }),
  );
});
