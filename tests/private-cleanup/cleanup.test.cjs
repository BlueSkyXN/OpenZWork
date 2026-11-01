/* oxlint-disable eslint(max-lines) -- 各清理工作包的门禁断言聚合在同一文件，CI 以 node --test 单文件入口运行，不拆分。 */
/* Tests added for the private-fork cleanup. No application dependencies are faked in production.
 * These focused tests transpile real source with TypeScript. Only unavailable SDK factories,
 * ProxyAgent construction and the provider-runtime's file-port collaborators use test doubles.
 * No live model, Electron, persistent-session, or proxy-server integration is claimed.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const execFileAsync = promisify(execFile);
const root = process.env.ZCODE_TEST_SOURCE_ROOT || path.resolve(__dirname, "../..");
const ts = require(process.env.TYPESCRIPT_MODULE_PATH || "typescript");
const adapter = "apps/zcode-cli/packages/adapters/src/model/";
const sdkCalls = [];
function sdkFactory(kind) {
  return (options) => {
    sdkCalls.push({ kind, options });
    const model = (id) => ({ id, kind, options });
    model.responses = model;
    return model;
  };
}
function createLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      reportDiagnostics: true,
    });
    assert.equal(
      (output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length,
      0,
    );
    const module = { exports: {} };
    cache.set(filename, module);
    function sourceRequire(id) {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.startsWith("node:")) return require(id);
      if (id === "@zcode/shared") return load("packages/shared/src/runtimeEnv.ts");
      if (id === "@zcode/model-option-map") return load("packages/model-option-map/src/index.ts");
      if (id === "@ai-sdk/anthropic") return { createAnthropic: sdkFactory("anthropic") };
      if (id === "@ai-sdk/openai") return { createOpenAI: sdkFactory("responses") };
      if (id === "@ai-sdk/openai-compatible") return { createOpenAICompatible: sdkFactory("chat") };
      if (id === "proxy-agent")
        return {
          ProxyAgent: class {
            constructor() {
              throw new Error("Real proxy-server integration is outside this test.");
            }
          },
        };
      if (id.startsWith("."))
        return load(
          path.relative(root, path.resolve(path.dirname(filename), id.replace(/\.js$/, ".ts"))),
        );
      throw new Error(`Unprovided dependency in focused source test: ${id}`);
    }
    new Function("require", "module", "exports", output.outputText)(
      sourceRequire,
      module,
      module.exports,
    );
    return module.exports;
  }
  return load;
}
const load = createLoader();
const { AiSdkModelExecution, createProviderBusinessErrorFetch } = load(
  adapter + "model-execution.ts",
);
const { createRuntimeAiSdkModelExecutionConfig } = load(
  "apps/zcode-cli/packages/bootstrap/src/model-config.ts",
);
const { resolveProxyForRequest } = load(
  "apps/zcode-cli/packages/adapters/src/network/http-config.ts",
);
const specs = {
  reasoningLevel: { map: '{"reasoning_effort": reasoningLevel}' },
  maxOutputTokens: { map: '{"max_tokens": maxOutputTokens}' },
};
function provider(
  apiType = "openai-chat-completions",
  baseUrl = "http://127.0.0.1:12345/v1",
  headers,
) {
  return {
    access: { type: "api-key", apiKey: "test-only-key" },
    api: { type: apiType, baseUrl, headers },
  };
}
function bind(execution, config) {
  return execution.bindModel({
    providerId: "personal:test",
    modelId: "test-model",
    providerConfig: config,
    supportsJsonSchemaOutput: true,
    optionSpecs: specs,
  });
}
function okJson() {
  return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
}

test("[behavior] CLI execution config injects no product/device headers even with legacy variables", () => {
  const env = {
    ZCODE_BASE_URL: "https://zcode.z.ai",
    ZCODE_DEVICE_MID: "test-device",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
  };
  const config = createRuntimeAiSdkModelExecutionConfig(env);
  assert.deepEqual(Object.keys(config), ["env"]);
  assert.equal(config.env, env);
});
test("[behavior] explicit proxy, CA and noProxy settings are preserved", () => {
  const network = {
    httpProxy: "http://127.0.0.1:8123",
    noProxy: "localhost,.internal",
    caCertFile: "/tmp/test-ca.pem",
  };
  assert.deepEqual(createRuntimeAiSdkModelExecutionConfig({}, { network }).network, network);
  assert.equal(
    resolveProxyForRequest("https://example.org/", { httpProxy: network.httpProxy }).proxyUrl,
    "http://127.0.0.1:8123/",
  );
  assert.equal(resolveProxyForRequest("https://model.internal/", network).noProxyMatched, true);
});
for (const [label, url] of [
  ["BigModel former rewritten endpoint", "https://open.bigmodel.cn/api/anthropic/v1/messages"],
  ["Z.ai former rewritten endpoint", "https://api.z.ai/api/anthropic/v1/messages"],
  ["private endpoint", "http://127.0.0.1:12345/v1/chat/completions"],
]) {
  test(`[behavior] ${label} reaches injected transport unchanged`, async () => {
    let actual;
    const config = provider("anthropic-messages", url.replace(/\/messages$/, ""));
    const execution = new AiSdkModelExecution(
      { env: { ZCODE_BASE_URL: "https://product.invalid" } },
      {
        transport: async (input, init) => {
          actual = { input: String(input), init };
          return okJson();
        },
      },
    );
    const binding = bind(execution, config);
    const headers = { Authorization: "Bearer explicit-test", "X-Custom": "keep" };
    const body = '{"messages":[{"role":"user","content":"test"}]}';
    const signal = new AbortController().signal;
    await binding.resolved.model.options.fetch(url, { method: "POST", headers, body, signal });
    assert.equal(actual.input, url);
    assert.equal(actual.init.body, body);
    assert.equal(actual.init.signal, signal);
    assert.equal(new Headers(actual.init.headers).get("Authorization"), headers.Authorization);
  });
}
for (const [apiType, kind] of [
  ["anthropic-messages", "anthropic"],
  ["openai-responses", "responses"],
  ["openai-chat-completions", "chat"],
]) {
  test(`[behavior] ${apiType} selects the existing SDK protocol factory`, () => {
    const b = bind(
      new AiSdkModelExecution({ env: {} }, { transport: async () => okJson() }),
      provider(apiType),
    );
    assert.equal(b.resolved.model.kind, kind);
    assert.equal(b.resolved.model.id, "test-model");
  });
}
test("[behavior] no default OpenRouter or ZCode attribution headers", () => {
  const b = bind(
    new AiSdkModelExecution({ env: {} }),
    provider("openai-chat-completions", "https://openrouter.ai/api/v1"),
  );
  assert.deepEqual(b.resolved.headers, {});
  assert.deepEqual(b.resolved.model.options.headers, {});
});
test("[behavior] explicit caller and user headers keep case-insensitive precedence", () => {
  const b = bind(
    new AiSdkModelExecution({ env: {}, defaultHeaders: { "X-Custom": "old", "X-Caller": "yes" } }),
    provider(undefined, undefined, { "x-custom": "new" }),
  );
  assert.deepEqual(b.resolved.headers, { "X-Caller": "yes", "x-custom": "new" });
});
test("[behavior] frozen endpoint binding survives external config mutation and request credentials can rotate", () => {
  const cfg = provider();
  const b = bind(new AiSdkModelExecution({ env: {} }), cfg);
  cfg.api.baseUrl = "https://unexpected.invalid/v1";
  const r = b.resolveRequest({
    options: { reasoningLevel: "high", maxOutputTokens: 512 },
    requestAuth: { apiKey: "rotated-test", headers: { "X-Request": "keep" } },
  });
  assert.equal(r.model.options.baseURL, "http://127.0.0.1:12345/v1");
  assert.equal(r.model.options.apiKey, "rotated-test");
  assert.equal(r.model.options.headers["X-Request"], "keep");
});
test("[behavior] actual model-option mapping still sets reasoning and output-token fields", async () => {
  let requestBody;
  const execution = new AiSdkModelExecution(
    { env: {} },
    {
      transport: async (_, init) => {
        requestBody = JSON.parse(init.body);
        return okJson();
      },
    },
  );
  const b = bind(execution, provider());
  const r = b.resolveRequest({ options: { reasoningLevel: "high", maxOutputTokens: 512 } });
  await r.model.options.fetch("http://127.0.0.1:12345/v1/chat/completions", {
    method: "POST",
    body: '{"model":"test-model","messages":[]}',
  });
  assert.equal(requestBody.reasoning_effort, "high");
  assert.equal(requestBody.max_tokens, 512);
  assert.equal(requestBody.model, "test-model");
});
test("[behavior] transport AbortError is not swallowed by cleanup", async () => {
  const abort = new DOMException("cancelled", "AbortError");
  const f = createProviderBusinessErrorFetch({
    env: {},
    providerId: "personal:test",
    providerKind: "openai-compatible",
    fetch: async () => {
      throw abort;
    },
  });
  await assert.rejects(
    () => f("http://127.0.0.1:12345/"),
    (error) => error === abort,
  );
});
test("[behavior] TLS failure classification remains operational", async () => {
  const f = createProviderBusinessErrorFetch({
    env: {},
    providerId: "personal:test",
    providerKind: "openai-compatible",
    fetch: async () => {
      throw Object.assign(new Error("bad cert"), { code: "CERT_HAS_EXPIRED" });
    },
  });
  await assert.rejects(
    () => f("http://127.0.0.1:12345/"),
    (error) => error.code === "MODEL_TLS_VALIDATION_FAILED",
  );
});
test("[behavior] stream contents are preserved without product routing", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
  const f = createProviderBusinessErrorFetch({
    env: {},
    providerId: "personal:test",
    providerKind: "openai-compatible",
    fetch: async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
  });
  assert.equal(await (await f("http://127.0.0.1:12345/")).text(), sse);
});

function providerRuntimeFixture(failFirst = false) {
  const state = { reads: 0, closes: [], builtin: null, personal: null };
  class Builtin {
    constructor(options) {
      this.activeFilePath = options.activeFilePath || options.bundledFilePath;
      state.builtin = options;
    }
    read() {
      return Promise.resolve({ revision: "local-test" });
    }
    dispose() {
      state.closes.push("builtin");
    }
  }
  class Personal {
    constructor(options) {
      state.personal = options;
    }
    dispose() {
      state.closes.push("personal");
    }
  }
  class Config {
    constructor(options) {
      this.options = options;
    }
    read() {
      state.reads++;
      return failFirst && state.reads === 1
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve({ revision: "local-test" });
    }
    dispose() {
      state.closes.push("config");
    }
  }
  const source = createLoader({
    "@zcode/provider": { ProviderConfigService: Config },
    "./zcode-builtin-provider-config-source.js": { NodeZCodeBuiltinProviderConfigSource: Builtin },
    "./personal-provider-config-repository.js": { NodePersonalProviderConfigRepository: Personal },
  });
  return {
    state,
    Runtime: source("packages/provider-node/src/provider-config-runtime.ts")
      .NodeProviderConfigRuntime,
  };
}
test("[behavior / file-port doubles] config runtime shares initialization and disposes actual owners once", async () => {
  const { state, Runtime } = providerRuntimeFixture();
  const runtime = new Runtime({
    zcodeBuiltinFilePath: "/tmp/builtin.json",
    personalFilePath: "/tmp/personal.json",
    watch: false,
    personalPollingIntervalMs: false,
  });
  assert.equal(runtime.start(), runtime.start());
  await runtime.start();
  assert.equal(state.reads, 1);
  assert.equal(await runtime.resolveZCodeBuiltinActiveFilePath(), "/tmp/builtin.json");
  assert.equal(state.builtin.watch, false);
  assert.equal(state.personal.pollingIntervalMs, false);
  runtime.dispose();
  runtime.dispose();
  assert.deepEqual(state.closes, ["config", "personal", "builtin"]);
  assert.throws(() => runtime.start(), /dispose/);
});
test("[behavior / file-port doubles] local config read failure is retryable, not marked successful", async () => {
  const { state, Runtime } = providerRuntimeFixture(true);
  const runtime = new Runtime({
    zcodeBuiltinFilePath: "/tmp/builtin.json",
    personalFilePath: "/tmp/personal.json",
  });
  await assert.rejects(runtime.start(), /read failed/);
  await runtime.start();
  assert.equal(state.reads, 2);
  runtime.dispose();
});
test("[behavior / file-port doubles] removed remote-refresh options cannot invoke a downloader", async () => {
  const { Runtime } = providerRuntimeFixture();
  let remoteCalls = 0;
  const runtime = new Runtime({
    zcodeBuiltinFilePath: "/tmp/builtin.json",
    personalFilePath: "/tmp/personal.json",
    zcodeBuiltinEnvironment: {
      fetchRelease: () => {
        remoteCalls++;
        throw new Error("must not be called");
      },
    },
  });
  await runtime.start();
  assert.equal(remoteCalls, 0);
  assert.equal("refreshZCodeBuiltin" in runtime, false);
  assert.equal("onDidCheckZCodeBuiltin" in runtime, false);
  runtime.dispose();
});

test("[structural, not runtime] removed gateways and exporters are physically absent", () => {
  for (const file of [
    adapter + "official-coding-plan-gateway.ts",
    "packages/shared/src/openrouter-attribution.ts",
    "apps/zcode-cli/packages/telemetry",
    "apps/zcode-cli/packages/core/src/telemetry/runtime-telemetry.ts",
    "packages/provider-node/src/zcode-builtin-download.ts",
    "packages/provider-node/src/endpoint-scoped-zcode-builtin-source.ts",
    "packages/desktop/src/main/localTtftExporter.ts",
    "packages/desktop/src/main/rendererActionTraceExporter.ts",
  ])
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
});
test("[structural, not runtime] WP-05 telemetry full-chain sources are physically absent", () => {
  const removed = [
    "packages/desktop/src/main/appARMSBootstrap.ts",
    "packages/desktop/src/main/appTelemetryRuntime.ts",
    "packages/desktop/src/shared/armsRumShared.ts",
    "packages/desktop/src/shared/armsRumBridgeForward.ts",
    "packages/desktop/src/main/armsEventRedaction.ts",
    "packages/desktop/src/main/armsUserIdentity.ts",
    "packages/desktop/src/main/armsBrowserPerfLoadNudge.ts",
    "packages/desktop/src/main/desktopArmsCustomEvent.ts",
    "packages/desktop/src/main/desktopStabilityTelemetry.ts",
    "packages/desktop/src/main/desktopMcpTelemetry.ts",
    "packages/desktop/src/main/desktopRemoteUsageArmsTelemetry.ts",
    "packages/desktop/src/main/desktopNetworkTelemetry.ts",
    "packages/desktop/src/main/networkTelemetryAggregator.ts",
    "packages/desktop/src/main/databaseStartupTelemetry.ts",
    "packages/desktop/src/main/startupTelemetryDelivery.ts",
    "packages/desktop/src/main/longTaskAttributionSummary.ts",
    "packages/desktop/src/main/desktopTelemetryFetch.ts",
    "packages/desktop/src/main/desktopResourceTelemetry.ts",
    "packages/desktop/src/main/desktopZCodeDataSizeTelemetry.ts",
    "packages/desktop/src/main/zcodeDataSizeTelemetryState.ts",
    "packages/desktop/src/main/processResourceRoleClassifier.ts",
    "packages/desktop/src/main/resourceMetricsStats.ts",
    "packages/desktop/src/scheduler/schedulerResourceTelemetry.ts",
    "packages/desktop/src/host/hostNetworkTelemetry.ts",
    "packages/desktop/src/host/hostSessionCreateTelemetry.ts",
    "packages/desktop/src/host/hostServiceResourceTelemetry.ts",
    "packages/desktop/src/host/hostSelfResourceTelemetry.ts",
    "packages/desktop/src/host/hostMcpTelemetry.ts",
    "packages/desktop/src/host/hostResourceTelemetryEnvironment.ts",
    "packages/services/src/telemetry/telemetryCore.ts",
    "packages/services/src/oauth/repo/oauthCredentialRepo.ts",
    // packages/shared/src/telemetry.ts 已随 WP-05 禁列收口迁入
    // conversation-telemetry/eventShapes.ts（远端事件链的最小事件形态定义），
    // 原路径不得再出现；其余远端遥测 shim 同样保持物理缺席。
    "packages/shared/src/telemetry.ts",
    "packages/shared/src/remoteUsageTelemetry.ts",
    "packages/shared/src/sessionCreateTelemetry.ts",
    "packages/shared/src/rendererActionTrace.ts",
    // v3.17.1 边界更新：processResourceTelemetry 自本轮合并起是被采纳的保留观测链
    // （远端心跳 lane/样本契约，validation.ts 消费），不再列入禁列。
    "packages/shared/src/telemetryRedaction.ts",
    "packages/ui/src/lib/appTelemetry.ts",
    "packages/ui/src/lib/sessionCreateTelemetry.ts",
    "packages/ui/src/lib/uiPerfArmsTelemetry.ts",
    "packages/ui/src/lib/sessionOpenArmsTelemetry.ts",
    "packages/ui/src/lib/userActionTelemetry.ts",
    "packages/ui/src/lib/userActionTraceCatalog.ts",
    "packages/ui/src/v4/telemetry/conversationTelemetrySupervisor.ts",
    "packages/ui/src/v4/telemetry/ConversationTelemetryAttachment.tsx",
    "packages/ui/src/v4/telemetry/localTtftObserver.ts",
    "packages/ui/src/onboarding/useOnboardingTelemetry.ts",
    "packages/desktop/src/renderer/appTelemetryBridge.ts",
  ];
  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});
test("[structural, not runtime] Desktop OTLP initialization and IPC bridge methods are removed", () => {
  for (const file of [
    "packages/desktop/src/main/index.ts",
    "packages/desktop/src/preload/index.ts",
    "packages/desktop/src/renderer/src/desktopPlatform.ts",
    "packages/shared/src/platform.ts",
  ]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /createLocalTtftExporter|createRendererActionTraceExporter|reportLocalTtftBatch|reportRendererActionTraceBatch|getRendererActionTraceConfig/,
    );
  }
});
test("[structural, not runtime] build configs no longer validate or inject telemetry runtime modules", () => {
  const bundle = fs.readFileSync(path.join(root, "packages/desktop/scripts/bundle.mjs"), "utf8");
  const builder = fs.readFileSync(
    path.join(root, "packages/desktop/electron-builder.config.js"),
    "utf8",
  );
  // v3.17.1 边界更新：@babel/runtime 是上游 Electron 44 升级的通用 polyfill 处理（非遥测），
  // 不再纳入本结构断言；遥测运行时注入面仍只封 @opentelemetry 与 @arms。
  assert.doesNotMatch(bundle, /@opentelemetry|@arms\//);
  assert.doesNotMatch(builder, /@opentelemetry|@arms\//);
});
test("[structural, not runtime] shared telemetry env constants and channels are removed", () => {
  const env = fs.readFileSync(path.join(root, "packages/shared/src/env.ts"), "utf8");
  assert.doesNotMatch(
    env,
    /ZCODE_TELEMETRY_ENABLED|ZCODE_TELEMETRY_REPORT_ENDPOINT|ZCODE_ARMS_RUM_ENDPOINT|ArmsRumEnv/,
  );
  const channels = fs.readFileSync(path.join(root, "packages/shared/src/channels.ts"), "utf8");
  assert.doesNotMatch(
    channels,
    /SyncTelemetryContext|ReportTelemetryEvent|ReportArmsCustomEvent|ReportRendererHeapSample|FinalArmsCustomEventsE2E/,
  );
});
test("[structural, not runtime] Agent and Desktop direct exporter dependencies are removed", () => {
  const bootstrap = JSON.parse(
    fs.readFileSync(path.join(root, "apps/zcode-cli/packages/bootstrap/package.json")),
  );
  assert.equal(bootstrap.dependencies["@zcode/telemetry"], undefined);
  const desktop = JSON.parse(fs.readFileSync(path.join(root, "packages/desktop/package.json")));
  assert.equal(
    Object.keys(desktop.dependencies).filter((x) => x.startsWith("@opentelemetry/")).length,
    0,
  );
});
test("[structural, not runtime] tool executor uses its business implementation, not a telemetry wrapper", () => {
  const text = fs.readFileSync(
    path.join(root, "apps/zcode-cli/packages/core/src/tool/executor/call-runner.ts"),
    "utf8",
  );
  assert.doesNotMatch(text, /runToolCallWithTelemetry/);
  assert.match(text, /executeToolCallImpl/);
});
test("[structural, not runtime] bootstrap no longer treats ordinary Agent directory as a submodule", () => {
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, "scripts/bootstrap.mjs"), "utf8"),
    /git submodule|runGit\(|["']submodule["']/,
  );
});
test("[structural, not runtime] WP-06: official MCP residue is removed from agent packages", () => {
  for (const file of [
    "apps/zcode-cli/packages/adapters/src/mcp/index.ts",
    "apps/zcode-cli/packages/adapters/src/plugins/mcp.ts",
    "apps/zcode-cli/packages/contracts/src/interfaces/mcp.port.ts",
    "apps/zcode-cli/packages/core/src/tool/types.ts",
    "packages/shared/src/index.ts",
    "packages/shared/src/channels.ts",
  ]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    // zcode_official 只允许作为旧缓存配置的显式拒绝文案存在（plugins/mcp.ts 的退役 throw）。
    assert.doesNotMatch(text, /officialMcp|OfficialMcp|official_mcp|OFFICIAL_MCP/);
  }
  for (const removed of [
    "packages/shared/src/official-mcp-auth.ts",
    "packages/shared/src/official-mcp-tool-error.ts",
    "packages/shared/src/clientConfig.ts",
    "packages/shared/src/cuaAccessibilitySettings.ts",
    "packages/zcode-cua",
    "apps/zcode-cli/packages/adapters/src/mcp/official-auth.ts",
    "apps/zcode-cli/packages/adapters/src/plugins/mcp-official-auth.ts",
    "apps/zcode-cli/packages/services/client-config",
    "apps/zcode-cli/packages/services/client-scenes",
    "apps/zcode-cli/packages/services/cua-permission-broker",
    "apps/zcode-cli/packages/core/src/runtime/helpers/official-cua-media.ts",
    "apps/zcode-cli/packages/core/src/subagent/computer-use-policy.ts",
    "apps/zcode-cli/packages/node-repl-host/src/cua-bridge.ts",
    "apps/zcode-cli/packages/node-repl-host/src/cua-broker.ts",
    "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/computer-use-operation-event.ts",
    "apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/cua-app-snapshot.ts",
    "apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/cua-permission-observation.ts",
    "apps/zcode-cli/packages/bootstrap/src/app/superpowers-plugin",
    "packages/services/src/cua-permission-broker",
    "packages/services/src/client-config",
    "packages/services/src/client-scenes",
    "packages/ui/src/settings/ComputerUseSection.tsx",
    "packages/desktop/src/main/desktopCuaPermissionIpc.ts",
    "packages/desktop/src/main/cuaPermissionDragPanel.ts",
    "packages/desktop/src/main/windowsCuaOperationIndicator.ts",
    "packages/desktop/src/preload/cuaPermissionPanel.ts",
    "packages/desktop/src/renderer/cuaPermissionPanel.tsx",
  ]) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, removed);
  }
});
test("[structural, not runtime] WP-06: CUA / clientScenes / plugin-creator surfaces are gone", () => {
  const surfaces = [
    "packages/shared/src/runtimeEnv.ts",
    "packages/shared/src/platform.ts",
    "packages/shared/src/zcode-protocol/index.ts",
    "packages/shared/src/zcode-protocol-v4/rows.ts",
    "packages/services/src/node.ts",
    "packages/services/src/zcode-agent/zcodeAgentService.ts",
    "packages/desktop/src/main/index.ts",
    "packages/desktop/src/preload/index.ts",
    "packages/desktop/src/renderer/src/desktopPlatform.ts",
    "packages/ui/src/v4/ConversationDraftSuggestedPromptsContainer.tsx",
    "packages/ui/src/settings/settingsPageConfig.ts",
    "packages/ui/src/i18n/locales/zh-CN.ts",
    "packages/ui/src/i18n/locales/en-US.ts",
    "packages/client/src/globals.d.ts",
    "apps/zcode-cli/packages/bootstrap/src/app/runtime-config.ts",
    "apps/zcode-cli/packages/bootstrap/src/mcp-config.ts",
    "apps/zcode-cli/packages/core/src/mcp/index.ts",
    "apps/zcode-cli/packages/core/src/runtime/types.ts",
    "apps/zcode-cli/packages/node-repl-host/src/server.ts",
    "apps/zcode-cli/packages/cli/src/plugin-host-command.ts",
  ];
  for (const file of surfaces) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /cuaPermission|CuaPermission|cuaAccessibility|CuaOsSupport|computerUse|ComputerUse|clientScenes|ClientScenes|pluginCreator|trustedOfficialCua|syncActiveTaskSession|ZCODE_CUA_/,
      file,
    );
  }
});

test("[structural, not runtime] WP-07: conversation-share / cloud feedback / app-update sources are physically absent", () => {
  const dm = "packages/desktop/src/main/",
    sh = "packages/shared/src/",
    ui = "packages/ui/src/";
  const v4 = ui + "v4/",
    fb = "packages/services/src/feedback/",
    web = "packages/web/src/";
  // 应用更新与强更门禁 / conversationShare 全链 / 云端反馈工单与 UI / web 分享页登录
  const removed = [
    dm + "autoUpdater.ts",
    dm + "forceUpdateGuard.ts",
    dm + "forceUpdatePrompt.ts",
    dm + "manifestUpdateProvider.ts",
    dm + "windowsInstallResourceLocks.ts",
    sh + "update.ts",
    sh + "forceUpdate.ts",
    sh + "conversation-share.ts",
    sh + "feedback.ts",
    ui + "UpdateStatusButton.tsx",
    ui + "UpdateStatusDialog.tsx",
    ui + "UpdateStatusDialogController.tsx",
    ui + "UpdateStatusWindowRoot.tsx",
    ui + "updateStatusModel.ts",
    ui + "updateStatusButtonLayout.ts",
    ui + "UpdateReleaseNotesTooltip.tsx",
    ui + "updateReleaseNotes.ts",
    ui + "hooks/useDesktopUpdateMenu.ts",
    ui + "lib/desktopUpdateMenu.ts",
    "packages/services/src/conversation-share",
    "packages/desktop/src/host/conversationShareAttachmentService.ts",
    ui + "ConversationShareMenu.tsx",
    ui + "ConversationSharePermissionPicker.tsx",
    ui + "store/conversationShareSelectionStore.ts",
    ui + "lib/conversationShareContext.ts",
    ui + "lib/conversationShareError.ts",
    ui + "root/shareImportIntent.ts",
    v4 + "ConversationShareConfirmationDock.tsx",
    v4 + "ConversationShareSuccessDock.tsx",
    v4 + "ConversationShareSelectionDock.tsx",
    v4 + "ConversationShareSelectionPanel.tsx",
    v4 + "ConversationShareSelectionReopenTab.tsx",
    v4 + "ConversationShareSelectionScrim.tsx",
    v4 + "ConversationShareImportNotice.tsx",
    v4 + "ConversationShareReadonlyTimeline.tsx",
    v4 + "conversationShareAttempt.ts",
    v4 + "conversationShareMarkdown.ts",
    v4 + "conversationShareModeMotion.ts",
    v4 + "conversationShareModePolicy.ts",
    v4 + "conversationSharePreflightCache.ts",
    v4 + "conversationShareScrollbarMetrics.ts",
    v4 + "conversationShareSelectionPanelLayout.ts",
    v4 + "useConversationShareSelectionOutsideDismiss.ts",
    web + "share",
    // 云端反馈工单与 UI（保留本地日志导出 feedbackLogArchive）
    fb + "feedbackHttpClient.ts",
    fb + "feedbackService.ts",
    fb + "feedback.ts",
    fb + "feedbackLocalTicketStore.ts",
    fb + "compactLogArchive.ts",
    ui + "feedback",
    ui + "lib/errorFeedbackDraft.ts",
    ui + "lib/taskFeedbackDraft.ts",
    web + "auth", // OAuthCredentialRepo 最后残留
  ];
  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});

test("[structural, not runtime] WP-07: updater dependencies and share/feedback/update channel surface are gone", () => {
  // 依赖声明暂留（lockfile 未同步，归 WP-09 终审删除）；此处断言更强的行为事实：
  // desktop 源码不再 import 更新链三包，声明本身不产生任何可执行路径。
  const depImported = (dep) => {
    const re = new RegExp(`['"]${dep}(/[^'"]*)?['"]`);
    const walk = (d) =>
      fs
        .readdirSync(d, { withFileTypes: true })
        .some((e) =>
          e.isDirectory()
            ? walk(path.join(d, e.name))
            : /\.[cm]?[jt]sx?$/.test(e.name) &&
              re.test(fs.readFileSync(path.join(d, e.name), "utf8")),
        );
    return walk(path.join(root, "packages/desktop/src"));
  };
  for (const dep of ["electron-updater", "semver", "yaml"]) {
    assert.equal(depImported(dep), false, dep);
  }
  for (const file of [
    "packages/shared/src/channels.ts",
    "packages/shared/src/platform.ts",
    "packages/shared/src/index.ts",
    "packages/shared/src/protocol.ts",
    "packages/shared/src/desktopMenu.ts",
    "packages/desktop/src/main/index.ts",
    "packages/desktop/src/main/desktopCommandHandlers.ts",
    "packages/desktop/src/preload/index.ts",
    "packages/desktop/src/renderer/src/desktopPlatform.ts",
    "packages/client/src/globals.d.ts",
    "packages/client/src/remoteServiceAccess.ts",
    "packages/web/src/main.tsx",
    "packages/web/vite.config.ts",
  ]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /ConversationShare|conversationShareService|IConversationShareService/,
      file,
    );
    assert.doesNotMatch(
      text,
      /openFeedback|OpenFeedbackDialog|onShareImport|ShareImport|IFeedbackService|feedbackService/,
      file,
    );
    assert.doesNotMatch(
      text,
      /UpdateReady|UpdateCheckResult|UpdateStateChanged|GetUpdateState|DownloadUpdate|CancelUpdateDownload|OpenUpdateStatusWindow|AutoUpdatePreferences|AutoDownloadAndInstallUpdates|PostUpdateReleaseNotes|SkipUpdateVersion|QuitAndInstallUpdate|updateStatusWindow|forceUpdate|ForceUpdate|initAutoUpdater|electron-updater|VITE_ZAI_OAUTH|ZAI_OAUTH_ORIGIN|ZAI_OAUTH_CLIENT_ID/,
      file,
    );
  }
});

test("[structural, not runtime] WP-07: local log export chain is preserved", () => {
  assert.equal(
    fs.existsSync(path.join(root, "packages/services/src/feedback/feedbackLogArchive.ts")),
    true,
  );
  const nodeExports = fs.readFileSync(path.join(root, "packages/services/src/node.ts"), "utf8");
  assert.match(
    nodeExports,
    /export \{ createFeedbackDiagnosticArchive \} from "\.\/feedback\/feedbackLogArchive\.js";/,
  );
  assert.doesNotMatch(nodeExports, /createFeedbackService|CreateFeedbackServiceOptions/);
  const sharedIndex = fs.readFileSync(path.join(root, "packages/shared/src/index.ts"), "utf8");
  assert.match(sharedIndex, /redactFeedbackText/);
});

test("[structural, not runtime] WP-08: official product endpoints are absent outside the explicit exemption list", () => {
  // V1 官方 relay 为用户显式选择的保留能力；只允许指定文件里的完整字面量。
  // 不按整个文件豁免，账号、OAuth、套餐与其余官方地址继续被同一门禁拦截。
  const officialDomainRe =
    /zcode\.z\.ai|open\.bigmodel\.cn|chat\.z\.ai|api\.z\.ai|cdn-zcode\.z\.ai|bigmodel\.cn|(?:^|[^a-z0-9.-])z\.ai(?:\/|[^a-z0-9.-]|$)|zcode\.ai/;
  const allowedV1Literals = new Map([
    [
      "packages/shared/src/web-remote-relay/contract.ts",
      ['"wss://zcode.z.ai/ws"', '"https://zcode.z.ai/remote/v4"'],
    ],
    // 官方 V1 中继端点常量在 v3.17.1 起拆到独立文件，登记同一组完整字面量（保留口径与 contract.ts 一致）。
    [
      "packages/shared/src/web-remote-relay/v1Endpoint.ts",
      ['"wss://zcode.z.ai/ws"', '"https://zcode.z.ai/remote/v4"'],
    ],
    // 内置插件商店 listing 的作者署名保留域（ZAI_AUTHOR 常量）：登记 name 与 url 完整字面量，
    // 其余官方地址仍被扫描。
    [
      "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
      ['author: { name: "Z.ai"', '"https://z.ai"'],
    ],
    // 官方二维码合同新增了 origin 断言；仅登记这一完整字面量，保留其余地址扫描。
    ["packages/shared/src/web-remote-relay/contract.test.ts", ['"https://zcode.z.ai"']],
    [
      "docs/web-remote-control/v1-connection-modes.md",
      ["`wss://zcode.z.ai/ws`", "`https://zcode.z.ai/remote/v4`"],
    ],
    ["packages/desktop/test/webRemoteControlDirectGateway.test.ts", ['"wss://zcode.z.ai/ws"']],
    [
      "packages/desktop/test/webRemoteControlManagerExternalRelay.test.ts",
      ['"https://zcode.z.ai/remote/v4"'],
    ],
    [
      "packages/desktop/test/e2e/conversation-session/manual-review/pending/web-remote-v1-connections.test.ts",
      ['"https://zcode.z.ai"'],
    ],
    // 官方连接说明改写后，旧整句许可已失效；仅同步这两句，继续检查同文件内的其他地址。
    [
      "packages/ui/src/i18n/locales/en-US.ts",
      [
        '"Uses the ZCode official relay and official V1 page {version}. Both devices must reach zcode.z.ai. Scan to pair without signing in."',
      ],
    ],
    [
      "packages/ui/src/i18n/locales/zh-CN.ts",
      [
        '"通过 ZCode 官方中继连接，使用官方 V1 网页 {version}。手机和电脑都需能访问 zcode.z.ai；扫码配对无需登录。"',
      ],
    ],
  ]);
  const removeAllowedV1Literals = (file, text) =>
    (allowedV1Literals.get(file) ?? []).reduce(
      (remaining, literal) => remaining.replaceAll(literal, ""),
      text,
    );
  const contract = "packages/shared/src/web-remote-relay/contract.ts";
  assert.doesNotMatch(removeAllowedV1Literals(contract, '"wss://zcode.z.ai/ws"'), officialDomainRe);
  for (const address of [
    '"wss://zcode.z.ai/ws/v2"',
    '"https://zcode.z.ai/remote/v4/oauth"',
    '"https://api.z.ai"',
  ]) {
    assert.match(removeAllowedV1Literals(contract, address), officialDomainRe);
  }
  assert.match(removeAllowedV1Literals("unrelated.ts", '"wss://zcode.z.ai/ws"'), officialDomainRe);
  const contractTest = "packages/shared/src/web-remote-relay/contract.test.ts";
  assert.doesNotMatch(
    removeAllowedV1Literals(contractTest, '"https://zcode.z.ai"'),
    officialDomainRe,
  );
  for (const address of ['"https://zcode.z.ai/oauth"', '"https://api.z.ai"']) {
    assert.match(removeAllowedV1Literals(contractTest, address), officialDomainRe);
  }
  assert.match(
    removeAllowedV1Literals("unrelated.test.ts", '"https://zcode.z.ai"'),
    officialDomainRe,
  );
  for (const locale of ["en-US", "zh-CN"]) {
    const file = `packages/ui/src/i18n/locales/${locale}.ts`;
    const [help] = allowedV1Literals.get(file);
    assert.doesNotMatch(removeAllowedV1Literals(file, help), officialDomainRe);
    for (const address of ['"https://zcode.z.ai/oauth"', '"https://api.z.ai"']) {
      assert.match(removeAllowedV1Literals(file, `${help}\n${address}`), officialDomainRe);
    }
    assert.match(removeAllowedV1Literals("unrelated.ts", help), officialDomainRe);
  }
  // 2026-09-27 起与 WP-03 同口径：按 git 追踪清单做全仓文本扫描（新增目录自动入列，
  // 且不混入工作树的 node_modules/dist）；git ls-files 输出本就是 POSIX 路径，原先
  // 为 Windows path.relative 反斜杠做的归一化不再需要。
  const scanExtensions = /\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|sh|ya?ml)$/;
  const violations = [];
  const tracked = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  for (const rel of tracked) {
    if (!scanExtensions.test(rel) || rel === "tests/private-cleanup/cleanup.test.cjs") continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const match = removeAllowedV1Literals(rel, fs.readFileSync(file, "utf8")).match(
      officialDomainRe,
    );
    if (match) violations.push(`${rel}: ${match[0]}`);
  }
  assert.deepEqual(
    violations,
    [],
    `official domains found outside exemptions:\n${violations.join("\n")}`,
  );
});

test("[structural, not runtime] WP-08: builtin release keeps only three standard protocol templates", () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(root, "config/provider/zcode-builtin.json"), "utf8"),
  );
  assert.equal(cfg.revision, 35);
  const pcr = cfg.config.providerConfigRules;
  assert.deepEqual(
    pcr.templateRules.map((t) => t.templateId),
    [
      "standard-anthropic-messages",
      "standard-openai-chat-completions",
      "standard-openai-responses",
    ],
  );
  for (const template of pcr.templateRules) {
    assert.equal(template.config.api.baseUrl, undefined);
    assert.equal(template.config.logo, undefined);
    assert.deepEqual(template.config.builtinModelIds, []);
  }
  // D-2 终裁：off-peak 全下线，不再保留任何账号域 providerRule（zhipu-account 规则集为空）。
  assert.deepEqual(pcr.providerRules, []);
  const mcr = cfg.config.modelConfigRules;
  assert.deepEqual(mcr.builtinProviderModelRules, []);
  assert.deepEqual(mcr.templateModelRules, []);
  assert.deepEqual(mcr.providerSiteRules, []);
  assert.equal(mcr.modelRules.length, 1);
  assert.equal(mcr.modelRules[0].modelMatch, ".*");
  assert.deepEqual(
    mcr.modelApiRules.map((rule) => [rule.modelMatch, rule.apiTypeMatch]),
    [
      [".*", "anthropic-messages"],
      [".*", "openai-chat-completions"],
      [".*", "openai-responses"],
    ],
  );
});

test("[behavior, not runtime] WP-08: endpoint resolver returns undefined without configuration and never invents official origins", async () => {
  const load = createLoader();
  const endpoint = load("packages/shared/src/zcodeEndpoint.ts");
  // 缺配置 = undefined（能力未配置），不 throw、不回退官方默认域。
  assert.equal(endpoint.resolveZCodeEndpointOrigin({}), undefined);
  assert.equal(
    endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: "", overrideOrigin: "" }),
    undefined,
  );
  assert.equal(endpoint.resolveRuntimeZCodeEndpointOrigin({ ZCODE_ENV: "production" }), undefined);
  assert.equal(endpoint.resolveRuntimeZCodeEndpointOrigin({}), undefined);
  // 显式传入合法值仍解析；显式非法值仍 throw（配置错误 ≠ 缺配置）。
  assert.equal(
    endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: "http://intra.example:8443/" }),
    "http://intra.example:8443",
  );
  assert.throws(() => endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: "not a url" }));
  // 键表收缩：产品端点 env 只透传通用键，不再收集官方 provider 键。
  const picked = endpoint.pickProductEndpointEnv({
    ZCODE_BASE_URL: "http://127.0.0.1:9/",
    ZAI_OAUTH_ORIGIN: "https://chat.z.ai",
    BIGMODEL_API_BASE_URL: "https://bigmodel.cn",
  });
  assert.deepEqual(picked, { ZCODE_BASE_URL: "http://127.0.0.1:9/" });
  // CDN 缺配置返回空数组，由远端连接链显式报错。
  const cdnText = fs.readFileSync(
    path.join(root, "packages/desktop/src/main/remoteCdn.ts"),
    "utf8",
  );
  assert.doesNotMatch(cdnText, /DEFAULT_CDN_BASE_URL/);
});

test("[structural, not runtime] WP-08: removed login/startPlan key families stay absent and locales stay aligned", () => {
  // 覆盖率口径：WP-08 只承诺「本包删除文件的直接键不再存在」与「双 locale 键集一致」。
  // 存量历史孤儿键的清理归 D-4 独立决策，这里不设立全局零孤儿断言，避免门禁必红。
  const localeFiles = [
    "packages/ui/src/i18n/locales/zh-CN.ts",
    "packages/ui/src/i18n/locales/en-US.ts",
  ];
  const collectKeys = (file) =>
    [
      ...fs.readFileSync(path.join(root, file), "utf8").matchAll(/^[ \t]*"((?:[^"\\]|\\.)+)":/gm),
    ].map((m) => m[1]);
  const zhKeys = collectKeys(localeFiles[0]);
  const enKeys = collectKeys(localeFiles[1]);
  // 存量 locale 存在历史键集漂移（归 D-4）；WP-08 只承诺被删键族在两个 locale 同步消失。
  const bannedExact = new Set([
    "quickPick.command.login",
    "quickPick.command.logout",
    "welcome.login",
    "welcome.loginFailed",
    "app.login",
    "settings.modelProvider.useSubscription",
  ]);
  const bannedPrefixes = ["login.", "settings.modelProvider.startPlan."];
  for (const keys of [zhKeys, enKeys]) {
    for (const key of keys) {
      assert.equal(bannedExact.has(key), false, key);
      for (const prefix of bannedPrefixes) {
        assert.equal(key.startsWith(prefix), false, `${key} (prefix ${prefix})`);
      }
    }
  }
});

test("[structural, not runtime] WP-08: retained live i18n key families stay defined", () => {
  const zh = fs.readFileSync(path.join(root, "packages/ui/src/i18n/locales/zh-CN.ts"), "utf8");
  // 这些键族在源码仍有静态/动态引用，必须保留，防止后续清理误删活键。
  const mustStay = [
    "settings.modelProvider.connectionMode.codingPlan",
    "settings.modelProvider.connectionMode.startPlan",
    "settings.modelProvider.connectionMode.teamPlan",
    "settings.mcp.oauth.",
    "chat.permission.feedback.",
  ];
  for (const key of mustStay) {
    assert.ok(zh.includes(`"${key}`), key);
  }
});

test("[behavior] WP-09: real protocol schemas reject retired off-peak inputs", async () => {
  // 负面 fixture 集中在清理入口，既保留真实 schema 覆盖，也不向保留模块引入退役领域字面量。
  const protocolUrl = pathToFileURL(
    path.join(root, "packages/shared/src/zcode-protocol/index.ts"),
  ).href;
  await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const { zcodeSessionSendParamsSchema, zcodeProviderRuntimeHeadersRequestParamsSchema } =
      await import(${JSON.stringify(protocolUrl)});
    const send = { sessionId: 'sess_1', content: 'continue' };
    assert.equal(zcodeSessionSendParamsSchema.safeParse(send).success, true);
    for (const attribution of [
      { offPeakTaskId: 'offpeak-1' },
      { offPeakRunType: 'resume' },
      { automationId: 'automation-1', offPeakTaskId: 'offpeak-1' },
    ]) {
      assert.equal(zcodeSessionSendParamsSchema.safeParse({ ...send, ...attribution }).success, false);
    }
    const headers = {
      requestId: 'request-current',
      sessionId: 'sess_1',
      workspace: {
        workspacePath: '/workspace/app',
        workspaceIdentity: 'remote:ssh:dev:/workspace/app',
        workspaceKey: 'remote:ssh:dev:/workspace/app',
      },
      modelSelection: { providerId: 'glm', modelId: 'glm-4.6' },
      providerId: 'account:individual-coding-plan',
      accountAccess: {
        type: 'zhipu-account', accountType: 'bigmodel', mode: 'individual-coding-plan', entitled: true,
      },
      reason: 'model-request',
    };
    assert.equal(zcodeProviderRuntimeHeadersRequestParamsSchema.safeParse(headers).success, true);
    assert.equal(zcodeProviderRuntimeHeadersRequestParamsSchema.safeParse({
      ...headers,
      providerId: 'account:off-peak',
      accountAccess: { ...headers.accountAccess, mode: 'off-peak' },
    }).success, false);
  `,
    ],
    { cwd: root },
  );
});

test("[structural, not runtime] WP-09: empty-model guidance and starter prompts use retained capabilities", () => {
  // 上游推荐目录与通用错误 key 没有退役域标记，旧扫描遗漏了实际可见的套餐和任务引导。
  const prompts = fs.readFileSync(
    path.join(root, "packages/ui/src/v4/featureSuggestedPrompts.ts"),
    "utf8",
  );
  assert.doesNotMatch(prompts, /闲时任务|idle[- ]time task|off[- ]peak/i);
  for (const locale of ["zh-CN", "en-US"]) {
    const source = fs.readFileSync(
      path.join(root, `packages/ui/src/i18n/locales/${locale}.ts`),
      "utf8",
    );
    const guidance = source.match(/"chat\.error\.noAvailableModel":\s*"([^"]+)"/);
    assert.ok(guidance, `${locale}: missing empty-model guidance`);
    assert.doesNotMatch(guidance[1], /套餐|upgrade|coding[- ]plan/i);
  }
});

test("[structural, not runtime] WP-09: off-peak domain fully removed from source and locales", () => {
  const bannedPattern = /off[-_]peak|offpeak/i;
  const allowFiles = new Set([
    // DB DDL 兼容：存量 tasks-index.sqlite 已有 off_peak_tasks 表与投影列，建库语句原样保留。
    "packages/services/src/session/tasksDatabase/schema-v1.ts",
    "packages/services/src/session/tasksDatabase/migrations.ts",
  ]);
  // 2026-09-27 起与 WP-03 同口径：按 git 追踪清单做全仓文本扫描（原先的目录枚举漏掉
  // packages/server、scripts、tests 之外的文档与脚本）。本测试文件自身的注释含
  // off-peak/off_peak 字样（规则说明与豁免理由），必须自排除。
  const scanExtensions = /\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|sh|ya?ml)$/;
  const violations = [];
  const tracked = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  for (const rel of tracked) {
    if (
      !scanExtensions.test(rel) ||
      allowFiles.has(rel) ||
      rel === "tests/private-cleanup/cleanup.test.cjs"
    )
      continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(bannedPattern);
    if (match) violations.push(`${rel}: ${match[0]}`);
  }
  assert.deepEqual(violations, [], `off-peak residue found:\n${violations.join("\n")}`);
});

test("[structural, not runtime] re-clean gate: highspeed card chain / request-security-edition / marketingTouch / rewardsEmbedded / project-access-token stay absent", () => {
  // 本轮新官方域重净：重净清单即门禁，断言先于清理落地——红 = 待净项，清理合入后转绿。
  // highspeed 只封加速卡整链 token：账号/providerId 的 highspeed-card、URL 段 /highspeed/、
  // 裸字符串值 "highspeed"（如 mode 字段）与全大写 HIGHSPEED（env 变量风格）。不封裸后缀：
  // 保留的第三方模型目录（kimi-k2.7-code-highspeed / MiniMax-M2.7-highspeed /
  // GLM-5.1-Highspeed，由 WP-08 的 16 模板门禁与 packages/shared/src/official-glm-model-id.ts
  // 强制保留）以 -highspeed 为模型名后缀，属上游保留域同名词——靠收窄 pattern 规避，
  // 不逐文件登记豁免，避免豁免清单随模型目录膨胀。
  const bannedContent =
    /HIGHSPEED|[hH]ighspeed[-_ ]?[cC]ard|\/highspeed\/|["']highspeed["']|request[-_]security[-_]edition|[rR]equestSecurityEdition|marketing[-_]touch|[mM]arketingTouch|[rR]ewards[-_]embedded|[rR]ewardsEmbedded|project[-_]access[-_]token|[pP]rojectAccessToken/;
  const bannedPath =
    /highspeed[-_ ]?card|request[-_]security[-_]edition|requestsecurityedition|marketing[-_]touch|marketingtouch|rewards[-_]embedded|rewardsembedded|project[-_]access[-_]token|projectaccesstoken/i;
  // vendored 文档豁免为上游证据（保留清单：docs vendored 文档）：docs/ 与 apps/zcode-cli/docs/
  // （上游 CLI 设计文档，如 auth-login.md 对已删 project-access-token 规格的链接）。
  const isVendoredDoc = (rel) => rel.startsWith("docs/") || rel.startsWith("apps/zcode-cli/docs/");
  // 与 WP-03/WP-09 同口径：按 git 追踪清单做全仓扫描。git ls-files 输出本就是 POSIX 路径，
  // 豁免与前缀判断必须用原始 rel，不做 path.sep 归一——Windows 下 path.join 产物是反斜杠，
  // 拿归一化结果比对豁免/目录前缀会全部失配（既有门禁注释记录过的坑）。
  const scanExtensions = /\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|sh|ya?ml)$/;
  const violations = [];
  const tracked = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  for (const rel of tracked) {
    if (rel === "tests/private-cleanup/cleanup.test.cjs") continue; // 本文件的 pattern 与注释自含禁词
    if (isVendoredDoc(rel)) continue;
    if (bannedPath.test(rel)) {
      violations.push(`path ${rel}`);
      continue;
    }
    if (!scanExtensions.test(rel)) continue;
    const file = path.join(root, rel);
    // 工作区里已删除但未提交的追踪文件：门禁跟着提交内容走，本地未提交的删除不该让读崩。
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(bannedContent);
    if (match) violations.push(`${rel}: ${match[0]}`);
  }
  assert.deepEqual(violations, [], `new official domain residue found:\n${violations.join("\n")}`);
});

test("[structural, not runtime] WP-03: user-level data root references stay under .openzwork", () => {
  // WP-03 A 类硬门槛：用户级 .zcode 引用清零。2026-09-26 复审补清远端启动链、发行安装、
  // 全局 workflows 根等代码残留；2026-09-27 PR 评审指出按目录枚举的扫描根永远追不上
  // 新增目录（当时漏了 packages/server、scripts 与 README/NOTICE/SKILL 等 Markdown，
  // 六处过时引用由此漏网），改为按 git 追踪清单做全仓文本扫描：新增包、.github、文档
  // 自动入列，且与 CI 新检出看到的是同一份"全仓"（工作树的 node_modules/dist/未纳管
  // 私目录不会混入）。模式只匹配用户级旧根字面量：~/、$HOME/ 前缀，项目级 <cwd>/.zcode
  // 属用户仓库工作区天然不命中；(?![\w-]) 排除恰好以 .zcode 开头的其他目录名
  // （如开发沙箱 .zcode-dev-home）。豁免登记见 docs/spec/identity-and-data-isolation.md。
  const bannedPattern = /(?:~|\$HOME)\/\.zcode(?![\w-])/;
  const allowFiles = new Set([
    // WP-E1a 记忆迁移链：唯一获批的旧根单向读取点——代码、用户文案与文案的测试夹具。
    "packages/shared/src/node/memoryMigration.ts",
    "packages/ui/src/settings/memoryMigrationHint.ts",
    "packages/ui/src/i18n/locales/zh-CN.ts",
    "packages/ui/src/i18n/locales/en-US.ts",
    "packages/services/test/memory-migration.test.ts",
    // 政策文本以旧根定义隔离边界；installer 注释引用被替换的旧默认值作为修复依据。
    "docs/spec/identity-and-data-isolation.md",
    "docs/spec/memory-migration.md",
    "scripts/zcode-distribution/installer.mjs",
  ]);
  const scanExtensions = /\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|sh|ya?ml)$/;
  const tracked = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const violations = [];
  for (const rel of tracked) {
    if (!scanExtensions.test(rel) || allowFiles.has(rel)) continue;
    const file = path.join(root, rel);
    // 工作区里已删除但未提交的追踪文件：门禁跟着提交内容走，本地未提交的删除不该让读崩。
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(bannedPattern);
    if (match) violations.push(`${rel}: ${match[0]}`);
  }
  assert.deepEqual(violations, [], `user-level .zcode residue found:\n${violations.join("\n")}`);
});

test("[structural, not runtime] WP-03: remote deploy/startup and distribution defaults share the .openzwork root", () => {
  // 远端链：部署（deploy.ts 经 REMOTE_BASE 上传）与启动（connect.ts 拼 shell 命令）必须同源，
  // 否则首连必失败且复用官方命名空间。双引号 env 串里 ~ 不展开，用 $HOME 展开形。
  const deployShared = fs.readFileSync(
    path.join(root, "packages/server/src/remote/deployShared.ts"),
    "utf8",
  );
  assert.match(deployShared, /export const REMOTE_BASE = "~\/\.openzwork\/server"/);
  assert.match(deployShared, /REMOTE_BASE_HOME_EXPR = `\$HOME\$\{REMOTE_BASE\.slice\(1\)\}`/);
  for (const file of [
    "packages/server/src/remote/connect.ts",
    "packages/server/src/remote/zcodeAgentBundleWrapper.ts",
  ]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /~\/\.zcode|\$HOME\/\.zcode/);
    assert.match(text, /REMOTE_BASE/);
  }
  // 发行安装脚本默认目录落 OpenZWork 命名空间。
  const installer = fs.readFileSync(
    path.join(root, "scripts/zcode-distribution/installer.mjs"),
    "utf8",
  );
  assert.match(installer, /ZCODE_DIST_HOME:-\$HOME\/\.openzwork\/runtime/);
  // 全局 saved workflows 根派生自产品身份常量，不得退回官方字面量。
  const savedWorkflow = fs.readFileSync(
    path.join(root, "apps/zcode-cli/packages/contracts/src/tools/saved-workflow.ts"),
    "utf8",
  );
  assert.doesNotMatch(savedWorkflow, /SAVED_WORKFLOW_GLOBAL_DIR = "\.zcode\/workflows"/);
  assert.match(
    savedWorkflow,
    /SAVED_WORKFLOW_GLOBAL_DIR = `\$\{OPENZWORK_DATA_DIR_NAME\}\/workflows`/,
  );
  // 内置技能的全局目录说明必须与 SAVED_WORKFLOW_GLOBAL_DIR 同源（不出现旧路径由上方全仓扫描守护）。
  const skillDoc = fs.readFileSync(
    path.join(root, "apps/zcode-cli/packages/bundled-skills/skills/dynamic-workflows/SKILL.md"),
    "utf8",
  );
  assert.match(skillDoc, /~\/\.openzwork\/workflows/);
  // 上游账号域孤儿（WP-04 删除链幸存、零消费者）已物理删除。
  assert.equal(
    fs.existsSync(path.join(root, "packages/shared/src/account-provider-state.ts")),
    false,
  );
});

test("[structural] v3.15.1 sync: GenUI/MCP Apps host services stay registered", () => {
  // 修复原因：上游合并曾丢失 createLocalServices 的四个服务注册，RemoteServiceAccess 的
  // 代理频道 1s 超时失败并拖慢消息发送。结构断言防止下次同步再丢。
  const node = fs.readFileSync(path.join(root, "packages/services/src/node.ts"), "utf8");
  assert.match(node, /\.register\(\s*IGenUiService/);
  assert.match(node, /\.register\(\s*IPluginUiBridgeService/);
  assert.match(node, /\.register\(\s*IPluginUiSamplingService/);
  assert.match(node, /\.register\(\s*IPluginUiAppToolsService/);
});

test("[structural] v3.15.1 sync: workflow child runtime mirrors interaction events to parent", () => {
  // 修复原因：上游 v3.15.1 给 notifyExternalChildSessionEvent 加了 interactionOrigin，
  // 合并时丢失会让工作流子代理的提问/确认窗永不出现在父会话、任务无限等待。
  const child = fs.readFileSync(
    path.join(root, "apps/zcode-cli/packages/bootstrap/src/app/script-workflow-child-runtime.ts"),
    "utf8",
  );
  assert.match(
    child,
    /notifyExternalChildSessionEvent\(\{[\s\S]*?interactionOrigin: clientPortsContext/,
  );
});

test("[structural] MCP directory IO has one owner and keeps user/project boundaries separate", () => {
  // 原断言把用户根隔离扩大到项目，导致 Desktop 与 CLI 路径分叉。
  // Desktop 只转发到共同 owner；具体旧项目读写由真实文件回归覆盖。
  const index = fs.readFileSync(
    path.join(root, "packages/desktop/src/main/mcpUserDirectory/index.ts"),
    "utf8",
  );
  assert.match(index, /createMcpSyncService/);
  assert.match(index, /directoryService\.saveMcpToUserDirectory\(payload\)/);
  assert.doesNotMatch(index, /workspaceConfigDirSegments/);
  const owner = fs.readFileSync(
    path.join(root, "packages/services/src/mcp-sync/mcpSyncService.ts"),
    "utf8",
  );
  assert.match(owner, /userConfigDirSegments: \[OPENZWORK_DATA_DIR_NAME, "cli"\]/);
  assert.match(owner, /workspaceConfigDirSegments: \["\.zcode"\]/);
  assert.match(owner, /workspaceConfigDirSegments: \[OPENZWORK_DATA_DIR_NAME\]/);
});
