// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppUsageStats } from "@/hooks/useAppUsageStats.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";
const source = vi.hoisted(() => ({
  service: null as { getAppUsageStats: ReturnType<typeof vi.fn> } | null,
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useBaseWorkspaceServices: () => ({}) }));
vi.mock("@/hooks/appUsageServiceAccess.js", () => ({
  getLocalAppUsageService: () => source.service,
}));
afterEach(cleanup);
it("未展开不查询，换本地 authority 后拒收旧响应", async () => {
  let resolveA!: (data: ReturnType<typeof createSnapshot>) => void;
  const a = {
    getAppUsageStats: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    ),
  };
  const b = { getAppUsageStats: vi.fn(async () => ({ ...createSnapshot(), generatedAt: 200 })) };
  source.service = a;
  const hook = renderHook(({ enabled }) => useAppUsageStats("7d", { enabled }), {
    initialProps: { enabled: false },
  });
  expect(a.getAppUsageStats).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(a.getAppUsageStats).toHaveBeenCalledOnce());
  source.service = b;
  hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.data?.generatedAt).toBe(200));
  await act(async () => resolveA({ ...createSnapshot(), generatedAt: 100 }));
  expect(hook.result.current.data?.generatedAt).toBe(200);
  source.service = null;
  hook.rerender({ enabled: true });
  expect(hook.result.current.available).toBe(false);
  expect(hook.result.current.data).toBeNull();
});
