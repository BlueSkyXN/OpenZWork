import {
  createModelId,
  createModelProviderId,
  createSessionId,
  createToolCallId,
  getCurrentModelInvocationContext,
  type Model,
} from "@zcode/contracts";
import { describe, expect, it, vi } from "vitest";
import { PermissionService } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { webSearchToolEntry } from "../src/tool/handlers/websearch.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelSelection } from "./test-model-selection.js";
import { createTestRuntimeModel } from "./test-runtime-model.js";

const modelSelection = createTestModelSelection({
  providerId: createModelProviderId("websearch-fixture"),
  modelId: createModelId("search-model"),
});
const CITATION_URL = "https://example.test/search-result";
const QUERY = "Find the synthetic result";

const matrix = [
  { apiType: "anthropic-messages", enabled: true, effective: true },
  { apiType: "openai-responses", enabled: true, effective: true },
  { apiType: "openai-chat-completions", enabled: true, effective: false },
  { apiType: "anthropic-messages", enabled: false, effective: false },
  { apiType: "openai-responses", enabled: false, effective: false },
  { apiType: "openai-chat-completions", enabled: false, effective: false },
];

function toolFixture(effective: boolean, summary = "One documented result.", withCitation = true) {
  const registry = createToolRegistry();
  registry.register(webSearchToolEntry);
  const base = createTestRuntimeModel({
    generateText: vi.fn(async () => { throw new Error("WebSearch must stream"); }),
    propertyOverrides: { supportsNativeWebSearch: effective },
  });
  const streamText = vi.fn<Model["streamText"]>(async function* () {
    expect(getCurrentModelInvocationContext()?.modelCall?.operation).toBe("web_search");
    yield { type: "text_delta", text: summary };
    if (withCitation) {
      yield { type: "source", source: { type: "source", sourceType: "url", title: "Fixture citation", url: CITATION_URL } };
    }
    yield { type: "finish", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 5 } };
  });
  const model: Model = { ...base, streamText };
  const executor = createToolExecutor({
    registry,
    permissionService: new PermissionService(),
    mode: "build",
    workingDirectory: process.cwd(),
    workspaceRoot: process.cwd(),
    sessionId: createSessionId("websearch-fixture"),
    emitEvent: async () => {},
  });
  const execute = () => executor.execute({
    id: createToolCallId("websearch-fixture-call"),
    name: "WebSearch",
    input: { query: QUERY },
  }, { model });
  return { execute, model, streamText };
}

describe("protocol-gated WebSearch (WSR-02/07)", () => {
  // OZ-C013：真实 resolver 合取见 Provider 测试；Core 只消费执行模型的有效值。
  it.each(matrix)("$apiType switch=$enabled gates tool exposure and direct execution", async ({ effective }) => {
    const { execute, model, streamText } = toolFixture(effective, "A [link](https://example.test/legacy).", false);
    const runtime = createTestAgentRuntime(createSessionId("websearch-matrix"), { modelSelection }, {});
    expect(runtime.getTools(model).some((tool) => tool.name === "WebSearch")).toBe(effective);
    const result = await execute();
    if (!effective) {
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Current model does not support native WebSearch");
      expect(streamText).not.toHaveBeenCalled();
      return;
    }
    expect(result.success).toBe(true);
    expect(streamText).toHaveBeenCalledOnce();
    expect(streamText.mock.calls[0]?.[0].tools).toEqual([
      expect.objectContaining({ name: "web_search", executionMode: "providerNative" }),
    ]);
    expect(result.output).toMatchObject({ sources: [{ url: "https://example.test/legacy", title: "link" }] });
  });
});

describe("WebSearch structured sources (WSR-08)", () => {
  it.each([
    "One documented result without Markdown.",
    `One [duplicate title](${CITATION_URL}) in Markdown.`,
  ])("returns one citation for %s", async (summary) => {
    const { execute } = toolFixture(true, summary);
    const result = await execute();
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ summary, sources: [{ title: "Fixture citation", url: CITATION_URL }] });
    expect(result.modelContent).toContain(`- [Fixture citation](${CITATION_URL})`);
  });
});
