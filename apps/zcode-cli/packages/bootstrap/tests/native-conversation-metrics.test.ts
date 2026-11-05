import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { SessionEventType, type SessionEvent, type MessageWithParts } from "@zcode/contracts";
import { applyConversationDeltas, turnHeaderRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { ProductProjection } from "../src/zcode-protocol-v4/product-projection.js";
import { resolveSessionContextUsage } from "../src/zcode-protocol/session-mapper.js";
import type { SessionProjection } from "@zcode/contracts";
import {
  cumulativeIncompleteFieldsFromMessages,
  eventsCoverTranscript,
  synthesizeEventsFromMessages,
} from "../src/zcode-protocol-v4/transcript-hydration.js";
const metrics = {
  messageId: "a",
  mainUsage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 80, cacheWriteTokens: 0 },
  requestCount: 2,
  failureCount: 1,
  unknownUsageCount: 0,
  usage: { inputTokens: 110, outputTokens: 32, cacheReadTokens: 80 },
  failedUsage: { inputTokens: 10, outputTokens: 2 },
  latest: {
    status: "completed" as const,
    durationMs: 3000,
    timeToFirstContentMs: 1000,
    timeToFirstTextMs: 1400,
    outputTokens: 30,
  },
};
const event = (seq: number, type: SessionEvent["type"], payload: unknown): SessionEvent => ({
  id: `e${seq}` as never,
  sessionId: "s" as never,
  turnId: "t" as never,
  traceId: "trace" as never,
  sequenceNumber: seq,
  timestamp: new Date(seq * 1000),
  type,
  payload,
});
const header = (p: ProductProjection) =>
  p.getSnapshot().rows.window.find((row) => row.kind === "turnHeader");
describe("NCM 指标投影与持久化", () => {
  it("OW-P021：缺 usage 后保持未知，切模与迟到 seed 不恢复旧水位", () => {
    // OW-P021：保留已知计数，最新上下文未知不能被容量或历史 seed 重新变成旧水位。
    const p = new ProductProjection("s", "epoch");
    p.applyEvent(
      event(1, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        contextWindow: 200000,
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 600,
          cacheWriteTokens: 100,
        },
      }),
    );
    p.applyEvent(
      event(2, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        contextWindow: 200000,
        usage: {},
      }),
    );
    expect(p.getSnapshot().usage.contextWindow).toBeNull();
    expect(p.getSnapshot().usage.cumulativeIncompleteFields).toEqual([
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ]);
    p.seedUsage({
      contextWindow: { usedTokens: 1200, maxTokens: 200000, autoCompactThresholdTokens: null },
    });
    p.applyEvent(
      event(3, SessionEventType.ModelSelected, {
        modelSelection: { providerId: "p", modelId: "m" },
        contextWindow: 1000000,
      }),
    );
    expect(p.getSnapshot().usage.contextWindow).toBeNull();
    p.applyEvent(
      event(4, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        usage: { inputTokens: 1500, outputTokens: 300 },
      }),
    );
    expect(p.getSnapshot().usage.contextWindow).toMatchObject({
      usedTokens: 1800,
      maxTokens: 1000000,
    });
    expect(p.getSnapshot().usage.cumulative.inputTokens).toBe(2500);
  });

  it("累计缺项 seed 不依赖上下文；新用量不能补齐旧缺项", () => {
    const p = new ProductProjection("s", "epoch");
    p.seedUsage({ cumulativeIncompleteFields: ["inputTokens", "outputTokens"] });
    expect(p.getSnapshot().usage.cumulativeIncompleteFields).toEqual([
      "inputTokens",
      "outputTokens",
    ]);
    p.applyEvent(
      event(1, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        contextWindow: 200000,
        usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    );
    expect(p.getSnapshot().usage.cumulativeIncompleteFields).toEqual([
      "inputTokens",
      "outputTokens",
    ]);
    expect(p.getSnapshot().usage.cumulative.inputTokens).toBe(100);
  });

  it("旧、新与部分上报历史恢复相同已知和，并排除失败与继承上下文", () => {
    const user: MessageWithParts = {
      info: {
        id: "u" as never,
        sessionID: "s" as never,
        role: "user",
        time: { created: 1000 },
        agent: "agent",
      },
      parts: [
        {
          id: "u-text" as never,
          sessionID: "s" as never,
          messageID: "u" as never,
          type: "text",
          text: "hi",
        },
      ],
    };
    const assistant = (id: string, mainUsage?: Record<string, number>): MessageWithParts => ({
      info: {
        id: id as never,
        sessionID: "s" as never,
        parentID: "u" as never,
        role: "assistant",
        time: { created: 1100, completed: 2000 },
        mode: "build",
        agent: "agent",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 100, output: 30, reasoning: 0, cache: { read: 80, write: 0 } },
      },
      parts: [
        ...(mainUsage
          ? [
              {
                id: `${id}-metrics` as never,
                sessionID: "s" as never,
                messageID: id as never,
                type: "step-start" as const,
                modelMetrics: { ...metrics, messageId: id, mainUsage },
              },
            ]
          : []),
        {
          id: `${id}-text` as never,
          sessionID: "s" as never,
          messageID: id as never,
          type: "text",
          text: "hello",
        },
      ],
    });
    const restore = (messages: MessageWithParts[]) => {
      const p = new ProductProjection("s", "cold");
      for (const e of synthesizeEventsFromMessages(messages, { sessionId: "s" })) p.applyEvent(e);
      p.seedUsage({ cumulativeIncompleteFields: cumulativeIncompleteFieldsFromMessages(messages) });
      return p.getSnapshot().usage;
    };
    const old = assistant("old");
    expect(restore([user, old]).cumulativeIncompleteFields).toEqual([
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ]);
    expect(restore([user, old]).cumulative.inputTokens).toBe(0);
    const current = assistant("current", metrics.mainUsage);
    expect(restore([user, current]).cumulative).toEqual(metrics.mainUsage);
    expect(restore([user, current]).cumulativeIncompleteFields).toBeUndefined();
    expect(restore([user, old, current]).cumulative).toEqual(metrics.mainUsage);
    expect(restore([user, old, current]).cumulativeIncompleteFields).toHaveLength(4);
    const partial = restore([
      user,
      assistant("partial", { outputTokens: 30, cacheReadTokens: 10 }),
    ]);
    expect(partial.cumulative).toEqual({
      inputTokens: 0,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
    });
    expect(partial.cumulativeIncompleteFields).toEqual(["inputTokens", "cacheWriteTokens"]);
    // OW-P021：最新持久步骤明确未知时，不越过它恢复 runtime/旧 assistant 的正数。
    const unknown = assistant("unknown", {});
    if (unknown.info.role === "assistant")
      unknown.info.tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    const context = resolveSessionContextUsage({
      messages: [user, current, unknown],
      projection: { contextUsed: 130, contextWindow: 200000 } as SessionProjection,
    });
    expect(context).toBeUndefined();
    const cold = new ProductProjection("s", "cold");
    for (const e of synthesizeEventsFromMessages([user, current, unknown], {
      sessionId: "s",
      contextWindow: 200000,
    }))
      cold.applyEvent(e);
    cold.seedUsage({
      contextWindow: null,
      cumulativeIncompleteFields: cumulativeIncompleteFieldsFromMessages([user, current, unknown]),
    });
    expect(cold.getSnapshot().usage.contextWindow).toBeNull();
    const failed = assistant("failed");
    if (failed.info.role === "assistant")
      failed.info.error = { name: "ModelError", data: { message: "fixture" } };
    expect(cumulativeIncompleteFieldsFromMessages([failed])).toEqual([]);
    const inherited = assistant("inherited");
    inherited.info.visibility = "model-only";
    expect(cumulativeIncompleteFieldsFromMessages([inherited])).toEqual([]);
  });

  it("累计未采集不清除独立来源的历史平均缓存率", () => {
    const p = new ProductProjection("s", "epoch");
    const cache = {
      inputTokens: 1000,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
      hitRate: 0.8,
      latestHitRate: 0.8,
      hitRateRequestCount: 1,
      totalInputTokens: 1000,
      totalCacheReadTokens: 800,
      totalCacheWriteTokens: 0,
    };
    p.applyEvent(
      event(1, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        contextWindow: 200000,
        cacheHit: cache,
        usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0 },
      }),
    );
    expect(p.getSnapshot().usage.contextWindow?.cache?.hitRate).toBe(0.8);
    p.seedUsage({ cumulativeIncompleteFields: ["cacheReadTokens"] });
    expect(p.getSnapshot().usage.contextWindow?.cache?.hitRate).toBe(0.8);
    p.applyEvent(
      event(2, SessionEventType.ModelComplete, {
        querySource: "main_turn",
        contextWindow: 200000,
        cacheHit: cache,
        usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0 },
      }),
    );
    expect(p.getSnapshot().usage.contextWindow?.cache?.hitRate).toBe(0.8);
  });

  it("duplicate settled、原子拒收重试与双交付都保持一次计数", () => {
    const p = new ProductProjection("s", "epoch");
    p.applyEvent(event(1, SessionEventType.TurnStarted, { turnNumber: 1, input: "hello" }));
    const before = p.getSnapshot();
    const fact = event(2, SessionEventType.ModelMetricsSettled, metrics);
    expect(p.applyEventAtomically(fact, () => false)).toBeNull();
    expect(header(p)?.metrics).toBeUndefined();
    const deltas = p.applyEvent(fact);
    p.applyEvent(event(3, SessionEventType.ModelMetricsSettled, metrics));
    expect(header(p)?.metrics?.requestCount).toBe(2);
    expect(p.getSnapshot().usage.cumulative.inputTokens).toBe(0);
    expect(header(p)?.metrics?.usage?.inputTokens).toBe(110);
    const replay = applyConversationDeltas(applyConversationDeltas(before, deltas), deltas);
    expect(replay.rows.window.find((row) => row.kind === "turnHeader")?.metrics).toEqual(
      header(p)?.metrics,
    );
    expect(turnHeaderRowSchema.safeParse(header(p)).success).toBe(true);
  });
  it("工具状态按 ID 计数；终态后的迟到摘要不覆盖历史", () => {
    const p = new ProductProjection("s", "epoch");
    p.applyEvent(event(1, SessionEventType.TurnStarted, { turnNumber: 1, input: "read" }));
    p.applyEvent(
      event(2, SessionEventType.ToolCallScheduled, {
        toolCallId: "tool",
        toolName: "Read",
        args: {},
      }),
    );
    p.applyEvent(
      event(3, SessionEventType.ToolCallError, {
        toolCallId: "tool",
        toolName: "Read",
        error: { type: "tool_execution_failed", message: "fixture" },
      }),
    );
    p.applyEvent(
      event(4, SessionEventType.ToolCallError, {
        toolCallId: "tool",
        toolName: "Read",
        error: { type: "tool_execution_failed", message: "fixture" },
      }),
    );
    expect(header(p)).toMatchObject({ toolCallCount: 1, toolErrorCount: 1 });
    p.applyEvent(
      event(5, SessionEventType.TurnComplete, {
        response: "",
        tokenCount: 0,
        toolCallCount: 1,
        duration: 4000,
        resultType: "success",
      }),
    );
    p.applyEvent(event(6, SessionEventType.ModelMetricsSettled, metrics));
    expect(header(p)?.metrics).toBeUndefined();
    expect(header(p)).toMatchObject({ toolCallCount: 1, toolErrorCount: 1 });
  });

  it("SQLite 关闭重开后通过 transcript 恢复摘要；旧 part 不伪造指标", async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-metrics-"));
    const dbPath = join(directory, "sessions.sqlite");
    let store = await createSqliteSessionStore({ dbPath });
    const messages: MessageWithParts[] = [
      {
        info: {
          id: "u" as never,
          sessionID: "s" as never,
          role: "user",
          time: { created: 1000 },
          agent: "agent",
        },
        parts: [
          {
            id: "u-text" as never,
            sessionID: "s" as never,
            messageID: "u" as never,
            type: "text",
            text: "hi",
          },
        ],
      },
      {
        info: {
          id: "a" as never,
          sessionID: "s" as never,
          role: "assistant",
          parentID: "u" as never,
          time: { created: 1100, completed: 5000 },
          mode: "build",
          agent: "agent",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 100, output: 30, reasoning: 0, cache: { read: 80, write: 0 } },
        },
        parts: [
          {
            id: "metrics-part" as never,
            sessionID: "s" as never,
            messageID: "a" as never,
            type: "step-start",
            modelMetrics: metrics,
          },
          {
            id: "a-text" as never,
            sessionID: "s" as never,
            messageID: "a" as never,
            type: "text",
            text: "hello",
          },
        ],
      },
    ];
    try {
      await store.createSession({
        id: "s" as never,
        projectID: "p" as never,
        slug: "s",
        directory,
        title: "test",
        version: "1",
      });
      for (const message of messages) {
        await store.saveMessage(message.info);
        for (const part of message.parts) await store.savePart(part);
      }
      await store.close();
      store = await createSqliteSessionStore({ dbPath });
      const persisted = await store.messages({ sessionID: "s" as never });
      const p = new ProductProjection("s", "cold");
      p.beginHydrationReplay();
      for (const e of synthesizeEventsFromMessages(persisted, { sessionId: "s" }))
        p.applyHydrationEvent(e);
      p.completeHydrationReplay();
      expect(header(p)?.metrics).toMatchObject({
        requestCount: 2,
        failureCount: 1,
        usage: metrics.usage,
        latest: metrics.latest,
      });
      expect(p.getSnapshot().usage.cumulative).toEqual(metrics.mainUsage);
      const events = synthesizeEventsFromMessages(persisted, { sessionId: "s" });
      expect(eventsCoverTranscript(events, persisted)).toBe(true);
      expect(
        eventsCoverTranscript(
          events.filter((e) => e.type !== SessionEventType.ModelMetricsSettled),
          persisted,
        ),
      ).toBe(false);
      const legacy = persisted.map((m) => ({
        ...m,
        parts: m.parts.filter((part) => part.type !== "step-start"),
      }));
      expect(
        synthesizeEventsFromMessages(legacy, { sessionId: "s" }).some(
          (e) => e.type === SessionEventType.ModelMetricsSettled,
        ),
      ).toBe(false);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
