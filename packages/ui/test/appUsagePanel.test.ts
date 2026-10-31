// @vitest-environment jsdom
import { createElement } from "react";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUsageSnapshot } from "@zcode/shared";
import { AppUsageSection } from "@/settings/usage-stats/AppUsageSection.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import en from "@/i18n/locales/en-US.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";

const state = vi.hoisted(() => ({
  data: null as AppUsageSnapshot | null,
  projects: [],
  available: true,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  ranges: vi.fn(),
  detailsOptions: vi.fn(),
  overviewOptions: vi.fn(),
}));
vi.mock("@/hooks/useAppUsageStats.js", () => ({
  useAppUsageStats: (range: string, options: unknown) => {
    state.overviewOptions(options);
    state.ranges(range);
    return state;
  },
}));
vi.mock("@/hooks/useAppUsageSessions.js", () => ({
  useAppUsageSessions: (_range: string, options: unknown) => {
    state.detailsOptions(options);
    return { data: null, available: true, loading: false, error: null };
  },
}));
afterEach(cleanup);
beforeEach(() => {
  Object.assign(state, { data: createSnapshot(), available: true, loading: false, error: null });
  vi.clearAllMocks();
});
function renderUsage() {
  return render(
    createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(AppUsageSection)),
  );
}

describe("本地 App Usage 页面", () => {
  it("空快照前置空态，隐藏空图表并把没有样本的比率显示为未知", () => {
    const empty = createSnapshot();
    empty.summary.totalTokens = 0;
    empty.summary.longestSessionMs = 0;
    state.data = empty;
    renderUsage();
    expect(screen.getByRole("status").textContent).toContain(en["settings.usage.emptyTitle"]);
    expect(screen.queryByTestId("app-usage-charts")).toBeNull();
    for (const key of ["cacheHitRate", "modelErrorRate"]) {
      const metric = screen.getByRole("group", { name: en["settings.usage." + key] });
      expect(within(metric).getByText("—")).toBeTruthy();
      expect(within(metric).queryByText("0%")).toBeNull();
    }
    expect(
      within(screen.getByRole("group", { name: en["settings.usage.favoriteModel"] })).getByText(
        "No data",
      ),
    ).toBeTruthy();
  });

  it("有模型请求的零 Token 快照仍有数据，真实 0% 保留", () => {
    const snapshot = createSnapshot({
      models: [
        {
          modelId: "model-a",
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          requestCount: 2,
          share: 0,
        },
      ],
    });
    snapshot.summary.totalTokens = 0;
    state.data = snapshot;
    renderUsage();
    expect(screen.queryByText(en["settings.usage.emptyTitle"])).toBeNull();
    expect(screen.getByTestId("app-usage-charts")).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: en["settings.usage.modelErrorRate"] })).getByText(
        "0%",
      ),
    ).toBeTruthy();
  });

  it("合法样本的零缓存命中率和工具错误率保留，未知模型不伪装成无数据", () => {
    const snapshot = createSnapshot();
    Object.assign(snapshot.summary, {
      inputTokens: 10,
      cacheHitRate: 0,
      toolCallCount: 2,
      toolErrorRate: 0,
      favoriteModel: { modelId: null, totalTokens: 10, share: 1 },
    });
    state.data = snapshot;
    renderUsage();
    expect(
      within(screen.getByRole("group", { name: en["settings.usage.cacheHitRate"] })).getByText(
        "0%",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: en["settings.usage.toolCallsTotal"] }).textContent,
    ).toContain("0%");
    expect(
      within(screen.getByRole("group", { name: en["settings.usage.favoriteModel"] })).getByText(
        en["settings.usage.unknownModel"],
      ),
    ).toBeTruthy();
  });

  it("展示实际累计值并将范围选择交给现有查询 hook", () => {
    renderUsage();
    expect(screen.getByText("20,650,000,000")).toBeTruthy();
    expect(state.ranges).toHaveBeenLastCalledWith("30d");
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.range.7d"] }));
    expect(state.ranges).toHaveBeenLastCalledWith("7d");
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.refresh"] }));
    expect(state.overviewOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshKey: 1 }),
    );
  });
  it("没有本地服务时禁止刷新且不展示旧统计", () => {
    Object.assign(state, { available: false, data: null });
    renderUsage();
    expect(screen.getByRole("status").textContent).toBe(en["settings.usage.localUnavailable"]);
    expect(
      (screen.getByRole("button", { name: en["settings.usage.refresh"] }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText("20,650,000,000")).toBeNull();
  });
  it("失败保留重试动作，加载期间不重复提交", () => {
    Object.assign(state, { error: "fixture failure", data: null });
    renderUsage();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.retry"] }));
    expect(state.overviewOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshKey: 1 }),
    );
  });
  it("加载状态显示进度并禁用刷新", () => {
    Object.assign(state, { loading: true, data: null });
    renderUsage();
    expect(screen.getByRole("status").textContent).toContain(en["settings.usage.loadingTitle"]);
    expect(
      (screen.getByRole("button", { name: en["settings.usage.refresh"] }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

it("opens a secondary detail view, keeps the range and restores focus on return", () => {
  state.data = createSnapshot();
  state.data.summary.totalSessions = 2;
  const { container } = renderUsage();
  const entry = screen.getByRole("button", { name: "View session details" });
  expect(container.querySelector('[data-testid="usage-session-details"]')).toBeNull();
  fireEvent.click(entry);
  expect(screen.getByRole("heading", { name: "Session details" })).toBe(document.activeElement);
  fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
  fireEvent.click(screen.getByTestId("usage-details-back"));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "View session details" }));
  expect(screen.getByRole("button", { name: "Last 7 days" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(state.detailsOptions).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: true, offset: 0, limit: 50 }),
  );
});
it("hides the detail entry when the original session count is zero", () => {
  renderUsage();
  expect(screen.queryByRole("button", { name: "View session details" })).toBeNull();
});

it("returning from an empty detail scope focuses the overview heading and finishes restoration", () => {
  state.data = createSnapshot();
  state.data.summary.totalSessions = 2;
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "View session details" }));
  state.data = { ...createSnapshot(), summary: { ...createSnapshot().summary, totalSessions: 0 } };
  fireEvent.click(screen.getByTestId("usage-details-back"));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "App usage" }));
  state.data.summary.totalSessions = 2;
  fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
  expect(document.activeElement).not.toBe(
    screen.getByRole("button", { name: "View session details" }),
  );
});
