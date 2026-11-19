// ============================================================
// OpenZWork(OZ-C013): OpenAI Responses provider-native WebSearch Tests
// ============================================================

import {
  WEBSEARCH_PROVIDER_NATIVE_SPEC,
  WEBSEARCH_TOOL_CONTRACT,
  createModelId,
  createModelProviderId,
  type ModelStreamEvent,
  type ModelToolContract,
} from "@zcode/contracts";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toAiSdkTools } from "../src/model/index.js";
import { executeAdapterStreamText } from "./test-adapter-model.js";
import { createTestModelProperties } from "./test-model-format.js";
import { TestAiSdkModelAdapter, TestProviderConfigFixture } from "./test-provider-config.js";

const CITATION_URL = "https://example.test/search-result";
const SUMMARY = "The fixture found one documented result.";

afterEach(() => vi.unstubAllGlobals());

function createInternalProviderNativeWebSearchContract(
  args?: Record<string, unknown>,
): ModelToolContract {
  return {
    name: "web_search",
    capability: "web_search",
    description: "Provider-native web search used internally by WebSearch",
    executionMode: "providerNative",
    inputSchema: WEBSEARCH_TOOL_CONTRACT.inputSchema,
    outputSchema: WEBSEARCH_TOOL_CONTRACT.outputSchema,
    providerNative: {
      ...WEBSEARCH_PROVIDER_NATIVE_SPEC,
      args,
    },
  };
}

describe("OpenAI Responses provider-native WebSearch encoding (WSR-01/WSR-04)", () => {
  it("maps internal web_search to the OpenAI Responses server-side web_search tool", () => {
    const tools = toAiSdkTools(
      [
        createInternalProviderNativeWebSearchContract({
          allowedDomains: ["example.com"],
          maxUses: 3,
        }),
      ],
      {
        providerKind: "openai",
        supportsNativeWebSearch: true,
      },
    );

    expect(tools?.web_search).toMatchObject({
      args: { filters: { allowedDomains: ["example.com"] } },
      id: "openai.web_search",
      type: "provider",
    });
    // maxUses 按 spec 忽略：OpenAI 的 web_search 没有搜索次数上限参数。
    expect(tools?.web_search).not.toHaveProperty("args.maxUses");
  });

  it("omits the filters arg entirely when allowed_domains is empty", () => {
    const tools = toAiSdkTools([createInternalProviderNativeWebSearchContract()], {
      providerKind: "openai",
      supportsNativeWebSearch: true,
    });

    expect(tools?.web_search).toMatchObject({
      args: {},
      id: "openai.web_search",
      type: "provider",
    });
  });

  it("fails closed for non-empty blocked_domains before any request is sent", () => {
    expect(() =>
      toAiSdkTools(
        [
          createInternalProviderNativeWebSearchContract({
            blockedDomains: ["blocked.example"],
          }),
        ],
        {
          providerKind: "openai",
          supportsNativeWebSearch: true,
        },
      ),
    ).toThrowError(/does not support blocked_domains/u);
  });

  it("fails closed when the effective model capability is disabled", () => {
    expect(() =>
      toAiSdkTools([createInternalProviderNativeWebSearchContract()], {
        providerKind: "openai",
        supportsNativeWebSearch: false,
      }),
    ).toThrowError(/does not support provider-native WebSearch/u);
  });
});

describe("OpenAI Responses WebSearch wire (WSR-01/04/08/09)", () => {
  it("emits the SDK URL citation even when the answer contains no links", async () => {
    const { events, requests } = await streamFromFixture({ nativeSearch: true });
    expect(requests).toEqual([
      expect.objectContaining({ stream: true, tools: [{ type: "web_search", filters: { allowed_domains: ["example.test"] } }] }),
    ]);
    expect(events.filter((event) => event.type === "text_delta").map((event) => event.text).join("")).toBe(SUMMARY);
    expect(events.filter((event) => event.type === "source")).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ sourceType: "url", title: "Fixture citation", url: CITATION_URL }) }),
    ]);
    expect(events.at(-1)?.type).toBe("finish");
  });

  it("does not project citations for ordinary Responses requests", async () => {
    const { events, requests } = await streamFromFixture({ nativeSearch: false });
    expect(requests).toHaveLength(1);
    expect(events.some((event) => event.type === "source")).toBe(false);
    expect(events.at(-1)?.type).toBe("finish");
  });

  it("retries after a citation-only attempt disconnects and discards its source", async () => {
    const { events, requests } = await streamFromFixture({
      nativeSearch: true,
      firstResponse: interruptedCitationResponse(),
    });

    expect(requests).toHaveLength(2);
    const sources = events.filter((event) => event.type === "source");
    expect(sources.map((event) => event.source.url)).toEqual([CITATION_URL]);
    const text = events.filter((event) => event.type === "text_delta");
    expect(text.map((event) => event.text).join("")).toBe(SUMMARY);
    expect(events.at(-1)?.type).toBe("finish");
  });

  it("never calls transport for a non-empty block list", async () => {
    const requests: unknown[] = [];
    await expect(streamFromFixture({ nativeSearch: true, blockedDomains: ["example.test"] }, requests))
      .rejects.toThrow(/does not support blocked_domains/u);
    expect(requests).toHaveLength(0);
  });
});

async function streamFromFixture(
  { nativeSearch, blockedDomains, firstResponse }: {
    nativeSearch: boolean;
    blockedDomains?: string[];
    firstResponse?: Response;
  },
  requests: unknown[] = [],
) {
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(new URL(request.url).pathname).toBe("/v1/responses");
    requests.push(await request.json());
    return requests.length === 1 && firstResponse ? firstResponse : citationResponse();
  };
  vi.stubGlobal("fetch", transport);
  const adapter = new TestAiSdkModelAdapter({
    registry: new TestProviderConfigFixture({
      env: {},
      providers: { fixture: { kind: "openai", apiKey: "fixture-key", baseURL: "https://provider.example.test/v1" } },
    }),
    retry: { maxAttempts: firstResponse ? 2 : 1, baseDelayMs: 0, jitter: false },
  });
  const events: ModelStreamEvent[] = [];
  for await (const event of executeAdapterStreamText(adapter, {
    providerId: createModelProviderId("fixture"),
    modelId: createModelId("search-model"),
    messages: [{ role: "user", content: "Find the synthetic result" }],
    properties: createTestModelProperties({}, { supportsNativeWebSearch: true }),
    ...(nativeSearch ? {
      modelCall: { operation: "web_search" },
      tools: [createInternalProviderNativeWebSearchContract(blockedDomains
        ? { blockedDomains }
        : { allowedDomains: ["example.test"], maxUses: 8 })],
    } : {}),
  })) {
    events.push(event);
  }
  return { events, requests };
}

function interruptedCitationResponse(): Response {
  const messageId = "msg_interrupted";
  const frames = [
    {
      type: "response.created",
      response: { id: "resp_interrupted", created_at: 1, model: "search-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: messageId, type: "message", role: "assistant", status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.annotation.added",
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      annotation: {
        type: "url_citation",
        start_index: 0,
        end_index: 1,
        url: "https://example.test/interrupted-result",
        title: "Interrupted citation",
      },
    },
  ];
  const prefix = new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
  );
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(prefix);
        return;
      }
      // 让 SDK 消费已排队的引文，再模拟正文前的连接中断。
      await setImmediate();
      controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function citationResponse(): Response {
  const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed" };
  const annotation = { type: "url_citation", start_index: 0, end_index: 3, url: CITATION_URL, title: "Fixture citation" };
  const frames = [
    { type: "response.created", response: { id: "resp_fixture", created_at: 1, model: "search-model" } },
    { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
    { type: "response.output_text.delta", item_id: message.id, output_index: 0, content_index: 0, delta: SUMMARY, logprobs: [] },
    ...[
      annotation,
      { ...annotation, url: "javascript:fixture" },
      { type: "file_citation", file_id: "file_fixture", filename: "fixture.txt", index: 0 },
    ].map((item) => ({ type: "response.output_text.annotation.added", item_id: message.id, output_index: 0, content_index: 0, annotation: item })),
    { type: "response.output_item.done", output_index: 0, item: { ...message, content: [{ type: "output_text", text: SUMMARY, annotations: [annotation] }] } },
    { type: "response.completed", response: { id: "resp_fixture", usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } } },
  ];
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}
