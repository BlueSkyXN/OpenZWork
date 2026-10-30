// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppUsageSessions } from "@/hooks/useAppUsageSessions.js";
import { appUsageSessionsPageSchema } from "@zcode/shared";
const state = vi.hoisted(() => ({ service: { getAppUsageSessions: vi.fn() } }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useBaseWorkspaceServices: () => ({}) }));
vi.mock("@/hooks/appUsageServiceAccess.js", () => ({
  getLocalAppUsageService: () => state.service,
}));
afterEach(cleanup);
it("only queries the open detail view, rejects old pages and retains typed errors", async () => {
  const page = appUsageSessionsPageSchema.parse({
    range: "30d",
    timeZone: "UTC",
    generatedAt: 1,
    source: "agent-db",
    offset: 0,
    limit: 50,
    projects: [],
    rows: [],
    totalCount: 128,
    childSessionCount: 0,
    totals: { mainTokens: 0, subagentTokens: 0, totalTokens: 0 },
  });
  let old!: (value: typeof page) => void;
  state.service.getAppUsageSessions.mockImplementation((input: { offset: number }) =>
    input.offset === 0
      ? new Promise((resolve) => {
          old = resolve;
        })
      : Promise.resolve({ ...page, offset: input.offset }),
  );
  const hook = renderHook(
    ({ offset, enabled, refreshKey }) =>
      useAppUsageSessions("30d", { offset, limit: 50, enabled, refreshKey }),
    { initialProps: { offset: 0, enabled: false, refreshKey: 0 } },
  );
  expect(state.service.getAppUsageSessions).not.toHaveBeenCalled();
  hook.rerender({ offset: 0, enabled: true, refreshKey: 0 });
  await waitFor(() => expect(state.service.getAppUsageSessions).toHaveBeenCalledOnce());
  hook.rerender({ offset: 50, enabled: true, refreshKey: 0 });
  expect(hook.result.current.data).toBeNull();
  await waitFor(() => expect(hook.result.current.data?.offset).toBe(50));
  await act(async () => old(page));
  expect(hook.result.current.data?.offset).toBe(50);
  state.service.getAppUsageSessions.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "project-not-found" }),
  );
  hook.rerender({ offset: 50, enabled: true, refreshKey: 1 });
  await waitFor(() => expect(hook.result.current.errorCode).toBe("project-not-found"));
});
