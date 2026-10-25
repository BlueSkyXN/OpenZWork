import { describe, expect, it } from "vitest";
import { todayTokens, latestMetricsTurn } from "./contract.js";
import type { AppUsageSnapshot } from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";

describe("指标日期和当前轮", () => {
  it("使用生成时间和快照时区跨日选桶，不混用本机时区", () => {
    const snapshot = {
      generatedAt: Date.parse("2026-10-25T17:00:00Z"),
      timeZone: "Asia/Shanghai",
      dailyModelUsage: [
        { date: "2026-10-25", models: [{ totalTokens: 10 }] },
        { date: "2026-10-26", models: [{ totalTokens: 20 }, { totalTokens: 30 }] },
      ],
    } as AppUsageSnapshot;
    expect(todayTokens(snapshot)).toBe(50);
    expect(todayTokens({ ...snapshot, timeZone: "UTC" })).toBe(10);
    expect(todayTokens({ ...snapshot, dailyModelUsage: [] })).toBe(0);
  });
  it("只读取最新可执行轮；空草稿没有上个会话的指标", () => {
    expect(
      latestMetricsTurn({ rows: { window: [] } } as unknown as ConversationSnapshot),
    ).toBeUndefined();
    const header = { kind: "turnHeader", turnId: "new", executionKind: "agent" };
    expect(
      latestMetricsTurn({
        rows: { window: [{ kind: "turnHeader", turnId: "old" }, header] },
      } as unknown as ConversationSnapshot),
    ).toBe(header);
  });
});
