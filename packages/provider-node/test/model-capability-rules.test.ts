import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { compileModelOptionMaps } from "@zcode/model-option-map";
import {
  ModelConfigRules,
  parsePersonalModelConfigRules,
  parseProviderConfig,
  ProviderConfigMap,
  ProviderTemplateMap,
  ProviderRegistryService,
  ProviderSettingsFacade,
} from "@zcode/provider";
import { decodeZCodeBuiltinRelease } from "../src/zcode-builtin-release.js";

let rules: ModelConfigRules;
let channelCases: readonly (readonly [string, string, string])[];
beforeAll(async () => {
  const raw = JSON.parse(
    await readFile(new URL("../../../config/provider/zcode-builtin.json", import.meta.url), "utf8"),
  );
  rules = decodeZCodeBuiltinRelease(raw).config.modelConfigRules;
  channelCases = JSON.parse(
    await readFile(new URL("./fixtures/model-capability-cases.json", import.meta.url), "utf8"),
  );
});

const context = {
  providerId: "custom-a",
  modelId: "glm-5.3",
  apiType: "anthropic-messages",
  baseUrl: "https://gateway.example/v1",
};

function requestFor(input: typeof context, level: string, source = rules) {
  const config = source.resolve(input);
  expect(config.validateComplete()).toEqual([]);
  return compileModelOptionMaps(
    config.toJSON().optionSpecs as Parameters<typeof compileModelOptionMaps>[0],
  ).apply({ model: input.modelId, messages: [] }, { reasoningLevel: level, maxOutputTokens: 1024 });
}

describe("model capability and channel rules", () => {
  it("Settings 已保存模型与新增预览都投影目标 Provider 的推荐来源", async () => {
    const personalProviders = new ProviderConfigMap(
      [
        ["native", context.baseUrl],
        ["router", "https://openrouter.ai/api/v1"],
      ].map(
        ([providerId, baseUrl]) =>
          [
            providerId!,
            parseProviderConfig({
              group: "standard-personal",
              access: { type: "api-key", apiKey: "fixture-only" },
              api: { type: "anthropic-messages", baseUrl },
              personalModelIds: ["glm-5.3", "unknown-future-model"],
            }),
          ] as const,
      ),
    );
    const snapshot = {
      revision: "fixture",
      zcodeBuiltinRevision: "fixture",
      personalRevision: "fixture",
      zcodeBuiltinProviders: ProviderConfigMap.empty(),
      zcodeBuiltinProviderTemplates: ProviderTemplateMap.empty(),
      personalProviders,
      zcodeBuiltinModelRules: rules,
      personalModels: ModelConfigRules.empty(),
    };
    const service = new ProviderRegistryService({
      configSource: { read: async () => snapshot, onDidChange: () => () => {} },
    });
    try {
      await service.start();
      const facade = new ProviderSettingsFacade(service);
      const view = facade.getView();
      expect(
        view.providers
          .find((p) => p.providerId === "native")!
          .models.map((m) => m.recommendationMatch),
      ).toEqual(["model", "generic"]);
      expect(
        view.providers.find((p) => p.providerId === "router")!.models[0]!.recommendationMatch,
      ).toBe("channel");
      expect(
        facade.resolveModelConfig({ providerId: "native", modelId: "unknown-future-model" })
          .recommendationMatch,
      ).toBe("generic");
      const personalConfig = {
        optionSpecs: {
          reasoningLevel: { values: ["custom"], map: '{"custom_effort":reasoningLevel}' },
        },
      };
      const preview = facade.resolveModelConfig({
        providerId: "native",
        originalModelId: "glm-5.3",
        modelId: "glm-5.3",
        personalConfig,
      });
      expect(preview.recommendationMatch).toBe("model");
      expect(preview.effectiveConfig.optionSpecs?.reasoningLevel).toEqual(
        personalConfig.optionSpecs.reasoningLevel,
      );
      expect(preview.inheritedConfig.optionSpecs?.reasoningLevel?.values).toEqual([
        "low",
        "high",
        "max",
      ]);
    } finally {
      service.dispose();
    }
  });
  it("维护目录的每个公开档位均能生成完整且不冲突的请求参数", () => {
    expect(channelCases.length).toBeGreaterThan(200);
    for (const [modelId, apiType, baseUrl] of channelCases) {
      const input = { ...context, modelId, apiType, baseUrl };
      const config = rules.resolve(input);
      expect(config.validateComplete(), `${modelId}/${apiType}/${baseUrl}`).toEqual([]);
      for (const level of config.optionSpecs!.reasoningLevel!.values!) {
        const body = requestFor(input, level);
        expect(body.model).toBe(modelId);
        expect(() => JSON.stringify(body)).not.toThrow();
      }
    }
  });

  it("原厂最新型号的精确能力可用于同协议接入，聚合差异留在渠道", () => {
    const native = { ...context, modelId: "gpt-6.1-sol", apiType: "openai-responses" };
    expect(rules.resolve(native).optionSpecs?.reasoningLevel?.values).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(requestFor(native, "max")).toEqual({
      model: "gpt-6.1-sol",
      messages: [],
      reasoning: { effort: "max" },
      max_output_tokens: 1024,
    });
    const routed = {
      ...context,
      modelId: "openai/gpt-6.1-sol",
      baseUrl: "https://openrouter.ai/api/v1",
    };
    expect(requestFor(routed, "max")).toEqual({
      model: routed.modelId,
      messages: [],
      output_config: { effort: "max" },
      max_tokens: 1024,
    });
  });

  it("SiliconFlow 的单档 GLM 规则不扩散到同名模型的其他站点", () => {
    const site = {
      ...context,
      modelId: "zai-org/GLM-5.3",
      apiType: "openai-chat-completions",
      baseUrl: "https://api.siliconflow.cn/v1",
    };
    expect(rules.resolve(site).optionSpecs?.reasoningLevel?.values).toEqual(["enabled"]);
    expect(requestFor(site, "enabled")).toEqual({
      model: site.modelId,
      messages: [],
      enable_thinking: true,
      max_tokens: 1024,
    });
    expect(
      rules.resolve({ ...site, baseUrl: context.baseUrl }).optionSpecs?.reasoningLevel?.values,
    ).toEqual(["low", "high", "max"]);
  });
  it("推荐来源来自实际匹配，与普通解析使用同一份结果", () => {
    for (const [input, expected] of [
      [{ ...context, modelId: "unknown-future-model" }, "generic"],
      [context, "model"],
      [{ ...context, baseUrl: "https://openrouter.ai/api/v1" }, "channel"],
    ] as const) {
      const detailed = rules.resolveWithMatch(input);
      expect(detailed.matchKind).toBe(expected);
      expect(detailed.config.toJSON()).toEqual(rules.resolve(input).toJSON());
    }
  });
  // 下游仅保留协议模板时一并删除了型号规则，GLM 因此错误继承开关与 Adaptive 兜底。
  it.each(["low", "high", "max"])("GLM-5.3 Messages %s 保持专用映射", (level) => {
    expect(rules.resolve(context).optionSpecs?.reasoningLevel?.values).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(requestFor(context, level)).toEqual({
      model: "glm-5.3",
      messages: [],
      thinking: { type: "enabled" },
      output_config: { effort: level },
      max_tokens: 1024,
    });
  });

  it("OpenRouter 覆盖限定渠道，模型 ID 与普通接入映射保持独立", () => {
    const routed = {
      ...context,
      modelId: "z-ai/glm-5.3",
      baseUrl: "https://openrouter.ai/api/v1/",
    };
    expect(requestFor(routed, "max")).toMatchObject({
      model: "z-ai/glm-5.3",
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
    expect(requestFor({ ...routed, baseUrl: context.baseUrl }, "max")).toMatchObject({
      thinking: { type: "enabled" },
    });
    expect(
      requestFor({ ...routed, baseUrl: "https://openrouter.ai/not-api/v1" }, "max"),
    ).toMatchObject({
      thinking: { type: "enabled" },
    });
  });

  it("同 endpoint/model 的 Personal Map 只覆盖当前 Provider", () => {
    const personal = parsePersonalModelConfigRules({
      providerModelRules: [
        {
          providerId: "custom-a",
          modelId: "glm-5.3",
          config: {
            optionSpecs: { reasoningLevel: { map: '{"reasoning":{"effort":reasoningLevel}}' } },
          },
        },
      ],
      manualProviderModelRules: [],
    });
    const effective = ModelConfigRules.composeEffective(rules, personal);
    expect(requestFor(context, "max", effective)).toEqual({
      model: "glm-5.3",
      messages: [],
      reasoning: { effort: "max" },
      max_tokens: 1024,
    });
    expect(requestFor({ ...context, providerId: "custom-b" }, "max", effective)).toMatchObject({
      thinking: { type: "enabled" },
      output_config: { effort: "max" },
    });
  });

  it.each(["anthropic-messages", "openai-chat-completions", "openai-responses"])(
    "未知模型保留 %s 的原有开关与请求行为",
    (apiType) => {
      const input = { ...context, modelId: "unknown-future-model", apiType };
      expect(rules.resolve(input).optionSpecs?.reasoningLevel?.values).toEqual([
        "disabled",
        "enabled",
      ]);
      const enabled = requestFor(input, "enabled");
      const disabled = requestFor(input, "disabled");
      if (apiType === "anthropic-messages") {
        expect(enabled).toMatchObject({
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
        });
        expect(disabled.thinking).toEqual({ type: "disabled" });
      } else {
        expect(enabled.reasoning).toEqual({ effort: "high" });
        expect(disabled.reasoning).toEqual({ effort: "none" });
      }
    },
  );
});
