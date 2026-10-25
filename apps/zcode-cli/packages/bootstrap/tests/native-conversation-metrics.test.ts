import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { SessionEventType, type SessionEvent, type MessageWithParts } from "@zcode/contracts";
import { applyConversationDeltas, turnHeaderRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { ProductProjection } from "../src/zcode-protocol-v4/product-projection.js";
import {
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
