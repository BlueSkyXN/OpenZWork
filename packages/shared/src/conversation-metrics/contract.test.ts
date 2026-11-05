import { describe, expect, it } from "vitest";
import {
  mainUsageFromParts,
  mainUsageSchema,
  mergeMetrics,
  modelStepMetricsSchema,
  tokensPerSecond,
} from "./contract.js";

describe("原生指标合同", () => {
  it("主链持久化保留部分上报和明确零，不把缺项补成零", () => {
    expect(mainUsageSchema.parse({ outputTokens: 0, cacheReadTokens: 0 })).toEqual({
      outputTokens: 0,
      cacheReadTokens: 0,
    });
    expect(mainUsageSchema.safeParse({ inputTokens: -1 }).success).toBe(false);
    expect(
      modelStepMetricsSchema.parse({
        messageId: "a",
        requestCount: 1,
        failureCount: 0,
        unknownUsageCount: 1,
        mainUsage: { outputTokens: 30 },
      }).mainUsage,
    ).toEqual({ outputTokens: 30 });
    expect(mainUsageFromParts([])).toBeUndefined();
    const part = (mainUsage: unknown) => ({
      type: "step-start",
      modelMetrics: {
        messageId: "a",
        requestCount: 1,
        failureCount: 0,
        unknownUsageCount: 0,
        mainUsage,
      },
    });
    expect(mainUsageFromParts([part({})])).toEqual({});
    expect(mainUsageFromParts([part({ cacheReadTokens: 0 })])).toEqual({ cacheReadTokens: 0 });
  });
  it("总量不重复加入 cache，合法零与缺项分开", () => {
    const a = {
      requestCount: 1,
      failureCount: 0,
      unknownUsageCount: 0,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 },
    };
    expect(mergeMetrics(a, a).usage).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 160,
    });
    expect(
      mergeMetrics(undefined, { ...a, usage: undefined, unknownUsageCount: 1 }).usage,
    ).toBeUndefined();
    expect(
      modelStepMetricsSchema.safeParse({
        messageId: "a",
        ...a,
        usage: { inputTokens: -1, outputTokens: 0 },
      }).success,
    ).toBe(false);
  });
  it("速度只使用同一请求的有效生成区间，失败和未知不取墙钟兜底", () => {
    expect(
      tokensPerSecond({
        status: "completed",
        durationMs: 3000,
        timeToFirstContentMs: 1000,
        outputTokens: 100,
      }),
    ).toBe(50);
    expect(
      tokensPerSecond({ status: "completed", durationMs: 3000, outputTokens: 100 }),
    ).toBeNull();
    expect(
      tokensPerSecond({
        status: "failed",
        durationMs: 3000,
        timeToFirstContentMs: 1000,
        outputTokens: 100,
      }),
    ).toBeNull();
    expect(
      tokensPerSecond({
        status: "completed",
        durationMs: 1000,
        timeToFirstContentMs: 1000,
        outputTokens: 100,
      }),
    ).toBeNull();
  });
});
