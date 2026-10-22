import { describe, expect, it } from "vitest";
import { parsePersonalModelConfigRules, parsePersonalProviderConfigMap } from "../src/index.js";

describe("Todo 21 source contracts", () => {
  it("Personal Provider 不能写 builtinModelIds，根 group 只能是 standard-personal", () => {
    const providers = parsePersonalProviderConfigMap({
      providerRules: [
        {
          providerId: "personal",
          config: {
            group: "standard-personal",
            personalModelIds: ["model-a"],
            modelOrder: ["model-a"],
          },
        },
        { providerId: "overlay", providerName: "Overlay", config: {} },
      ],
    });
    expect(providers.get("personal")?.modelOrder).toEqual(["model-a"]);
    expect(() =>
      parsePersonalProviderConfigMap({
        providerRules: [{ providerId: "personal", config: { builtinModelIds: ["model-a"] } }],
      }),
    ).toThrow();
    expect(() =>
      parsePersonalProviderConfigMap({
        providerRules: [{ providerId: "personal", config: { group: "standard-builtin" } }],
      }),
    ).toThrow();
    expect(() =>
      parsePersonalProviderConfigMap({
        providerRules: [
          {
            providerId: "account:zai-start-plan",
            config: { access: { type: "zhipu-account", accountType: "zai", mode: "start-plan" } },
          },
        ],
      }),
    ).toThrow("固定 Account Provider 的 Access 只能由 ZCode Built-in Config 声明");
  });

  it("Personal Provider 缺失 access 时保持不完整，不从 group 推断 Access", () => {
    const providers = parsePersonalProviderConfigMap({
      providerRules: [
        { providerId: "personal", config: { group: "standard-personal" } },
        { providerId: "overlay", providerName: "Overlay", config: {} },
      ],
    });

    expect(providers.get("personal")?.access).toBeUndefined();
    expect(providers.get("overlay")?.access).toBeUndefined();
  });
  it("Model 没有 visibility", () => {
    expect(() =>
      parsePersonalModelConfigRules([
        {
          type: "provider-model",
          providerId: "provider-a",
          modelId: "model-a",
          config: { visibility: "hidden" },
        },
      ]),
    ).toThrow();
  });
});
