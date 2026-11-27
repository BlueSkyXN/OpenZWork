import { AiSdkModelAdapter, type CreateAiSdkModelOptions } from "@zcode/adapters/model";
import type { Model } from "@zcode/contracts";
import { fileURLToPath } from "node:url";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiKeyAccessConfig,
  ModelConfigRules,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderRegistry,
  type ProviderId,
} from "@zcode/provider";
import {
  NodeZCodeBuiltinProviderConfigSource,
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  type ZCodeBuiltinProviderConfigSnapshot,
} from "@zcode/provider-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiProviderModelRuntime } from "../src/app/provider-registry-model-runtime.js";

const zcodeBuiltinProviderConfigFilePath = fileURLToPath(
  new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
);
const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: zcodeBuiltinProviderConfigFilePath,
  watch: false,
});
const templateId = "standard-openai-chat-completions";
const providerId = "fixture-personal";
const modelId = "fixture-model";
const baseUrl = "https://provider.example.test/v1";
let zcodeBuiltin: ZCodeBuiltinProviderConfigSnapshot;

beforeAll(async () => {
  zcodeBuiltin = await source.read();
});

afterAll(() => source.dispose());

describe("真实 ZCode Built-in Config 到 Active Model", () => {
  it("API Key Personal Overlay 经 Registry 原样装配到 Adapter", () => {
    const registry = resolveRegistry(standardProvider().withPersonalModelIds([modelId]));
    const capture = captureRuntime(registry);

    const model = capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });
    const registryProvider = registry.getProvider(providerId);
    const registryModel = registry.getModel(providerId, modelId);

    expect(model).toBe(capture.models[0]);
    expect(capture.created[0]).not.toHaveProperty("requestDependencies");
    expect(capture.created[0]?.providerConfig).toBe(registryProvider?.config);
    expect(capture.created[0]?.modelConfig).toBe(registryModel?.config);
    expect(capture.created[0]).toMatchObject({
      providerId,
      modelId,
      providerConfig: {
        access: { type: "api-key", apiKey: "fixture-static" },
        api: {
          type: "openai-chat-completions",
          baseUrl,
        },
      },
    });
  });

  it("Personal 覆盖可见性后仍保留原 Provider 的模型成员与协议", () => {
    const registry = resolveRegistry(
      new ProviderConfig({ visibility: "hidden" }),
      standardProvider().overlay(new ProviderConfig({ builtinModelIds: [modelId] })),
    );
    const capture = captureRuntime(registry);

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
    });

    expect(registry.getProvider(providerId)?.models.map(({ modelId: id }) => id)).toEqual([
      modelId,
    ]);
    expect(capture.created[0]?.providerConfig).toMatchObject({
      visibility: "hidden",
      access: { type: "api-key", apiKey: "fixture-static" },
    });
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });

  it("隐藏 Request Auth Provider 仍由普通 Registry 精确创建 Model", () => {
    const personal = standardProvider().withPersonalModelIds([modelId]);
    const registry = resolveRegistry(personal.overlay(new ProviderConfig({ visibility: "hidden" })));
    const capture = captureRuntime(registry);
    const requestAuthSource = { resolve: vi.fn() };

    capture.runtime.modelFactory({
      selection: selectionWithHighestReasoning(registry, providerId, modelId),
      requestDependencies: { requestAuth: { source: requestAuthSource } },
    });

    expect(registry.getView().providers[0]).toMatchObject({
      providerId,
      config: {
        visibility: "hidden",
      },
    });
    expect(capture.created[0]?.requestDependencies?.requestAuth?.source).toBe(requestAuthSource);
    expect(capture.created[0]?.providerConfig).toBe(registry.getProvider(providerId)?.config);
    expect(capture.created[0]?.modelConfig).toBe(registry.getModel(providerId, modelId)?.config);
  });

  it.each(["generate", "stream"])("%s 经过真实工厂和 SDK，重试时切换为本次的 header 凭据", async (method) => {
    const registry = resolveRegistry(standardProvider().withPersonalModelIds([modelId]));
    const requests: Request[] = [];
    const modelAdapter = new AiSdkModelAdapter({
      env: {},
      retry: { maxAttempts: 2, baseDelayMs: 0, jitter: false },
      transport: async (input, init) => {
        requests.push(new Request(input, init));
        if (requests.length === 1) {
          return Response.json({ error: { message: "try again" } }, { status: 503 });
        }
        const message = { role: "assistant", content: "ok" };
        const choice = {
          index: 0,
          finish_reason: "stop",
          ...(method === "stream" ? { delta: message } : { message }),
        };
        const data = { id: "fixture-chat", created: 1, model: modelId, choices: [choice] };
        return method === "stream"
          ? new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, {
              headers: { "content-type": "text/event-stream" },
            })
          : Response.json(data);
      },
    });
    const runtime = new ApiProviderModelRuntime({ registry, modelAdapter });
    runtime.start();
    try {
      const resolve = vi.fn()
        .mockResolvedValueOnce({ apiKey: "fixture-first" })
        .mockResolvedValueOnce({ headers: { "X-Execution-Ticket": "fixture-second" } });
      const model = runtime.modelFactory({
        selection: selectionWithHighestReasoning(registry, providerId, modelId),
        requestDependencies: { requestAuth: { source: { resolve } } },
      });
      const request = {
        messages: [{ role: "user" as const, content: "hello" }],
        options: { maxOutputTokens: 128 },
      };
      if (method === "stream") {
        const events = [];
        for await (const event of model.streamText(request)) events.push(event);
        expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
      } else {
        await expect(model.generateText(request)).resolves.toMatchObject({ text: "ok" });
      }
      const attempts = resolve.mock.calls.map(([input]) => [input.providerId, input.modelId, input.attempt]);
      expect(attempts).toEqual([
        [providerId, modelId, 1],
        [providerId, modelId, 2],
      ]);
      expect(requests.map(({ headers }) => [
        headers.get("authorization"),
        headers.get("x-api-key"),
        headers.get("x-execution-ticket"),
        headers.get("x-static"),
      ])).toEqual([
        ["Bearer fixture-first", null, null, "retained"],
        [null, null, "fixture-second", "retained"],
      ]);
    } finally {
      runtime.dispose();
    }
  });
});

function selectionWithHighestReasoning(
  registry: ProviderRegistry,
  providerId: ProviderId,
  modelId: string,
) {
  const reasoningLevel = registry
    .getModel(providerId, modelId)
    ?.config.optionSpecs.reasoningLevel.values.at(-1);
  if (!reasoningLevel) throw new Error(`测试模型缺少 reasoning: ${providerId}/${modelId}`);
  return { providerId, modelId, options: { reasoningLevel } };
}

function standardProvider() {
  const template = zcodeBuiltin.providerTemplates.get(templateId);
  if (!template) throw new Error(`缺少标准模板 ${templateId}`);
  return template.config.overlay(
    new ProviderConfig({
      group: "standard-personal",
      access: new ApiKeyAccessConfig({ apiKey: "fixture-static" }),
      api: new ProviderApiConfig({
        baseUrl,
        headers: {
          authorization: "Bearer fixture-old",
          "X-Api-Key": "fixture-old",
          "X-Static": "retained",
        },
      }),
    }),
  );
}

function resolveRegistry(personal: ProviderConfig, builtin?: ProviderConfig): ProviderRegistry {
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: builtin ? new ProviderConfigMap([[providerId, builtin]]) : zcodeBuiltin.providers,
    zcodeBuiltinProviderTemplates: zcodeBuiltin.providerTemplates,
    personalProviders: new ProviderConfigMap([[providerId, personal]]),
    zcodeBuiltinModelRules: zcodeBuiltin.models,
    personalModels: ModelConfigRules.empty(),
  });
  expect(resolution.issues).toEqual([]);
  return new ProviderRegistry(resolution.registryProviders);
}

function captureRuntime(registry: ProviderRegistry) {
  const created: CreateAiSdkModelOptions[] = [];
  const models: Model[] = [];
  const runtime = new ApiProviderModelRuntime({
    registry: {
      getView: () => registry.getView(),
      getProvider: (providerId) => registry.getProvider(providerId),
      getModel: (providerId, modelId) => registry.getModel(providerId, modelId),
      validateSelection: (selection) => registry.validateSelection(selection),
      onDidChange: (listener) => registry.onDidChange(listener),
    },
    modelAdapter: {
      createModel(options) {
        created.push(options);
        const model = createCapturedModel(options);
        models.push(model);
        return model;
      },
    },
  });
  runtime.start();
  return { created, models, runtime };
}

function createCapturedModel(options: CreateAiSdkModelOptions): Model {
  const model: Model = {
    providerId: options.providerId,
    modelId: options.modelId,
    properties: options.modelConfig.properties,
    optionSpecs: options.modelConfig.optionSpecs,
    options: options.options,
    bind() {
      return model;
    },
    async generateText() {
      throw new Error("not used");
    },
    streamText() {
      throw new Error("not used");
    },
  };
  return model;
}

it("启动读取模型选择失败时释放已经启动的 Provider 监听", async () => {
  const { startProcessProviderRegistryRuntime } = await import("../src/app/process-provider-registry-runtime.js");
  const root = await mkdtemp(join(tmpdir(), "oz-provider-startup-"));
  const failure = new Error("fixture-selection-read");
  const read = vi.spyOn(NodeModelSelectionConfigRepository.prototype, "read").mockRejectedValueOnce(failure);
  const dispose = vi.spyOn(NodeProviderRegistryRuntime.prototype, "dispose");
  try {
    await expect(startProcessProviderRegistryRuntime({
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: zcodeBuiltinProviderConfigFilePath,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(root, "personal.json"),
    })).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    read.mockRestore();
    dispose.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("OZ-C003：内置配置损坏时逐次释放监听，配置修正后可以再次启动", async () => {
  const { startProcessProviderRegistryRuntime } = await import("../src/app/process-provider-registry-runtime.js");
  const root = await mkdtemp(join(tmpdir(), "oz-registry-retry-"));
  const builtin = join(root, "builtin.json");
  const env = { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtin, ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(root, "personal.json") };
  const dispose = vi.spyOn(NodeZCodeBuiltinProviderConfigSource.prototype, "dispose");
  try {
    await writeFile(builtin, "invalid");
    for (const attempt of [1, 2]) {
      await expect(startProcessProviderRegistryRuntime(env)).rejects.toThrow();
      expect(dispose).toHaveBeenCalledTimes(attempt);
    }
    await copyFile(zcodeBuiltinProviderConfigFilePath, builtin);
    const started = await startProcessProviderRegistryRuntime(env);
    started.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  } finally {
    dispose.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
