// @vitest-environment jsdom
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  snapshot: {
    settings: null as null | { systemPromptSettings?: undefined },
    loading: true,
    error: null as unknown,
  },
  getSystemPromptCatalog: vi.fn(async () => ({ version: 1, sections: [] })),
}));
vi.mock("@/hooks/useServices.js", () => {
  const services = {
    zcodeAgentService: { getSystemPromptCatalog: state.getSystemPromptCatalog },
    settingService: { get: vi.fn() },
  };
  return { useServices: () => services };
});
vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ ...state.snapshot, update: vi.fn(), refresh: vi.fn() }),
}));
import { useSystemPromptSettings } from "@/settings/system-prompt/hooks/useSystemPromptSettings.js";
afterEach(cleanup);
describe("prompt settings loading boundary", () => {
  it("only hides the editor for its initial load, not a save refresh", () => {
    state.snapshot = { settings: null, loading: true, error: null };
    const { result, rerender } = renderHook(useSystemPromptSettings);
    expect(result.current.loading).toBe(true);
    state.snapshot = { settings: {}, loading: true, error: null };
    rerender();
    expect(result.current.loading).toBe(false);
    state.snapshot = { settings: {}, loading: false, error: new Error("refresh failed") };
    rerender();
    expect(result.current.error).toBeNull();
  });
});

it("目录服务未连接时显示可重试错误", async () => {
  state.getSystemPromptCatalog.mockResolvedValueOnce(undefined as never);
  const { result } = renderHook(() => useSystemPromptSettings());
  await vi.waitFor(() => expect(result.current.error).toBeTruthy());
});
