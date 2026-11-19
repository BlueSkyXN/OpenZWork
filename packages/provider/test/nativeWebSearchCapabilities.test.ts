// ============================================================
// OpenZWork(OZ-C013): Protocol-native WebSearch capability resolution tests
// ============================================================

// WSR-02/WSR-07：ProviderConfigResolver 场景回归。实际调用 resolver，覆盖
// 三协议 × 开关值矩阵：执行注册表的有效能力 = 开关 ∧ 协议白名单；候选视图与
// 个人层原始配置不被改写。
import {
  EnumOptionSpecConfig,
  LimitOptionSpecConfig,
  ModelConfig,
  ModelConfigRules,
  ModelInputFormatConfig,
  ModelOptionSpecsConfig,
  ModelOutputFormatConfig,
  ModelPropertiesConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  type ModelConfigRule,
  type RegistryProviderConfig,
} from "../src/index.js";
import { describe, expect, it } from "vitest";
import { createApiKeyProviderConfig } from "./provider-config-fixtures.js";

type ProviderApiTypeValue = RegistryProviderConfig["api"]["type"];

const MODEL_ID = "search-model";

function createCompleteModelConfig(supportsNativeWebSearch: boolean): ModelConfig {
  return new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow: 128_000,
      inputFormat: new ModelInputFormatConfig({
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      }),
      outputFormat: new ModelOutputFormatConfig({ supportsText: true }),
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch,
      supportsMidConversationSystem: false,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      reasoningLevel: new EnumOptionSpecConfig({ values: ["low", "medium", "high"], map: "{}" }),
      maxOutputTokens: new LimitOptionSpecConfig({ max: 8_192, map: "{}" }),
    }),
  });
}

function resolveForApiType(
  apiType: ProviderApiTypeValue,
  switchValue: boolean,
): ReturnType<ProviderConfigResolver["resolve"]> {
  const providerId = `prov-${apiType}`;
  const personalModels = new ModelConfigRules([
    {
      type: "provider-model",
      providerId,
      modelId: MODEL_ID,
      config: createCompleteModelConfig(switchValue),
    } satisfies ModelConfigRule,
  ]);
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: ProviderConfigMap.empty(),
    personalProviders: new ProviderConfigMap([
      {
        providerId,
        providerName: `Provider ${apiType}`,
        enabled: true,
        config: createApiKeyProviderConfig({
          apiFormat: apiType,
          baseURL: "https://api.example.test/v1",
          apiKey: "test-key",
          models: [MODEL_ID],
        }),
      },
    ]),
    zcodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels,
  });
  expect(resolution.issues).toEqual([]);
  return resolution;
}

describe("protocol-gated native WebSearch capability (WSR-02/WSR-07)", () => {
  const cases: readonly { apiType: ProviderApiTypeValue; supported: boolean }[] = [
    { apiType: "anthropic-messages", supported: true },
    { apiType: "openai-responses", supported: true },
    { apiType: "openai-chat-completions", supported: false },
  ];

  it.each(cases)(
    "keeps effective capability for $apiType when the switch is on",
    ({ apiType, supported }) => {
      const resolution = resolveForApiType(apiType, true);
      const provider = resolution.registryProviders[0];
      const model = provider.models.find((entry) => entry.modelId === MODEL_ID);
      expect(model?.config.properties.supportsNativeWebSearch).toBe(supported);
    },
  );

  it.each(cases)("keeps capability off for $apiType when the switch is off", ({ apiType }) => {
    const resolution = resolveForApiType(apiType, false);
    const provider = resolution.registryProviders[0];
    const model = provider.models.find((entry) => entry.modelId === MODEL_ID);
    expect(model?.config.properties.supportsNativeWebSearch).toBe(false);
  });

  it("keeps the resolved candidate view untouched (WSR-07)", () => {
    const resolution = resolveForApiType("openai-chat-completions", true);

    // 设置页候选视图仍显示个人层的原始开关值；界面提示差异记录在 spec 的「不做」。
    const candidate = resolution.resolvedProviders[0].models.find(
      (entry) => entry.modelId === MODEL_ID,
    );
    expect(candidate?.config.properties.supportsNativeWebSearch).toBe(true);
  });

  it("does not mutate the personal model rules input across resolutions", () => {
    const providerId = "prov-openai-chat-completions";
    const personalConfig = createCompleteModelConfig(true);
    const personalModels = new ModelConfigRules([
      {
        type: "provider-model",
        providerId,
        modelId: MODEL_ID,
        config: personalConfig,
      } satisfies ModelConfigRule,
    ]);
    const input = {
      zcodeBuiltinProviders: ProviderConfigMap.empty(),
      personalProviders: new ProviderConfigMap([
        {
          providerId,
          providerName: "Provider chat",
          enabled: true,
          config: createApiKeyProviderConfig({
            apiFormat: "openai-chat-completions" as const,
            baseURL: "https://api.example.test/v1",
            apiKey: "test-key",
            models: [MODEL_ID],
          }),
        },
      ]),
      zcodeBuiltinModelRules: ModelConfigRules.empty(),
      personalModels,
    };
    const resolver = new ProviderConfigResolver();
    const first = resolver.resolve(input);
    const second = resolver.resolve(input);

    expect(first.registryProviders[0].models[0]?.config.properties.supportsNativeWebSearch).toBe(
      false,
    );
    expect(second.registryProviders[0].models[0]?.config.properties.supportsNativeWebSearch).toBe(
      false,
    );
    // 原始 ModelConfig 实例保持开关为 true，派生不落回输入。
    expect(personalConfig.properties?.supportsNativeWebSearch).toBe(true);
  });
});
