import { describe, expect, it } from "vitest";
import type { ModelNetworkStatusEvent } from "@zcode/contracts";
import { buildModelStepMetrics } from "./contract.js";
const event = (fields: Record<string, unknown>) =>
  ({ requestId: "r1", attempt: 1, querySource: "main_turn", ...fields }) as ModelNetworkStatusEvent;
describe("模型步骤结算", () => {
  it("按 requestId + attempt 去重，失败用量独立保留，排除旁路", () => {
    const failed = event({
      type: "model_request_failed",
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    const complete = event({
      type: "model_request_completed",
      requestId: "r2",
      attempt: 2,
      durationMs: 2000,
      timeToFirstContentMs: 500,
      timeToFirstTextMs: 700,
      usage: { inputTokens: 100, outputTokens: 30 },
    });
    const summary = buildModelStepMetrics(
      [
        failed,
        failed,
        complete,
        event({ ...complete, requestId: "title", querySource: "session_title" }),
      ],
      "main_turn",
      "completed",
      { inputTokens: 100, outputTokens: 30 },
    );
    expect(summary.requestCount).toBe(2);
    expect(summary.failureCount).toBe(1);
    expect(summary.usage).toEqual({ inputTokens: 110, outputTokens: 32 });
    expect(summary.failedUsage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(summary.latest?.timeToFirstTextMs).toBe(700);
  });
  it("供应商未上报不补零；无网络观测时保留真实 result usage", () => {
    expect(buildModelStepMetrics([], "main_turn", "cancelled").unknownUsageCount).toBe(1);
    expect(
      buildModelStepMetrics([], "main_turn", "completed", { inputTokens: 0, outputTokens: 0 })
        .usage,
    ).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
