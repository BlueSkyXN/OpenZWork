// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { AppUsageSection } from "@/settings/usage-stats/AppUsageSection.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
function createSnapshot(
  overrides: Partial<AppUsageSnapshot> & { range?: AppUsageRange } = {},
): AppUsageSnapshot {
  return {
    range: overrides.range ?? "all",
    generatedAt: 0,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 20_650_000_000,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 0,
      totalTurns: 0,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 0,
      currentStreakDays: 5,
      longestSessionMs: 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
      longestStreakDays: 34,
      peakDayTokens: 370_000_000,
      favoriteModel: null,
    },
    heatmap: {
      startDate: null,
      endDate: null,
      maxTokens: 370_000_000,
      weeks: [],
    },
    dailyModelUsage: [],
    models: [],
    tools: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useRemoteWorkspaceSessionStore.setState({ baseServices: null, localBaseServices: null });
});
describe("local App Usage", () => {
  it("reads the registered local base and changes its query range", async () => {
    const getAppUsageStats = vi.fn(async ({ range }: { range: AppUsageRange }) =>
      createSnapshot({ range }),
    );
    const local = { appUsageService: { getAppUsageStats } } as unknown as IServiceAccessor;
    const remoteRead = vi.fn();
    const remote = {
      appUsageService: { getAppUsageStats: remoteRead },
    } as unknown as IServiceAccessor;
    useRemoteWorkspaceSessionStore.setState({ baseServices: local, localBaseServices: local });
    render(
      createElement(
        ServiceProvider,
        { services: remote },
        createElement(
          ZCodeIntlProvider,
          { initialLocale: "en-US" },
          createElement(AppUsageSection),
        ),
      ),
    );
    await screen.findByText("20,650,000,000");
    expect(getAppUsageStats).toHaveBeenCalledWith(expect.objectContaining({ range: "30d" }));
    expect(remoteRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(getAppUsageStats).toHaveBeenLastCalledWith(expect.objectContaining({ range: "7d" })),
    );
  });
});
