import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createModelId, createModelProviderId } from "@zcode/contracts";
import { createRegistryModelConfig, createRegistryProviderConfig, parseProviderConfig,
  parseZCodeBuiltinModelConfigRules, type ModelConfigRules } from "@zcode/provider";
import { AiSdkModelAdapter } from "../src/model/runner.js";

let rules: ModelConfigRules;
beforeAll(async () => {
  const release = JSON.parse(await readFile(new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url), "utf8"));
  rules = parseZCodeBuiltinModelConfigRules(release.config.modelConfigRules);
});

const cases = [
  { modelId: "glm-5.3", apiType: "anthropic-messages", baseUrl: "https://gateway.example/v1", levels: ["low", "high", "max"],
    fields: (effort: string) => ({ thinking: { type: "enabled" }, output_config: { effort }, max_tokens: 1024 }) },
  { modelId: "z-ai/glm-5.3", apiType: "anthropic-messages", baseUrl: "https://openrouter.ai/api/v1", levels: ["low", "high", "max"],
    fields: (effort: string) => ({ thinking: { type: "adaptive" }, output_config: { effort }, max_tokens: 1024 }) },
  { modelId: "gpt-6.1-sol", apiType: "openai-responses", baseUrl: "https://gateway.example/v1", levels: ["low", "medium", "high", "xhigh", "max"],
    fields: (effort: string) => ({ reasoning: { effort }, max_output_tokens: 1024 }) },
  { modelId: "zai-org/GLM-5.3", apiType: "openai-chat-completions", baseUrl: "https://api.siliconflow.cn/v1", levels: ["enabled"],
    fields: () => ({ enable_thinking: true, max_tokens: 1024 }) },
] as const;
const controlledFields = ["thinking", "output_config", "reasoning", "reasoning_effort", "enable_thinking", "max_tokens", "max_output_tokens", "max_completion_tokens"];

describe("maintained model capabilities in final Adapter requests", () => {
  for (const sample of cases) for (const level of sample.levels) for (const stream of [false, true]) {
    it(`${sample.modelId}/${sample.apiType}/${level}/${stream ? "stream" : "generate"}`, async () => {
      const modelConfig = createRegistryModelConfig(rules.resolve({ providerId: "fixture", ...sample }));
      const providerConfig = createRegistryProviderConfig(parseProviderConfig({
        group: "standard-personal", access: { type: "api-key", apiKey: "fixture-only" },
        api: { type: sample.apiType, baseUrl: sample.baseUrl },
      }));
      if (!modelConfig.ok || !providerConfig.ok) throw new Error("Incomplete capability fixture");
      const bodies: Record<string, unknown>[] = [];
      // 捕获真实 Adapter/SDK 序列化后的网络出口；所有 URL 都由本地 mock 接收，无外部请求。
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        bodies.push(await request.json() as Record<string, unknown>);
        return Response.json({ type: "error", error: { type: "invalid_request_error", message: "fixture captured request" } }, { status: 400 });
      });
      try {
        const adapter = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } });
        const model = adapter.createModel({
          providerId: createModelProviderId("fixture"), modelId: createModelId(sample.modelId),
          providerConfig: providerConfig.config, modelConfig: modelConfig.config,
          options: { reasoningLevel: level, maxOutputTokens: 1024 },
        });
        const request = { messages: [{ role: "user" as const, content: "MODEL_CAPABILITY_WIRE_FIXTURE" }] };
        try {
          if (stream) for await (const _event of model.streamText(request)) { /* 仅观察请求体。 */ }
          else await model.generateText(request);
        } catch { /* 合成 400 在请求捕获后终止模型响应解析。 */ }
        expect(bodies).toHaveLength(1);
        expect(bodies[0]!.model).toBe(sample.modelId);
        const actual = Object.fromEntries(controlledFields.filter((field) => field in bodies[0]!).map((field) => [field, bodies[0]![field]]));
        expect(actual).toEqual(sample.fields(level));
        expect(bodies[0]!.stream === true).toBe(stream);
      } finally { vi.unstubAllGlobals(); }
    });
  }
});
