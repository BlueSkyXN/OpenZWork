import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ModelOptionSpecsConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  createRegistryModelConfig,
  createRegistryProviderConfig,
  type ModelSelection,
  type ProviderRegistryServiceSnapshot,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "../src/index.js";
import { createNodeModelSelectionFacade } from "../src/model-selection-facade.js";
import { legacyReasoningLevelRenames } from "../src/legacy-reasoning-level-renames.js";

const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: fileURLToPath(
    new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
  ),
  watch: false,
});
let builtin: Awaited<ReturnType<typeof source.read>>;
beforeAll(async () => {
  builtin = await source.read();
});
afterAll(() => source.dispose());

function renameRules(values: readonly string[] = ["disabled", "enabled"]) {
  return new ModelConfigRules([
    ...builtin.models.rules(),
    ...legacyReasoningLevelRenames.map((entry) => ({
      type: "model" as const,
      modelMatch: entry.simplifiedModelMatch,
      config: new ModelConfig({
        optionSpecs: new ModelOptionSpecsConfig({
          reasoningLevel: { values: [...values] },
        }),
      }),
    })),
  ]);
}

function view(
  modelId: string,
  level: string,
  personalModels = ModelConfigRules.empty(),
  modelRules = renameRules(),
) {
  const config = {
    revision: "c",
    zcodeBuiltinRevision: "b",
    personalRevision: "p",
    zcodeBuiltinProviders: builtin.providers,
    zcodeBuiltinProviderTemplates: builtin.providerTemplates,
    personalProviders: new ProviderConfigMap([
      [
        "personal",
        new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ apiKey: "fixture" }),
          api: new ProviderApiConfig({
            type: "anthropic-messages",
            baseUrl: "https://provider.example.test",
          }),
          personalModelIds: [modelId],
        }),
      ],
    ]),
    zcodeBuiltinModelRules: modelRules,
    personalModels,
  };
  const resolution = new ProviderConfigResolver().resolve(config);
  const providerId = "personal";
  const providerConfig = resolution.effectiveProviders.get(providerId)!;
  const modelConfig = ModelConfigRules.composeEffective(modelRules, personalModels).resolve({
    providerId,
    modelId,
    apiType: providerConfig.api?.type,
    baseURL: providerConfig.api?.baseUrl,
  });
  const checkedModel = createRegistryModelConfig(modelConfig);
  const checkedProvider = createRegistryProviderConfig(providerConfig);
  if (!checkedModel.ok || !checkedProvider.ok) {
    throw new Error(
      `fixture must be complete: ${JSON.stringify({ checkedModel, checkedProvider })}`,
    );
  }
  const registry = {
    revision: 1,
    providers: [
      {
        providerId,
        config: checkedProvider.config,
        models: [{ modelId, config: checkedModel.config }],
      },
    ],
  };
  const snapshot: ProviderRegistryServiceSnapshot = {
    config,
    resolution,
    registry,
    sourceRevisions: { config: "c" },
  };
  const facade = createNodeModelSelectionFacade({
    getSnapshot: () => snapshot,
    getView: () => registry,
    refresh: async () => snapshot,
    onDidChange: () => () => {},
  });
  const selection: ModelSelection = Object.freeze({
    providerId,
    modelId,
    options: Object.freeze({ reasoningLevel: level }),
  });
  return { result: facade.getView(undefined, undefined, { selection }), selection, facade };
}

describe("历史关闭档位改名", () => {
  it("只在当前规则仍允许 disabled 时恢复旧值", () => {
    expect(legacyReasoningLevelRenames).toHaveLength(25);
    for (const entry of legacyReasoningLevelRenames) {
      expect(renameRules().rules()).toContainEqual(
        expect.objectContaining({ modelMatch: entry.simplifiedModelMatch }),
      );
    }
    expect(view("GLM-5.2", "nothink").result.effectiveSelection?.options?.reasoningLevel).toBe(
      "disabled",
    );
    expect(view("GLM-5-Turbo", "off").result.effectiveSelection?.options?.reasoningLevel).toBe(
      "disabled",
    );
  });

  it("当前值域没有 disabled 时不恢复旧值", () => {
    expect(
      view("GLM-5.2", "nothink", undefined, renameRules(["enabled"])).result.selectionIssue,
    ).toBe("reasoning-level-not-supported");
  });

  it("旧缓存仍使用精确历史 matcher 时也能恢复关闭选择", () => {
    const oldRules = new ModelConfigRules(
      renameRules()
        .rules()
        .map((rule) => {
          const rename = legacyReasoningLevelRenames.find(
            (entry) => entry.simplifiedModelMatch === rule.modelMatch,
          );
          return rename ? { ...rule, modelMatch: rename.modelMatch } : rule;
        }),
    );
    expect(
      view("GLM-5.2", "nothink", ModelConfigRules.empty(), oldRules).result.effectiveSelection
        ?.options?.reasoningLevel,
    ).toBe("disabled");
  });

  it("Personal 原值合法则保留；自定义值域不套用内置别名", () => {
    const personal = (values: string[]) =>
      new ModelConfigRules([
        {
          type: "provider-model",
          providerId: "personal",
          modelId: "GLM-5.2",
          config: new ModelConfig({
            optionSpecs: new ModelOptionSpecsConfig({ reasoningLevel: { values } }),
          }),
        },
      ]);
    expect(
      view("GLM-5.2", "nothink", personal(["nothink", "high"])).result.effectiveSelection?.options
        ?.reasoningLevel,
    ).toBe("nothink");
    expect(view("GLM-5.2", "nothink", personal(["disabled", "high"])).result.selectionIssue).toBe(
      "reasoning-level-not-supported",
    );
  });
});
