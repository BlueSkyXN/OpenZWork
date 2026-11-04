import assert from "node:assert/strict";
import { test } from "node:test";
import { extractModelCapabilityRules } from "../model-capability-rules.mjs";

function source() {
  return {
    config: {
      providerConfigRules: {
        templateRules: [
          {
            templateId: "openai",
            config: {
              api: { type: "openai-responses", baseUrl: "https://api.example.com/v1" },
              access: { apiKey: "must-not-export" },
              builtinModelIds: ["new-model"],
            },
          },
          {
            templateId: "aggregator",
            config: { api: { type: "anthropic-messages", baseUrl: "https://gateway.example/v1" } },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        builtinProviderModelRules: [{ providerId: "account:retired" }],
        providerSiteRules: [
          { baseUrlMatch: "https://zcode\\.example/retired", config: {} },
          { baseUrlMatch: "https://public\\.example/v1", config: {} },
        ],
        templateModelRules: [
          {
            templateId: "openai",
            modelId: "new-model[1]",
            config: { enabled: true, optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
          },
          {
            templateId: "aggregator",
            modelId: "vendor/model",
            config: { enabled: true, optionSpecs: { reasoningLevel: { map: "{}" } } },
          },
          { templateId: "aggregator", modelId: "membership-only", config: { enabled: true } },
        ],
      },
    },
  };
}

test("能力导入保留原厂型号并限定聚合渠道，不引入账号或成员", () => {
  const input = source();
  const original = structuredClone(input);
  const rules = extractModelCapabilityRules(input);
  assert.deepEqual(input, original);
  assert.equal(rules.modelApiRules.length, 1);
  assert.equal(rules.providerSiteRules.length, 3);
  assert.deepEqual(rules.templateModelRules, []);
  assert.deepEqual(rules.builtinProviderModelRules, []);
  assert(!JSON.stringify(rules).includes("must-not-export"));
  assert(!JSON.stringify(rules).includes("membership-only"));
  assert(!JSON.stringify(rules).includes("zcode"));
  const pattern = new RegExp(`^(?:${rules.modelApiRules[0].modelMatch})$`);
  assert(pattern.test("new-model[1]"));
  assert(!pattern.test("new-model1"));
  const channel = rules.providerSiteRules.find((r) => r.modelMatch === "vendor/model");
  const endpoint = new RegExp(`^(?:${channel.baseUrlMatch})$`);
  assert(endpoint.test("https://gateway.example"));
  assert(endpoint.test("https://gateway.example/v1/"));
  assert(!endpoint.test("https://gateway.example/other/v1"));
});

test("同渠道精确身份出现不同能力时停止导入", () => {
  const input = source();
  input.config.modelConfigRules.templateModelRules.push({
    templateId: "aggregator",
    modelId: "vendor/model",
    config: { optionSpecs: { reasoningLevel: { map: '{"different":true}' } } },
  });
  assert.throws(() => extractModelCapabilityRules(input), /Conflicting channel rule/);
});
