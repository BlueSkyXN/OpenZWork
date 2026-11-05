import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runWithModelInvocationContext,
  type ModelNetworkStatusEvent,
  type ModelStreamEvent,
} from "@zcode/contracts";
import { calculateOutputTps } from "@zcode/shared";
import { createProviderBusinessErrorFetch } from "../src/model/model-execution.js";
import { normalizeGenerateUsage } from "../src/model/runner-normalization.js";
import type { AiSdkGenerateTextResult } from "../src/model/runner-runtime.js";
import { TestAiSdkModelAdapter, TestProviderConfigFixture } from "./test-provider-config.js";

type Frame = Record<string, unknown>;
type ScheduledFrame = [number, Frame | Error];
const ORIGIN = 1_800_000_000_000;
const END_MS = 1000;
const OUTPUT_TOKENS = 70;

function installTransport(create: () => Response) {
  let count = 0;
  const waiters = new Map<number, ReturnType<typeof Promise.withResolvers<void>>>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const result = create();
      waiters.get(++count)?.resolve();
      return result;
    }),
  );
  return (request = 1): Promise<void> => {
    if (count >= request) return Promise.resolve();
    const waiter = Promise.withResolvers<void>();
    waiters.set(request, waiter);
    return waiter.promise;
  };
}

function response(frames: ScheduledFrame[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const [at, frame] of frames) {
          setTimeout(() => {
            if (frame instanceof Error) controller.error(frame);
            else controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          }, at);
        }
        if (!frames.some(([, frame]) => frame instanceof Error)) {
          setTimeout(() => controller.close(), END_MS);
        }
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function anthropicFrames(kind: "tool" | "text" | "reasoning", firstMs = 300): ScheduledFrame[] {
  const block =
    kind === "tool"
      ? { type: "tool_use", id: "call_read", name: "Read", input: {} }
      : kind === "reasoning"
        ? { type: "thinking", thinking: "" }
        : { type: "text", text: "" };
  const delta =
    kind === "tool"
      ? { type: "input_json_delta", partial_json: '{"path":"example.txt"}' }
      : kind === "reasoning"
        ? { type: "thinking_delta", thinking: "think" }
        : { type: "text_delta", text: "a" };
  return [
    [50, { type: "ping" }],
    [
      100,
      {
        type: "message_start",
        message: {
          id: "message",
          type: "message",
          role: "assistant",
          model: "model",
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ],
    [200, { type: "content_block_start", index: 0, content_block: block }],
    [
      250,
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          ...delta,
          ...(kind === "tool"
            ? { partial_json: "" }
            : kind === "reasoning"
              ? { thinking: "" }
              : { text: "" }),
        },
      },
    ],
    [firstMs, { type: "content_block_delta", index: 0, delta }],
    [900, { type: "content_block_stop", index: 0 }],
    [
      950,
      {
        type: "message_delta",
        delta: { stop_reason: kind === "tool" ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: OUTPUT_TOKENS },
      },
    ],
    [END_MS, { type: "message_stop" }],
  ];
}

function harness(kind: "anthropic" | "openai-compatible" | "openai" = "anthropic") {
  const status: ModelNetworkStatusEvent[] = [];
  const visible: Array<{ at: number; event: ModelStreamEvent }> = [];
  const adapter = new TestAiSdkModelAdapter({
    env: { ZCODE_RUNTIME_ENV: "test" },
    registry: new TestProviderConfigFixture({
      env: {},
      providers: {
        test: { kind, baseURL: "https://model.example.test/v1", apiKey: "fixture-key" },
      },
    }),
    retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    statusSink: {
      publish: (event) => {
        status.push(event);
      },
    },
  });
  const model = adapter.createModel({ providerId: "test", modelId: "model" });
  return {
    status,
    visible,
    async run() {
      const stream = runWithModelInvocationContext({ metadata: { querySource: "main_turn" } }, () =>
        model.streamText({
          messages: [{ role: "user", content: "read" }],
          tools: [
            {
              name: "Read",
              inputSchema: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          ],
        }),
      );
      for await (const event of stream) visible.push({ at: Date.now() - ORIGIN, event });
    },
    completed() {
      const event = status.findLast((entry) => entry.type === "model_request_completed");
      expect(event?.type).toBe("model_request_completed");
      if (event?.type !== "model_request_completed") throw new Error("Missing completion");
      return event;
    },
  };
}

describe("provider receive timing before stream buffers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ORIGIN);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("times Responses tool arguments before the real SDK releases the completed call", async () => {
    const call = {
      type: "function_call",
      id: "fc_read",
      call_id: "call_read",
      name: "Read",
      arguments: '{"path":"example.txt"}',
    };
    const started = installTransport(() =>
      response([
        [
          100,
          {
            type: "response.created",
            response: { id: "resp_timing", created_at: 1, model: "model" },
          },
        ],
        [
          200,
          { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
        ],
        [
          250,
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            item_id: "fc_read",
            delta: "",
          },
        ],
        [
          300,
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            item_id: "fc_read",
            delta: call.arguments,
          },
        ],
        [900, { type: "response.output_item.done", output_index: 0, item: call }],
        [
          END_MS,
          {
            type: "response.completed",
            response: {
              id: "resp_timing",
              usage: { input_tokens: 10, output_tokens: OUTPUT_TOKENS },
            },
          },
        ],
      ]),
    );
    const run = harness("openai");
    const done = run.run();
    await started();
    await vi.advanceTimersByTimeAsync(1200);
    await done;
    expect(run.completed()).toMatchObject({ timeToFirstContentMs: 300, durationMs: END_MS });
    // SDK 可在 item done 或 response completed 释放参数；首输出计时均须保留线协议接收时刻。
    expect(
      run.visible.find(({ event }) => event.type === "tool_input_delta")?.at,
    ).toBeGreaterThanOrEqual(900);
    expect(calculateOutputTps(OUTPUT_TOKENS, END_MS - run.completed().timeToFirstContentMs!)).toBe(
      100,
    );
  });

  it.each(["tool", "text", "reasoning"] as const)(
    "times %s at the first non-empty wire delta",
    async (kind) => {
      const started = installTransport(() => response(anthropicFrames(kind)));
      const run = harness();
      const done = run.run();
      await started();
      await vi.advanceTimersByTimeAsync(END_MS + 100);
      await done;
      const completed = run.completed();
      expect(completed.timeToFirstContentMs).toBe(300);
      expect(run.status.find((event) => event.type === "model_first_content")).toMatchObject({
        elapsedMs: 300,
        timestamp: new Date(ORIGIN + 300).toISOString(),
      });
      expect(completed.durationMs).toBe(END_MS);
      expect(
        calculateOutputTps(
          completed.usage?.outputTokens,
          completed.durationMs! - completed.timeToFirstContentMs!,
        ),
      ).toBe(100);
      if (kind === "tool" || kind === "text") {
        const first = run.visible.find(
          ({ event }) => event.type === (kind === "tool" ? "tool_input_delta" : "text_delta"),
        );
        expect(first?.at).toBe(900);
      }
    },
  );

  it("keeps the retry buffer and starts timing anew after a partial tool attempt fails", async () => {
    let attempt = 0;
    const started = installTransport(() => {
      attempt += 1;
      return response(
        attempt === 1
          ? [
              ...anthropicFrames("tool").filter(([at]) => at <= 300),
              [400, Object.assign(new Error("connection reset"), { code: "ECONNRESET" })],
            ]
          : anthropicFrames("tool", 500),
      );
    });
    const run = harness();
    const done = run.run();
    await started();
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(attempt).toBe(2);
    expect(run.completed().timeToFirstContentMs).toBe(500);
    expect(run.visible.filter(({ event }) => event.type === "tool_call")).toHaveLength(1);
    expect(
      new Set(
        run.status
          .filter((event) => event.type === "model_request_started")
          .map((event) => event.requestId),
      ).size,
    ).toBe(2);
  });

  it("isolates simultaneous requests with different first-content times", async () => {
    let call = 0;
    const started = installTransport(() =>
      response(anthropicFrames("tool", ++call === 1 ? 300 : 600)),
    );
    const run = harness();
    const done = Promise.all([run.run(), run.run()]);
    await started(2);
    await vi.advanceTimersByTimeAsync(1200);
    await done;
    expect(
      run.status
        .filter((event) => event.type === "model_request_completed")
        .map((event) => event.timeToFirstContentMs)
        .sort(),
    ).toEqual([300, 600]);
  });

  it("does not invent timing from empty frames or SDK synthetic start", async () => {
    const frames = anthropicFrames("text").filter(([at]) => at !== 300);
    const started = installTransport(() => response(frames));
    const run = harness();
    const done = run.run();
    await started();
    await vi.advanceTimersByTimeAsync(1200);
    await done;
    expect(run.completed().timeToFirstContentMs).toBeUndefined();
  });
  it.each(["text", "reasoning", "tool"] as const)(
    "times compatible %s output through the real SDK",
    async (kind) => {
      const chunk = (delta: Frame, finish_reason: string | null = null) => ({
        id: "chatcmpl-timing",
        object: "chat.completion.chunk",
        created: 1,
        model: "model",
        choices: [{ index: 0, delta, finish_reason }],
      });
      const delta =
        kind === "text"
          ? { content: "answer" }
          : kind === "reasoning"
            ? { reasoning_content: "think" }
            : {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_read",
                    type: "function",
                    function: { name: "Read", arguments: '{"path":"example.txt"}' },
                  },
                ],
              };
      const started = installTransport(() =>
        response([
          [100, chunk({ role: "assistant" })],
          [200, chunk({ content: "" })],
          [300, chunk(delta)],
          [900, chunk({}, kind === "tool" ? "tool_calls" : "stop")],
          [
            END_MS,
            {
              ...chunk({}),
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: OUTPUT_TOKENS, total_tokens: 80 },
            },
          ],
        ]),
      );
      const run = harness("openai-compatible");
      const done = run.run();
      await started();
      await vi.advanceTimersByTimeAsync(1200);
      await done;
      expect(run.completed()).toMatchObject({ timeToFirstContentMs: 300, durationMs: END_MS });
    },
  );

  it.each([
    "response.output_text.delta",
    "response.reasoning_text.delta",
    "response.reasoning_summary_text.delta",
    "response.function_call_arguments.delta",
  ])("observes %s before forwarding its SSE frame", async (type) => {
    const timing: { firstContentAt?: number } = {};
    const frames: ScheduledFrame[] = [
      [100, { type: "response.created" }],
      [200, { type, delta: "" }],
      [300, { type, delta: "x" }],
      [END_MS, { type: "response.completed" }],
    ];
    const fetch = createProviderBusinessErrorFetch({
      env: {},
      providerId: "test",
      providerKind: "openai",
      streamTiming: timing,
      fetch: async () => response(frames),
    });
    const result = await fetch("https://model.example.test/v1/responses");
    const body = result.text();
    await vi.advanceTimersByTimeAsync(1200);
    expect(timing.firstContentAt).toBe(ORIGIN + 300);
    expect(await body).toBe(
      frames.map(([, frame]) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    );
  });
});

describe("provider cache usage availability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("OW-P020：SDK 多步骤合计不把部分缓存上报当成完整合计", () => {
    const usage = (raw: Record<string, unknown>) => ({
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: { cacheReadTokens: 600 },
      raw,
    });
    const known = usage({
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 600 },
    });
    const missing = usage({ input_tokens: 1000, output_tokens: 200 });
    const result = (steps: (typeof known)[]) =>
      ({
        totalUsage: {
          inputTokens: 2000,
          outputTokens: 400,
          totalTokens: 2400,
          inputTokenDetails: { cacheReadTokens: 1200 },
        },
        usage: steps.at(-1),
        steps: steps.map((value) => ({ usage: value })),
      }) as unknown as AiSdkGenerateTextResult;
    expect(normalizeGenerateUsage(result([known, missing])).cacheReadTokens).toBeUndefined();
    expect(normalizeGenerateUsage(result([missing, known])).cacheReadTokens).toBeUndefined();
    expect(normalizeGenerateUsage(result([known, known]))).toMatchObject({
      inputTokens: 2000,
      outputTokens: 400,
      cacheReadTokens: 1200,
    });
  });

  for (const kind of ["anthropic", "openai", "openai-compatible"] as const) {
    for (const stream of [false, true]) {
      it.each(["missing", "zero", "positive"] as const)(
        `${kind} ${stream ? "stream" : "generate"} preserves %s cache usage`,
        async (reported) => {
          // OW-P020：三协议均通过真实 SDK；字段缺席不能被 SDK 的默认 0 冒充。
          const read = reported === "positive" ? 600 : 0;
          const write = reported === "positive" ? 100 : 0;
          let usage: Record<string, unknown>;
          let body: Record<string, unknown>;
          let frames: Frame[];
          if (kind === "anthropic") {
            usage = {
              input_tokens: reported === "positive" ? 300 : 1000,
              output_tokens: 200,
              ...(reported === "missing"
                ? {}
                : {
                    cache_read_input_tokens: read,
                    cache_creation_input_tokens: write,
                  }),
            };
            body = {
              id: "msg_cache",
              type: "message",
              role: "assistant",
              model: "model",
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage,
            };
            frames = [
              {
                type: "message_start",
                message: {
                  ...body,
                  content: [],
                  stop_reason: null,
                  usage: { ...usage, output_tokens: 0 },
                },
              },
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
              { type: "content_block_stop", index: 0 },
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: 200 },
              },
              { type: "message_stop" },
            ];
          } else if (kind === "openai") {
            usage = {
              input_tokens: 1000,
              output_tokens: 200,
              total_tokens: 1200,
              ...(reported === "missing" ? {} : { input_tokens_details: { cached_tokens: read } }),
            };
            const message = {
              id: "msg_cache",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "ok", annotations: [] }],
            };
            body = {
              id: "resp_cache",
              object: "response",
              created_at: 1,
              status: "completed",
              model: "model",
              output: [message],
              usage,
            };
            frames = [
              {
                type: "response.created",
                response: { id: "resp_cache", created_at: 1, model: "model" },
              },
              {
                type: "response.output_item.added",
                output_index: 0,
                item: { ...message, content: [] },
              },
              {
                type: "response.output_text.delta",
                output_index: 0,
                item_id: "msg_cache",
                content_index: 0,
                delta: "ok",
                logprobs: [],
              },
              { type: "response.output_item.done", output_index: 0, item: message },
              { type: "response.completed", response: { id: "resp_cache", usage } },
            ];
          } else {
            usage = {
              prompt_tokens: 1000,
              completion_tokens: 200,
              total_tokens: 1200,
              ...(reported === "missing" ? {} : { prompt_tokens_details: { cached_tokens: read } }),
            };
            body = {
              id: "chatcmpl-cache",
              object: "chat.completion",
              created: 1,
              model: "model",
              choices: [
                { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
              ],
              usage,
            };
            const chunk = (delta: Frame, finish_reason: string | null) => ({
              id: "chatcmpl-cache",
              object: "chat.completion.chunk",
              created: 1,
              model: "model",
              choices: [{ index: 0, delta, finish_reason }],
            });
            frames = [
              chunk({ content: "ok" }, null),
              chunk({}, "stop"),
              { ...chunk({}, null), choices: [], usage },
            ];
          }
          vi.stubGlobal("fetch", async () =>
            stream
              ? new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
                  headers: { "content-type": "text/event-stream" },
                })
              : Response.json(body),
          );
          const statuses: ModelNetworkStatusEvent[] = [];
          const model = new TestAiSdkModelAdapter({
            env: {},
            retry: { maxAttempts: 1 },
            statusSink: {
              publish: (event) => {
                statuses.push(event);
              },
            },
            registry: new TestProviderConfigFixture({
              env: {},
              providers: {
                test: { kind, baseURL: "https://model.example.test/v1", apiKey: "fixture-key" },
              },
            }),
          }).createModel({ providerId: "test", modelId: "model" });
          let normalized;
          if (stream) {
            for await (const event of model.streamText({
              messages: [{ role: "user", content: "cache" }],
            })) {
              if (event.type === "error") throw event.error;
              if (event.type === "finish") normalized = event.usage;
            }
          } else
            normalized = (
              await model.generateText({ messages: [{ role: "user", content: "cache" }] })
            ).usage;
          expect(normalized).toMatchObject({
            inputTokens: 1000,
            outputTokens: 200,
            totalTokens: 1200,
          });
          expect(normalized?.cacheReadTokens).toBe(reported === "missing" ? undefined : read);
          expect(normalized?.cacheWriteTokens).toBe(
            kind === "anthropic" && reported !== "missing" ? write : undefined,
          );
          const terminal = statuses.findLast((event) => event.type === "model_request_completed");
          expect(
            terminal?.type === "model_request_completed" && terminal.usage?.cacheReadTokens,
          ).toBe(reported === "missing" ? undefined : read);
        },
      );
    }
  }
});
