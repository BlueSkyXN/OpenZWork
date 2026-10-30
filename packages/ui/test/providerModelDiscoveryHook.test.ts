// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProviderModelDiscovery } from "@/hooks/useProviderModelDiscovery.js";
const service = vi.hoisted(() => ({ discoverModels: vi.fn(), resolveModelConfig: vi.fn() }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ providerSettingsService: service }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("switching Provider and closing reject late discovery results", async () => {
  let settleA!: (result: unknown) => void;
  service.discoverModels.mockImplementation((id: string) =>
    id === "a"
      ? new Promise((resolve) => {
          settleA = resolve;
        })
      : Promise.resolve({
          ok: true,
          models: [{ modelId: "b-model", configComplete: true }],
          truncated: false,
        }),
  );
  const view = renderHook(({ id, open }) => useProviderModelDiscovery(id, open), {
    initialProps: { id: "a", open: false },
  });
  expect(service.discoverModels).not.toHaveBeenCalled();
  view.rerender({ id: "a", open: true });
  view.rerender({ id: "b", open: true });
  await waitFor(() => expect(view.result.current.result?.ok).toBe(true));
  await act(async () => settleA({ ok: true, models: [{ modelId: "a-model" }], truncated: false }));
  expect(JSON.stringify(view.result.current.result)).toContain("b-model");
  expect(JSON.stringify(view.result.current.result)).not.toContain("a-model");
  view.rerender({ id: "b", open: false });
  expect(view.result.current.result).toBeNull();
});
