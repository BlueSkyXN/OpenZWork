// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import {
  ConversationMetricsBar,
  MetricsDisplaySettings,
  useConversationMetricsPreferences,
} from "@/conversation-metrics/index.js";
import { conversationMetricsPreferences } from "@/store/conversationMetricsPreferencesStore.js";
import { METRICS_PREFERENCES_STORAGE_KEY } from "@/conversation-metrics/contract.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

const mocks = vi.hoisted(() => ({ app: vi.fn(), child: vi.fn(), refresh: vi.fn() }));
vi.mock("@/hooks/useAppUsageStats.js", () => ({ useAppUsageStats: mocks.app }));
vi.mock("@/hooks/useSessionSubagents.js", () => ({ useSessionSubagents: mocks.child }));
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  conversationMetricsPreferences.store.getState().reset();
  vi.clearAllMocks();
  mocks.app.mockReturnValue({
    available: false,
    loading: false,
    data: null,
    refresh: mocks.refresh,
  });
  mocks.child.mockReturnValue({
    running: [],
    ended: { total: 0, items: [] },
    loading: false,
    refresh: mocks.refresh,
    usageSummary: { totalCount: 0, knownCount: 0 },
  });
});
function snapshot(sessionId = "a"): ConversationSnapshot {
  return {
    sessionId,
    epoch: "epoch",
    rows: {
      window: [
        {
          kind: "turnHeader",
          turnId: "turn-a",
          state: "completedSuccess",
          activeMs: 42000,
          startedAt: 1000,
          endedAt: 43000,
          metrics: {
            requestCount: 2,
            failureCount: 0,
            unknownUsageCount: 0,
            usage: { inputTokens: 62500, outputTokens: 2100, cacheReadTokens: 56250 },
            latest: {
              status: "completed",
              outputTokens: 172,
              durationMs: 3400,
              timeToFirstContentMs: 1400,
              timeToFirstTextMs: 1600,
            },
          },
          toolCallCount: 3,
          toolErrorCount: 1,
        },
      ],
    },
    usage: {
      cumulative: {
        inputTokens: 100000,
        outputTokens: 2000,
        cacheReadTokens: 60000,
        cacheWriteTokens: 0,
      },
    },
  } as unknown as ConversationSnapshot;
}
function ui(value: ConversationSnapshot) {
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "en-US" },
    createElement(ConversationMetricsBar, {
      snapshot: value,
      workspacePath: "/project",
      workspaceIdentity: "ssh:a/project",
      remoteSessionId: "remote-a",
    }),
  );
}
function ConnectedMetrics() {
  const preferences = useConversationMetricsPreferences();
  return preferences.enabled && preferences.visibleFields.length > 0
    ? createElement(ConversationMetricsBar, {
        snapshot: snapshot(),
        workspacePath: "/project",
        displayPreferences: preferences,
      })
    : null;
}
describe("原生指标交互", () => {
  it("设置与主栏即时同步，预览不查询，全部取消或外部关闭后隐藏", () => {
    render(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "en-US" },
        createElement(MetricsDisplaySettings),
        createElement(ConnectedMetrics),
      ),
    );
    expect(mocks.app).not.toHaveBeenCalled();
    expect(mocks.child).not.toHaveBeenCalled();
    for (const id of ["statusDuration", "firstText", "cache"]) {
      fireEvent.click(screen.getByTestId(`metrics-display-field-${id}`));
    }
    const bar = within(screen.getByTestId("conversation-metrics-bar"));
    expect(bar.getByTestId("metrics-value-speed").textContent).toBe("86 tok/s");
    expect(bar.queryByTestId("metrics-value-statusDuration")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(METRICS_PREFERENCES_STORAGE_KEY)!).visibleFields,
    ).toEqual(["speed", "turnTokens"]);
    fireEvent.click(bar.getByRole("button", { name: "More" }));
    expect(bar.getByText("Cache")).toBeTruthy();
    const calls = mocks.child.mock.calls.length;
    act(() => {
      localStorage.setItem(
        METRICS_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ version: 1, enabled: false, visibleFields: ["speed", "turnTokens"] }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: METRICS_PREFERENCES_STORAGE_KEY }));
    });
    expect(screen.queryByTestId("conversation-metrics-bar")).toBeNull();
    expect(screen.queryByTestId("conversation-metrics-expanded")).toBeNull();
    expect(mocks.child.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByTestId("metrics-display-enabled"));
    for (const id of ["speed", "turnTokens"])
      fireEvent.click(screen.getByTestId(`metrics-display-field-${id}`));
    expect(screen.queryByTestId("conversation-metrics-bar")).toBeNull();
    expect(screen.getByText("Choose metrics to display")).toBeTruthy();
    fireEvent.click(screen.getByTestId("metrics-display-reset"));
    expect(screen.getByTestId("conversation-metrics-bar")).toBeTruthy();
  });

  it("默认不查询，展开只读明细并保留关闭偏好", () => {
    render(ui(snapshot()));
    expect(screen.getByTestId("metrics-value-speed").textContent).toBe("86 tok/s");
    expect(mocks.app).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("conversation-metrics-details")).toBeTruthy();
    expect(mocks.child).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "a",
        workspaceIdentity: "ssh:a/project",
        remoteSessionId: "remote-a",
      }),
    );
    expect(screen.queryByText("Local today")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Less" }));
    expect(screen.queryByTestId("conversation-metrics-details")).toBeNull();
    expect(localStorage.getItem("openzwork.conversation-metrics.v1.expanded")).toBe("false");
  });
  it("切换会话使用新 snapshot，旧数据不累计", () => {
    const view = render(ui(snapshot()));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const next = snapshot("b");
    next.rows.window = [
      { ...next.rows.window[0]!, metrics: undefined } as (typeof next.rows.window)[number],
    ];
    view.rerender(ui(next));
    expect(screen.getByTestId("conversation-metrics-bar").getAttribute("data-session-id")).toBe(
      "b",
    );
    expect(screen.queryByText("86 tok/s")).toBeNull();
    expect(mocks.child).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "b" }));
  });
});
