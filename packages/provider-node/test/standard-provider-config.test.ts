import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decodeZCodeBuiltinRelease } from "../src/zcode-builtin-release.js";

const standardTemplateIds = [
  "standard-anthropic-messages",
  "standard-openai-chat-completions",
  "standard-openai-responses",
] as const;

const retiredTemplateIds = [
  "moonshot-kimi",
  "minimax",
  "deepseek",
  "qwen-alibaba-model-studio-cn",
  "qwen-alibaba-model-studio-intl",
  "xiaomi-mimo",
  "openai",
  "anthropic",
  "xai",
  "openrouter",
  "opencode-go-chat",
  "opencode-go-messages",
  "opencode-go-responses",
  "opencode-zen-responses",
  "opencode-zen-messages",
  "opencode-zen-chat",
  "zai-api",
  "zai-standard-api",
  "bigmodel-api",
  "bigmodel-standard-api",
];

describe("standard provider built-in config", () => {
  it.each(["zcode-builtin.json", "zcode-builtin.test.json"])(
    "%s only carries neutral protocol templates and generic rules",
    async (filename) => {
      const raw = JSON.parse(
        await readFile(new URL(`../../../config/provider/${filename}`, import.meta.url), "utf8"),
      );
      const release = decodeZCodeBuiltinRelease(raw);
      expect(raw.revision).toBeGreaterThanOrEqual(35);
      expect(release.config.providers.keys()).toEqual([]);
      expect(release.config.providerTemplates.keys()).toEqual([...standardTemplateIds]);

      for (const templateId of standardTemplateIds) {
        const template = release.config.providerTemplates.get(templateId)!;
        expect(template.config.api?.type).toBe(templateId.replace("standard-", ""));
        expect(template.config.api?.baseUrl).toBeUndefined();
        expect(template.config.logo).toBeUndefined();
        expect(template.config.builtinModelIds).toEqual([]);
      }

      const rules = raw.config.modelConfigRules;
      expect(rules.modelRules.map((rule: { modelMatch: string }) => rule.modelMatch)).toEqual([
        ".*",
      ]);
      expect(
        rules.modelApiRules.map(
          (rule: { modelMatch: string; apiTypeMatch: string }) =>
            [rule.modelMatch, rule.apiTypeMatch] as const,
        ),
      ).toEqual([
        [".*", "anthropic-messages"],
        [".*", "openai-chat-completions"],
        [".*", "openai-responses"],
      ]);
      expect(rules.providerSiteRules).toEqual([]);
      expect(rules.templateModelRules).toEqual([]);
      expect(rules.builtinProviderModelRules).toEqual([]);

      const templateIds = new Set(release.config.providerTemplates.keys());
      for (const retiredTemplateId of retiredTemplateIds) {
        expect(templateIds.has(retiredTemplateId)).toBe(false);
      }
    },
  );

  it("does not embed retired vendor endpoints", async () => {
    const raw = await readFile(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
      "utf8",
    );
    for (const endpoint of [
      "api.moonshot.cn",
      "api.minimaxi.com",
      "api.deepseek.com",
      "dashscope.aliyuncs.com",
      "api.xiaomimimo.com",
      "api.openai.com",
      "api.anthropic.com",
      "api.x.ai",
      "openrouter.ai",
      "opencode.ai",
      "api.z.ai",
      "open.bigmodel.cn",
    ]) {
      expect(raw).not.toContain(endpoint);
    }
  });
});
