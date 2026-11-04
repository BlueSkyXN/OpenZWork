import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decodeZCodeBuiltinRelease } from "../src/zcode-builtin-release.js";

// v3.17.1 同步复核：上游退役了 personal-rule-persistence.test.ts（OW-P019 真实双进程
// 回归宿主）；本文件作为该条目在 provider-node 域的存活回归载体，持续守护个人 Provider
// 配置的标准模板面（provider_config.json 的并发写入经 shared/node 文件锁，Windows mkdir
// EPERM 分支由 packages/shared/test/atomicFileLockWindows.test.ts 的 OW-P019 单元回归覆盖）。

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
    "%s keeps neutral connection templates separate from model capabilities",
    async (filename) => {
      const raw = JSON.parse(
        await readFile(new URL(`../../../config/provider/${filename}`, import.meta.url), "utf8"),
      );
      const release = decodeZCodeBuiltinRelease(raw);
      expect(raw.revision).toBeGreaterThanOrEqual(44);
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
      expect(rules.modelRules[0].modelMatch).toBe(".*");
      expect(rules.modelRules.length).toBeGreaterThan(1);
      expect(
        rules.modelApiRules
          .filter((rule: { modelMatch: string }) => rule.modelMatch === ".*")
          .map(
            (rule: { modelMatch: string; apiTypeMatch: string }) =>
              [rule.modelMatch, rule.apiTypeMatch] as const,
          ),
      ).toEqual([
        [".*", "anthropic-messages"],
        [".*", "openai-chat-completions"],
        [".*", "openai-responses"],
      ]);
      expect(rules.providerSiteRules.length).toBeGreaterThan(0);
      expect(rules.templateModelRules).toEqual([]);
      expect(rules.builtinProviderModelRules).toEqual([]);

      const templateIds = new Set(release.config.providerTemplates.keys());
      for (const retiredTemplateId of retiredTemplateIds) {
        expect(templateIds.has(retiredTemplateId)).toBe(false);
      }
    },
  );

  it("公共能力规则不携带账号端点、鉴权或默认模型目录", async () => {
    const [production, testing] = await Promise.all(
      ["zcode-builtin.json", "zcode-builtin.test.json"].map(async (name) =>
        JSON.parse(
          await readFile(new URL(`../../../config/provider/${name}`, import.meta.url), "utf8"),
        ),
      ),
    );
    expect(testing).toEqual(production);
    expect(JSON.stringify(production.config.modelConfigRules)).not.toMatch(
      /zcode|zhipu-account|apiKey|authorization|builtinModelIds/i,
    );
    expect(JSON.stringify(production.config.providerConfigRules)).not.toMatch(/https?:\/\//i);
  });
});
