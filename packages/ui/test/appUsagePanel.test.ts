// @vitest-environment jsdom
import { createElement } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUsageSnapshot } from "@zcode/shared";
import { AppUsageSection } from "@/settings/usage-stats/AppUsageSection.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import en from "@/i18n/locales/en-US.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";

const state = vi.hoisted(() => ({
  data: null as AppUsageSnapshot | null, available: true, loading: false, error: null as string | null,
  refresh: vi.fn(), ranges: vi.fn(),
}));
vi.mock("@/hooks/useAppUsageStats.js", () => ({ useAppUsageStats: (range: string) => { state.ranges(range); return state; } }));
afterEach(cleanup);
beforeEach(() => { Object.assign(state, { data: createSnapshot(), available: true, loading: false, error: null }); vi.clearAllMocks(); });
function renderUsage() { return render(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(AppUsageSection))); }

describe("本地 App Usage 页面", () => {
  it("展示实际累计值并将范围选择交给现有查询 hook", () => {
    renderUsage();
    expect(screen.getByText("20,650,000,000")).toBeTruthy();
    expect(state.ranges).toHaveBeenLastCalledWith("30d");
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.range.7d"] }));
    expect(state.ranges).toHaveBeenLastCalledWith("7d");
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.refresh"] }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("没有本地服务时禁止刷新且不展示旧统计", () => {
    Object.assign(state, { available: false, data: null });
    renderUsage();
    expect(screen.getByRole("status").textContent).toBe(en["settings.usage.localUnavailable"]);
    expect((screen.getByRole("button", { name: en["settings.usage.refresh"] }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("20,650,000,000")).toBeNull();
  });
  it("失败保留重试动作，加载期间不重复提交", () => {
    Object.assign(state, { error: "fixture failure", data: null });
    renderUsage();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["settings.usage.retry"] }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("加载状态显示进度并禁用刷新", () => {
    Object.assign(state, { loading: true, data: null });
    renderUsage();
    expect(screen.getByRole("status").textContent).toContain(en["settings.usage.loadingTitle"]);
    expect((screen.getByRole("button", { name: en["settings.usage.refresh"] }) as HTMLButtonElement).disabled).toBe(true);
  });
});
