// @vitest-environment jsdom
// OW-P024 回归（UI 展示层 / REVIEW-3 A）：全局工作流列表在运行历史读取失败时，
// 必须把失败露出来，并且能绕过缓存重试。此前只把 runsError 交给卡片——卡片有旧
// run 时渲染 completed 徽标，组上没有任何失败提示，等于吞错。
//
// 证明范围：真实 SavedWorkflowGlobalGroup + 真实 savedWorkflowStore 状态机；
// 只在 service 调用边界替换两项读取（与 E2E 受控读取入口同一个 seam）。
// 不涉及进程、lane 或服务端行为——那些由 services 场景回归覆盖。
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZCodeSavedWorkflowRun } from "@zcode/shared";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { GLOBAL_SAVED_WORKFLOW_TARGET } from "@/settings/saved-workflows/globalWorkflowGroupHelpers.js";
import {
  resetSavedWorkflowStoreForTests,
  selectSavedWorkflowState,
  useSavedWorkflowStore,
} from "@/store/savedWorkflowStore.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
        values?.error ? `${id}:${values.error}` : id,
    },
  }),
}));

const services = vi.hoisted(() => ({
  listSavedWorkflows: vi.fn(),
  listSavedWorkflowRuns: vi.fn(),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({
    zcodeAgentService: {
      listSavedWorkflows: services.listSavedWorkflows,
      listSavedWorkflowRuns: services.listSavedWorkflowRuns,
    },
    fileWatcherService: { watch: vi.fn(async () => ({ unwatch: vi.fn() })) },
  }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => async () => true,
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowsDirectoryWatch.js", () => ({
  useSavedWorkflowsDirectoryWatch: () => undefined,
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowLauncher.js", () => ({
  useSavedWorkflowLauncher: () => ({
    launch: vi.fn(),
    pending: false,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock("@/settings/saved-workflows/useSavedWorkflowRunOpeners.js", () => ({
  useSavedWorkflowRunOpeners: () => ({ handleOpenArtifact: vi.fn(), handleOpenRun: vi.fn() }),
}));

const { SavedWorkflowGlobalGroup } =
  await import("@/settings/saved-workflows/SavedWorkflowGlobalGroup.js");

const ENTRY = {
  name: "global-flow",
  description: "Global workflow",
  scope: "global" as const,
  path: "/fixture/global-flow.dwf.ts",
};
const OLD_RUN: ZCodeSavedWorkflowRun = {
  runId: "run-global-old",
  name: "global-flow",
  status: "completed",
  createdAt: 1,
  updatedAt: 2,
};

const LIST_OK = { workflows: [ENTRY], invalid: [], dir: "/fixture/.zcode/workflows" };

/** 组按 Root.tsx 的实际装配包在 TooltipProvider 里（卡片菜单/提示需要）。 */
function groupElement(refreshSeq: number) {
  return createElement(
    TooltipProvider,
    {},
    createElement(SavedWorkflowGlobalGroup, {
      refreshSeq,
      mode: { kind: "list" },
      onStateChange: () => undefined,
      onOpenDetail: () => undefined,
      onBack: () => undefined,
      localProjects: [],
      activeProjectKey: null,
      onMoved: () => undefined,
    }),
  );
}

function renderGroup(refreshSeq = 0) {
  return render(groupElement(refreshSeq));
}

/**
 * 页级刷新（组外的刷新按钮）：`refreshSeq` 变化即以 `bypassCache` 重拉。
 * 组自身没有独立刷新按钮，失败是「有缓存后刷新失败」，必须走这条真实路径。
 */
function rerenderWithRefresh(result: ReturnType<typeof renderGroup>, refreshSeq: number) {
  result.rerender(groupElement(refreshSeq));
}

/** 挂载后的首轮读取：等它落库，避免把「首轮在途」当成断言状态。 */
async function waitForLoaded() {
  await waitFor(() => {
    expect(
      selectSavedWorkflowState(useSavedWorkflowStore.getState(), GLOBAL_SAVED_WORKFLOW_TARGET)
        .loaded,
    ).toBe(true);
  });
}

describe("SavedWorkflowGlobalGroup 的历史错误横幅与重试（OW-P024 REVIEW-3 A）", () => {
  beforeEach(() => {
    resetSavedWorkflowStoreForTests();
    services.listSavedWorkflows.mockReset();
    services.listSavedWorkflowRuns.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("首次失败：没有旧历史时也显示错误与重试，不显示「从未运行」", async () => {
    services.listSavedWorkflows.mockResolvedValue(LIST_OK);
    services.listSavedWorkflowRuns.mockRejectedValue(new Error("journal unreadable"));
    renderGroup();
    await waitForLoaded();

    expect(screen.getByText("workflows.hub.runsError:journal unreadable")).toBeTruthy();
    expect(document.querySelector('[data-workflows-runs-retry="true"]')).not.toBeNull();
    // 失败不得断言成「从未运行」。
    expect(document.querySelector('[data-workflow-last-run="never"]')).toBeNull();
  });

  it("有缓存后失败：旧 completed 徽标与错误同时存在（不再吞错）", async () => {
    // 首轮成功 → 缓存里留下一条 completed run。
    services.listSavedWorkflows.mockResolvedValue(LIST_OK);
    services.listSavedWorkflowRuns.mockResolvedValue({ runs: [OLD_RUN] });
    const result = renderGroup();
    await waitForLoaded();
    await waitFor(() => {
      expect(document.querySelector('[data-workflow-last-run="completed"]')).not.toBeNull();
    });

    // 刷新失败：旧记录保留 + 错误可见。
    services.listSavedWorkflowRuns.mockRejectedValue(new Error("journal unreadable"));
    rerenderWithRefresh(result, 1);
    await waitFor(() => {
      expect(screen.getByText("workflows.hub.runsError:journal unreadable")).toBeTruthy();
    });
    expect(document.querySelector('[data-workflow-last-run="completed"]')).not.toBeNull();
  });

  it("重试成功：点击重试确实发出读取，错误消失且新历史出现", async () => {
    services.listSavedWorkflows.mockResolvedValue(LIST_OK);
    services.listSavedWorkflowRuns.mockResolvedValue({ runs: [OLD_RUN] });
    const result = renderGroup();
    await waitForLoaded();

    // 刷新失败。
    services.listSavedWorkflowRuns.mockRejectedValue(new Error("journal unreadable"));
    rerenderWithRefresh(result, 1);
    await waitFor(() => {
      expect(screen.getByText("workflows.hub.runsError:journal unreadable")).toBeTruthy();
    });

    // 重试：读取恢复，返回一条新的 run。
    const RETRIED_RUN: ZCodeSavedWorkflowRun = {
      ...OLD_RUN,
      runId: "run-global-new",
      updatedAt: 9,
    };
    services.listSavedWorkflowRuns.mockReset();
    services.listSavedWorkflowRuns.mockResolvedValue({ runs: [RETRIED_RUN] });
    const readsBefore = services.listSavedWorkflowRuns.mock.calls.length;
    fireEvent.click(document.querySelector('[data-workflows-runs-retry="true"]') as HTMLElement);

    // 点击必须真的发出读取（不是只清本地状态）。
    await waitFor(() => {
      expect(services.listSavedWorkflowRuns.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    // 成功后错误消失，历史仍可见。
    await waitFor(() => {
      expect(screen.queryByText(/workflows.hub.runsError/)).toBeNull();
    });
    expect(document.querySelector('[data-workflow-last-run="completed"]')).not.toBeNull();
  });
});
