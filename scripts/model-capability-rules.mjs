import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const repositoryRoot = resolve(import.meta.dirname, "..");
// 原厂精确型号与协议能力可供同 ID 的兼容接入使用；聚合平台差异仅属于其 endpoint。
const nativeTemplates = new Set([
  "openai",
  "anthropic",
  "xai",
  "moonshot-kimi",
  "minimax",
  "deepseek",
  "zai-standard-api",
  "bigmodel-standard-api",
  "qwen-alibaba-model-studio-cn",
  "qwen-alibaba-model-studio-intl",
  "xiaomi-mimo",
  "tencent-tokenhub-cn",
  "tencent-tokenhub-intl",
  "volcengine-ark",
  "stepfun",
]);

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function retiredEndpoint(pattern) {
  return /zcode|\/zcode-plan\/|\/off-peak\/|\/highspeed\//i.test(pattern);
}

function capabilities(config) {
  const { properties, optionSpecs } = config;
  return structuredClone({
    ...(properties ? { properties } : {}),
    ...(optionSpecs ? { optionSpecs } : {}),
  });
}

/** 仅投影能力；模板、模型成员、账号和鉴权字段不进入输出。 */
export function extractModelCapabilityRules(source) {
  const rules = source.config.modelConfigRules;
  const templates = new Map(
    source.config.providerConfigRules.templateRules.map((t) => [t.templateId, t]),
  );
  const modelApiRules = structuredClone(rules.modelApiRules);
  const providerSiteRules = structuredClone(
    rules.providerSiteRules.filter((r) => !retiredEndpoint(r.baseUrlMatch)),
  );
  const nativeSeen = new Map();
  const siteSeen = new Map();
  for (const rule of rules.templateModelRules) {
    const config = capabilities(rule.config);
    if (Object.keys(config).length === 0) continue;
    const template = templates.get(rule.templateId);
    assert(template, `Missing source template: ${rule.templateId}`);
    const api = template.config.api;
    assert(api?.baseUrl && api.type, `Missing source endpoint: ${rule.templateId}`);
    if (retiredEndpoint(api.baseUrl)) continue;
    const endpoint = new URL(api.baseUrl);
    assert(
      endpoint.protocol === "https:" &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.search &&
        !endpoint.hash,
      `Source endpoint must be a public HTTPS address without credentials: ${rule.templateId}`,
    );
    const modelMatch = escapePattern(rule.modelId);
    const apiTypeMatch = escapePattern(api.type);
    const baseUrl = endpoint.toString().replace(/\/+$/, "");
    // Messages Adapter 会给未带 /v1 的地址补同一个后缀，两种配置必须命中相同渠道能力。
    const baseUrlMatch =
      api.type === "anthropic-messages"
        ? `${escapePattern(baseUrl.replace(/\/v1$/, ""))}(?:/v1)?/?`
        : `${escapePattern(baseUrl)}/?`;
    const siteKey = JSON.stringify([baseUrlMatch, apiTypeMatch, modelMatch]);
    const signature = JSON.stringify(config);
    if (siteSeen.has(siteKey))
      assert.equal(
        siteSeen.get(siteKey),
        signature,
        `Conflicting channel rule: ${rule.templateId}/${rule.modelId}`,
      );
    else {
      siteSeen.set(siteKey, signature);
      providerSiteRules.push({ modelMatch, apiTypeMatch, baseUrlMatch, config });
    }
    if (nativeTemplates.has(rule.templateId)) {
      const key = JSON.stringify([apiTypeMatch, modelMatch]);
      if (nativeSeen.has(key))
        assert.equal(nativeSeen.get(key), signature, `Conflicting native rule: ${rule.modelId}`);
      else {
        nativeSeen.set(key, signature);
        modelApiRules.push({ modelMatch, apiTypeMatch, config: structuredClone(config) });
      }
    }
  }
  return {
    modelRules: structuredClone(rules.modelRules),
    modelApiRules,
    providerSiteRules,
    templateModelRules: [],
    builtinProviderModelRules: [],
  };
}

/** 上游公开目录仅作为验收输入，保存在测试 fixture，不成为产品模型成员。 */
export function extractModelCapabilityCases(source) {
  const cases = new Map();
  for (const template of source.config.providerConfigRules.templateRules) {
    const api = template.config.api;
    if (!api?.baseUrl || !api.type || retiredEndpoint(api.baseUrl)) continue;
    const endpoint = new URL(api.baseUrl);
    assert(
      endpoint.protocol === "https:" &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.search &&
        !endpoint.hash,
    );
    for (const modelId of template.config.builtinModelIds ?? []) {
      const item = [modelId, api.type, endpoint.toString().replace(/\/+$/, "")];
      cases.set(JSON.stringify(item), item);
    }
  }
  return [...cases.values()];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || !args.includes("--source-ref")) {
    console.log(
      "Usage: node scripts/model-capability-rules.mjs --source-ref <local-git-ref> [--write]",
    );
    return;
  }
  const sourceRef = args[args.indexOf("--source-ref") + 1];
  assert(sourceRef && !sourceRef.startsWith("-"), "--source-ref requires a local Git revision");
  const run = promisify(execFile);
  const { stdout } = await run("git", ["show", `${sourceRef}:config/provider/zcode-builtin.json`], {
    cwd: repositoryRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  const { stdout: commit } = await run("git", ["rev-parse", "--verify", `${sourceRef}^{commit}`], {
    cwd: repositoryRoot,
  });
  const source = JSON.parse(stdout);
  const path = resolve(repositoryRoot, "config/provider/zcode-builtin.json");
  const current = JSON.parse(await readFile(path, "utf8"));
  const projected = extractModelCapabilityRules(source);
  const channelCases = extractModelCapabilityCases(source);
  assert(projected.modelRules[0]?.modelMatch === ".*", "Source generic model rule must come first");
  // 未知模型的通用开关和三协议映射按本地兼容契约保留，不随上游导入改变。
  projected.modelRules[0] = structuredClone(
    current.config.modelConfigRules.modelRules.find((r) => r.modelMatch === ".*"),
  );
  for (const rule of projected.modelApiRules) {
    if (rule.modelMatch !== ".*") continue;
    const local = current.config.modelConfigRules.modelApiRules.find(
      (r) => r.modelMatch === ".*" && r.apiTypeMatch === rule.apiTypeMatch,
    );
    if (local) rule.config = structuredClone(local.config);
  }
  const unchanged = JSON.stringify(projected) === JSON.stringify(current.config.modelConfigRules);
  const next = {
    ...current,
    revision: unchanged ? current.revision : Math.max(current.revision, source.revision) + 1,
    config: { ...current.config, modelConfigRules: projected },
  };
  const { decodeZCodeBuiltinRelease } = await tsImport(
    pathToFileURL(resolve(repositoryRoot, "packages/provider-node/src/zcode-builtin-release.ts"))
      .href,
    import.meta.url,
  );
  decodeZCodeBuiltinRelease(next);
  console.log(
    JSON.stringify(
      {
        sourceCommit: commit.trim(),
        sourceRevision: source.revision,
        revision: next.revision,
        rules: Object.fromEntries(
          Object.entries(projected).map(([key, value]) => [key, value.length]),
        ),
      },
      null,
      2,
    ),
  );
  if (args.includes("--write")) {
    const content = `${JSON.stringify(next, null, 2)}\n`;
    const fixtureDirectory = resolve(repositoryRoot, "packages/provider-node/test/fixtures");
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(path, content);
    await writeFile(resolve(repositoryRoot, "config/provider/zcode-builtin.test.json"), content);
    await writeFile(
      resolve(fixtureDirectory, "model-capability-cases.json"),
      `${JSON.stringify(channelCases, null, 2)}\n`,
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
