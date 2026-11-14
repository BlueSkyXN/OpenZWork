// @vitest-environment jsdom
// OW-P024 回归（UI 展示层）：运行历史读取失败的横幅真的渲染出来（spec §5）。
// 证明范围：SavedWorkflowProjectGroup 对 runsError 状态的渲染与重试回调——
// store 状态机由 savedWorkflowRefresh.test.ts 覆盖；不涉及任何进程或服务端行为。
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import {
  resetSavedWorkflowStoreForTests,
  useSavedWorkflowStore,
} from "@/store/savedWorkflowStore.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
      values?.error ? `${id}:${values.error}` : id },
  }),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    services: {
      zcodeAgentService: { listSavedWorkflows: vi.fn(), listSavedWorkflowRuns: vi.fn() },
      fileWatcherService: {},
    },
    rpcReady: true,
    remoteSessionId: null,
  }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => async () => true,
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowsDirectoryWatch.js", () => ({
  useSavedWorkflowsDirectoryWatch: () => undefined,
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowLauncher.js", () => ({
  useSavedWorkflowLauncher: () => ({ launch: vi.fn(), pending: false, error: null, clearError: vi.fn() }),
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowPromote.js", () => ({
  useSavedWorkflowPromote: () => ({ promote: vi.fn() }),
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowRunOpeners.js", () => ({
  useSavedWorkflowRunOpeners: () => ({ handleOpenArtifact: vi.fn(), handleOpenRun: vi.fn() }),
}));

const { SavedWorkflowProjectGroup } = await import(
  "@/settings/saved-workflows/SavedWorkflowProjectGroup.js"
);

const project: AutomationWorkspaceOption = {
  projectId: "p1",
  hostId: "local",
  label: "fixture-project",
  workspacePath: "/fixture/proj-a",
};

describe("SavedWorkflowProjectGroup 的历史错误横幅（OW-P024）", () => {
  beforeEach(() => {
    resetSavedWorkflowStoreForTests();
  });
  afterEach(() => {
    cleanup();
  });

  it("runsError 时渲染提示与重试按钮；无错误时不渲染", () => {
    const refresh = vi.fn();
    // 刷新路径经 load()；挂载前替换 load 以捕获重试点击，不触发真实请求
    // （组件的 refresh 回调在挂载时 memoize load 引用）。
    useSavedWorkflowStore.setState({ load: refresh as never });
    useSavedWorkflowStore.setState({
      byWorkspaceKey: {
        "/fixture/proj-a": {
          entries: [
            {
              name: "flow-1",
              description: "d",
              scope: "project",
              path: "/fixture/flow-1.dwf.ts",
            },
          ],
          invalid: [],
          runs: [],
          runsError: "journal unreadable",
          dir: "/fixture/.zcode/workflows",
          loading: false,
          loaded: true,
          error: null,
          errorCode: null,
        },
      },
    });

    const { rerender } = render(
      createElement(SavedWorkflowProjectGroup, {
        project,
        isCurrent: false,
        refreshSeq: 0,
        mode: { kind: "list" },
        onStateChange: () => undefined,
        onOpenDetail: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(screen.getByText("workflows.hub.runsError:journal unreadable")).toBeTruthy();
    fireEvent.click(screen.getByText("workflows.hub.retry"));
    // 挂载时 effect 已按 target 调过一次 load；重试点击应再以 bypassCache 触发最后一次调用。
    const calls = refresh.mock.calls as unknown as Array<
      [unknown, unknown, { bypassCache?: boolean }?]
    >;
    expect(calls.at(-1)?.[2]).toEqual({ bypassCache: true });

    // 错误清除后横幅消失。
    useSavedWorkflowStore.setState({
      byWorkspaceKey: {
        "/fixture/proj-a": {
          entries: [],
          invalid: [],
          runs: [],
          runsError: null,
          dir: null,
          loading: false,
          loaded: true,
          error: null,
          errorCode: null,
        },
      },
    });
    rerender(
      createElement(SavedWorkflowProjectGroup, {
        project,
        isCurrent: false,
        refreshSeq: 0,
        mode: { kind: "list" },
        onStateChange: () => undefined,
        onOpenDetail: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(screen.queryByText(/workflows.hub.runsError/)).toBeNull();
  });
});
