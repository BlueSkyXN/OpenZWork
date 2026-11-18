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
    expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: false, runId: undefined })).toBe(
      false,
    );
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

  it("桌面 URL 的 run ID 优先于 sessionStorage", async () => {
    const { readPaneRuntimeIdentityE2ERunId, PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM } =
      await gate();
    expect(PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM).toBe("zcodeE2eRunId");
    vi.stubGlobal("window", {
      location: { search: "?a=1&zcodeE2eRunId=run-xyz" },
      sessionStorage: { getItem: () => "run-storage" },
    } as unknown as Window);
    try {
      expect(readPaneRuntimeIdentityE2ERunId()).toBe("run-xyz");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("手机 URL 没有查询参数也从 sessionStorage 读取 run ID", async () => {
    const { readPaneRuntimeIdentityE2ERunId, shouldEnablePaneRuntimeIdentityE2E } = await gate();
    const getItem = vi.fn(() => " run-storage ");
    vi.stubGlobal("window", { location: { search: "" }, sessionStorage: { getItem } });
    try {
      const runId = readPaneRuntimeIdentityE2ERunId();
      expect(runId).toBe("run-storage");
      expect(getItem).toHaveBeenCalledWith("zcodeE2eRunId");
      expect(shouldEnablePaneRuntimeIdentityE2E({ bridgeFlagEnabled: true, runId })).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("缺省 location 和 storage 时没有可用 run ID", async () => {
    const { readPaneRuntimeIdentityE2ERunId } = await gate();
    vi.stubGlobal("window", {});
    try {
      expect(readPaneRuntimeIdentityE2ERunId()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("浏览器拒绝存储访问时关闭诊断", async () => {
    const { readPaneRuntimeIdentityE2ERunId } = await gate();
    vi.stubGlobal("window", {
      location: { search: "" },
      get sessionStorage() {
        throw new DOMException("Storage is unavailable", "SecurityError");
      },
    });
    try {
      expect(readPaneRuntimeIdentityE2ERunId()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
