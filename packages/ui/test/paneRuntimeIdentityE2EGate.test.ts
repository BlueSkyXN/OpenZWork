// OZ-F012（J2）：pane runtime identity E2E 诊断的装配矩阵回归。
// 生产关闭态单列验证：build flag 缺失（生产构建恒 false）或页面无有效 run ID 时，
// 不注册诊断入口、不做额外查询；全开才启用。
import { describe, expect, it, vi } from "vitest";

const gate = async () =>
  (await import("../src/v4/pane-runtime-identity-e2e/index.js")) as typeof import("../src/v4/pane-runtime-identity-e2e/index.js");

describe("pane runtime identity E2E 装配矩阵", () => {
  it("生产关闭态：build flag 缺失时无论 run ID 如何都不启用", async () => {
    const { shouldEnablePaneRuntimeIdentityE2E } = await gate();
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: false, runId: "run-1" })).toBe(
      false,
    );
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: false, runId: null })).toBe(
      false,
    );
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: false })).toBe(false);
  });

  it("flag 开但无有效 run ID（缺失/空白）时不启用——与 Host gate 同条件", async () => {
    const { shouldEnablePaneRuntimeIdentityE2E } = await gate();
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId: null })).toBe(
      false,
    );
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId: undefined })).toBe(
      false,
    );
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId: "   " })).toBe(
      false,
    );
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId: "" })).toBe(false);
  });

  it("flag + 非空 run ID 同时满足才启用", async () => {
    const { shouldEnablePaneRuntimeIdentityE2E } = await gate();
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId: "run-abc" })).toBe(
      true,
    );
  });

  it("run ID 从页面 URL 参数读取（desktop 注入 / 手机配对 URL 追加同一参数名）", async () => {
    const { readPaneRuntimeIdentityE2ERunId, PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM } =
      await gate();
    expect(PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM).toBe("zcodeE2eRunId");
    vi.stubGlobal("window", {
      location: { search: "?a=1&zcodeE2eRunId=run-xyz" },
    } as unknown as Window);
    try {
      expect(readPaneRuntimeIdentityE2ERunId()).toBe("run-xyz");
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal("window", { location: { search: "" } } as unknown as Window);
    try {
      expect(readPaneRuntimeIdentityE2ERunId()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
