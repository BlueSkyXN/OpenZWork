/* oxlint-disable eslint(max-lines) -- 各清理工作包的门禁断言聚合在同一文件，CI 以 node --test 单文件入口运行，不拆分。 */
/* Tests added for the private-fork cleanup. No application dependencies are faked in production.
 * These focused tests transpile real source with TypeScript. Only unavailable SDK factories,
 * ProxyAgent construction and the provider-runtime's file-port collaborators use test doubles.
 * No live model, Electron, persistent-session, or proxy-server integration is claimed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.ZCODE_TEST_SOURCE_ROOT || path.resolve(__dirname, '../..');
const ts = require(process.env.TYPESCRIPT_MODULE_PATH || 'typescript');
const adapter = 'apps/zcode-cli/packages/adapters/src/model/';
const sdkCalls = [];
function sdkFactory(kind) {
  return options => {
    sdkCalls.push({ kind, options });
    const model = id => ({ id, kind, options });
    model.responses = model;
    return model;
  };
}
function createLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      reportDiagnostics: true,
    });
    assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} }; cache.set(filename, module);
    function sourceRequire(id) {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.startsWith('node:')) return require(id);
      if (id === '@zcode/shared') return load('packages/shared/src/runtimeEnv.ts');
      if (id === '@zcode/model-option-map') return load('packages/model-option-map/src/index.ts');
      if (id === '@ai-sdk/anthropic') return { createAnthropic: sdkFactory('anthropic') };
      if (id === '@ai-sdk/openai') return { createOpenAI: sdkFactory('responses') };
      if (id === '@ai-sdk/openai-compatible') return { createOpenAICompatible: sdkFactory('chat') };
      if (id === 'proxy-agent') return { ProxyAgent: class { constructor() { throw new Error('Real proxy-server integration is outside this test.'); } } };
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), id.replace(/\.js$/, '.ts'))));
      throw new Error(`Unprovided dependency in focused source test: ${id}`);
    }
    new Function('require', 'module', 'exports', output.outputText)(sourceRequire, module, module.exports);
    return module.exports;
  }
  return load;
}
const load = createLoader();
const { AiSdkModelExecution, createProviderBusinessErrorFetch } = load(adapter + 'model-execution.ts');
const { createRuntimeAiSdkModelExecutionConfig } = load('apps/zcode-cli/packages/bootstrap/src/model-config.ts');
const { resolveProxyForRequest } = load('apps/zcode-cli/packages/adapters/src/network/http-config.ts');
const specs = { reasoningLevel: { map: '{"reasoning_effort": reasoningLevel}' }, maxOutputTokens: { map: '{"max_tokens": maxOutputTokens}' } };
function provider(apiType = 'openai-chat-completions', baseUrl = 'http://127.0.0.1:12345/v1', headers) {
  return { access: { type: 'api-key', apiKey: 'test-only-key' }, api: { type: apiType, baseUrl, headers } };
}
function bind(execution, config) {
  return execution.bindModel({ providerId: 'personal:test', modelId: 'test-model', providerConfig: config, supportsJsonSchemaOutput: true, optionSpecs: specs });
}
function okJson() { return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }

test('[behavior] CLI execution config injects no product/device headers even with legacy variables', () => {
  const env = { ZCODE_BASE_URL: 'https://zcode.z.ai', ZCODE_DEVICE_MID: 'test-device', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9' };
  const config = createRuntimeAiSdkModelExecutionConfig(env);
  assert.deepEqual(Object.keys(config), ['env']); assert.equal(config.env, env);
});
test('[behavior] explicit proxy, CA and noProxy settings are preserved', () => {
  const network = { httpProxy: 'http://127.0.0.1:8123', noProxy: 'localhost,.internal', caCertFile: '/tmp/test-ca.pem' };
  assert.deepEqual(createRuntimeAiSdkModelExecutionConfig({}, { network }).network, network);
  assert.equal(resolveProxyForRequest('https://example.org/', { httpProxy: network.httpProxy }).proxyUrl, 'http://127.0.0.1:8123/');
  assert.equal(resolveProxyForRequest('https://model.internal/', network).noProxyMatched, true);
});
for (const [label, url] of [
  ['BigModel former rewritten endpoint', 'https://open.bigmodel.cn/api/anthropic/v1/messages'],
  ['Z.ai former rewritten endpoint', 'https://api.z.ai/api/anthropic/v1/messages'],
  ['private endpoint', 'http://127.0.0.1:12345/v1/chat/completions'],
]) {
  test(`[behavior] ${label} reaches injected transport unchanged`, async () => {
    let actual;
    const config = provider('anthropic-messages', url.replace(/\/messages$/, ''));
    const execution = new AiSdkModelExecution({ env: { ZCODE_BASE_URL: 'https://product.invalid' } }, { transport: async (input, init) => { actual = { input: String(input), init }; return okJson(); } });
    const binding = bind(execution, config);
    const headers = { Authorization: 'Bearer explicit-test', 'X-Custom': 'keep' };
    const body = '{"messages":[{"role":"user","content":"test"}]}';
    const signal = new AbortController().signal;
    await binding.resolved.model.options.fetch(url, { method: 'POST', headers, body, signal });
    assert.equal(actual.input, url); assert.equal(actual.init.body, body); assert.equal(actual.init.signal, signal);
    assert.equal(new Headers(actual.init.headers).get('Authorization'), headers.Authorization);
  });
}
for (const [apiType, kind] of [['anthropic-messages', 'anthropic'], ['openai-responses', 'responses'], ['openai-chat-completions', 'chat']]) {
  test(`[behavior] ${apiType} selects the existing SDK protocol factory`, () => {
    const b = bind(new AiSdkModelExecution({ env: {} }, { transport: async () => okJson() }), provider(apiType));
    assert.equal(b.resolved.model.kind, kind); assert.equal(b.resolved.model.id, 'test-model');
  });
}
test('[behavior] no default OpenRouter or ZCode attribution headers', () => {
  const b = bind(new AiSdkModelExecution({ env: {} }), provider('openai-chat-completions', 'https://openrouter.ai/api/v1'));
  assert.deepEqual(b.resolved.headers, {}); assert.deepEqual(b.resolved.model.options.headers, {});
});
test('[behavior] explicit caller and user headers keep case-insensitive precedence', () => {
  const b = bind(new AiSdkModelExecution({ env: {}, defaultHeaders: { 'X-Custom': 'old', 'X-Caller': 'yes' } }), provider(undefined, undefined, { 'x-custom': 'new' }));
  assert.deepEqual(b.resolved.headers, { 'X-Caller': 'yes', 'x-custom': 'new' });
});
test('[behavior] frozen endpoint binding survives external config mutation and request credentials can rotate', () => {
  const cfg = provider(); const b = bind(new AiSdkModelExecution({ env: {} }), cfg);
  cfg.api.baseUrl = 'https://unexpected.invalid/v1';
  const r = b.resolveRequest({ options: { reasoningLevel: 'high', maxOutputTokens: 512 }, requestAuth: { apiKey: 'rotated-test', headers: { 'X-Request': 'keep' } } });
  assert.equal(r.model.options.baseURL, 'http://127.0.0.1:12345/v1'); assert.equal(r.model.options.apiKey, 'rotated-test');
  assert.equal(r.model.options.headers['X-Request'], 'keep');
});
test('[behavior] actual model-option mapping still sets reasoning and output-token fields', async () => {
  let requestBody;
  const execution = new AiSdkModelExecution({ env: {} }, { transport: async (_, init) => { requestBody = JSON.parse(init.body); return okJson(); } });
  const b = bind(execution, provider());
  const r = b.resolveRequest({ options: { reasoningLevel: 'high', maxOutputTokens: 512 } });
  await r.model.options.fetch('http://127.0.0.1:12345/v1/chat/completions', { method: 'POST', body: '{"model":"test-model","messages":[]}' });
  assert.equal(requestBody.reasoning_effort, 'high'); assert.equal(requestBody.max_tokens, 512); assert.equal(requestBody.model, 'test-model');
});
test('[behavior] transport AbortError is not swallowed by cleanup', async () => {
  const abort = new DOMException('cancelled', 'AbortError');
  const f = createProviderBusinessErrorFetch({ env: {}, providerId: 'personal:test', providerKind: 'openai-compatible', fetch: async () => { throw abort; } });
  await assert.rejects(() => f('http://127.0.0.1:12345/'), error => error === abort);
});
test('[behavior] TLS failure classification remains operational', async () => {
  const f = createProviderBusinessErrorFetch({ env: {}, providerId: 'personal:test', providerKind: 'openai-compatible', fetch: async () => { throw Object.assign(new Error('bad cert'), { code: 'CERT_HAS_EXPIRED' }); } });
  await assert.rejects(() => f('http://127.0.0.1:12345/'), error => error.code === 'MODEL_TLS_VALIDATION_FAILED');
});
test('[behavior] stream contents are preserved without product routing', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
  const f = createProviderBusinessErrorFetch({ env: {}, providerId: 'personal:test', providerKind: 'openai-compatible', fetch: async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }) });
  assert.equal(await (await f('http://127.0.0.1:12345/')).text(), sse);
});

function providerRuntimeFixture(failFirst = false) {
  const state = { reads: 0, closes: [], builtin: null, personal: null };
  class Builtin { constructor(options) { this.activeFilePath = options.activeFilePath || options.bundledFilePath; state.builtin = options; } read() { return Promise.resolve({ revision: 'local-test' }); } dispose() { state.closes.push('builtin'); } }
  class Personal { constructor(options) { state.personal = options; } dispose() { state.closes.push('personal'); } }
  class Config { constructor(options) { this.options = options; } read() { state.reads++; return failFirst && state.reads === 1 ? Promise.reject(new Error('read failed')) : Promise.resolve({ revision: 'local-test' }); } dispose() { state.closes.push('config'); } }
  const source = createLoader({ '@zcode/provider': { ProviderConfigService: Config }, './zcode-builtin-provider-config-source.js': { NodeZCodeBuiltinProviderConfigSource: Builtin }, './personal-provider-config-repository.js': { NodePersonalProviderConfigRepository: Personal } });
  return { state, Runtime: source('packages/provider-node/src/provider-config-runtime.ts').NodeProviderConfigRuntime };
}
test('[behavior / file-port doubles] config runtime shares initialization and disposes actual owners once', async () => {
  const { state, Runtime } = providerRuntimeFixture();
  const runtime = new Runtime({ zcodeBuiltinFilePath: '/tmp/builtin.json', personalFilePath: '/tmp/personal.json', watch: false, personalPollingIntervalMs: false });
  assert.equal(runtime.start(), runtime.start()); await runtime.start(); assert.equal(state.reads, 1);
  assert.equal(await runtime.resolveZCodeBuiltinActiveFilePath(), '/tmp/builtin.json');
  assert.equal(state.builtin.watch, false); assert.equal(state.personal.pollingIntervalMs, false);
  runtime.dispose(); runtime.dispose(); assert.deepEqual(state.closes, ['config', 'personal', 'builtin']);
  assert.throws(() => runtime.start(), /dispose/);
});
test('[behavior / file-port doubles] local config read failure is retryable, not marked successful', async () => {
  const { state, Runtime } = providerRuntimeFixture(true);
  const runtime = new Runtime({ zcodeBuiltinFilePath: '/tmp/builtin.json', personalFilePath: '/tmp/personal.json' });
  await assert.rejects(runtime.start(), /read failed/); await runtime.start(); assert.equal(state.reads, 2); runtime.dispose();
});
test('[behavior / file-port doubles] removed remote-refresh options cannot invoke a downloader', async () => {
  const { Runtime } = providerRuntimeFixture(); let remoteCalls = 0;
  const runtime = new Runtime({ zcodeBuiltinFilePath: '/tmp/builtin.json', personalFilePath: '/tmp/personal.json', zcodeBuiltinEnvironment: { fetchRelease: () => { remoteCalls++; throw new Error('must not be called'); } } });
  await runtime.start(); assert.equal(remoteCalls, 0); assert.equal('refreshZCodeBuiltin' in runtime, false); assert.equal('onDidCheckZCodeBuiltin' in runtime, false); runtime.dispose();
});

test('[structural, not runtime] removed gateways and exporters are physically absent', () => {
  for (const file of [adapter + 'official-coding-plan-gateway.ts', 'packages/shared/src/openrouter-attribution.ts', 'apps/zcode-cli/packages/telemetry', 'apps/zcode-cli/packages/core/src/telemetry/runtime-telemetry.ts', 'packages/provider-node/src/zcode-builtin-download.ts', 'packages/provider-node/src/endpoint-scoped-zcode-builtin-source.ts', 'packages/desktop/src/main/localTtftExporter.ts', 'packages/desktop/src/main/rendererActionTraceExporter.ts']) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});
test('[structural, not runtime] WP-05 telemetry full-chain sources are physically absent', () => {
  const removed = [
    'packages/desktop/src/main/appARMSBootstrap.ts',
    'packages/desktop/src/main/appTelemetryRuntime.ts',
    'packages/desktop/src/shared/armsRumShared.ts',
    'packages/desktop/src/shared/armsRumBridgeForward.ts',
    'packages/desktop/src/main/armsEventRedaction.ts',
    'packages/desktop/src/main/armsUserIdentity.ts',
    'packages/desktop/src/main/armsBrowserPerfLoadNudge.ts',
    'packages/desktop/src/main/desktopArmsCustomEvent.ts',
    'packages/desktop/src/main/desktopStabilityTelemetry.ts',
    'packages/desktop/src/main/desktopMcpTelemetry.ts',
    'packages/desktop/src/main/desktopRemoteUsageArmsTelemetry.ts',
    'packages/desktop/src/main/desktopNetworkTelemetry.ts',
    'packages/desktop/src/main/networkTelemetryAggregator.ts',
    'packages/desktop/src/main/databaseStartupTelemetry.ts',
    'packages/desktop/src/main/startupTelemetryDelivery.ts',
    'packages/desktop/src/main/longTaskAttributionSummary.ts',
    'packages/desktop/src/main/desktopTelemetryFetch.ts',
    'packages/desktop/src/main/desktopResourceTelemetry.ts',
    'packages/desktop/src/main/desktopZCodeDataSizeTelemetry.ts',
    'packages/desktop/src/main/zcodeDataSizeTelemetryState.ts',
    'packages/desktop/src/main/processResourceRoleClassifier.ts',
    'packages/desktop/src/main/resourceMetricsStats.ts',
    'packages/desktop/src/scheduler/schedulerResourceTelemetry.ts',
    'packages/desktop/src/host/hostNetworkTelemetry.ts',
    'packages/desktop/src/host/hostSessionCreateTelemetry.ts',
    'packages/desktop/src/host/hostServiceResourceTelemetry.ts',
    'packages/desktop/src/host/hostSelfResourceTelemetry.ts',
    'packages/desktop/src/host/hostMcpTelemetry.ts',
    'packages/desktop/src/host/hostResourceTelemetryEnvironment.ts',
    'packages/services/src/telemetry/telemetryCore.ts',
    'packages/services/src/oauth/repo/oauthCredentialRepo.ts',
    'packages/shared/src/telemetry.ts',
    'packages/shared/src/remoteUsageTelemetry.ts',
    'packages/shared/src/sessionCreateTelemetry.ts',
    'packages/shared/src/rendererActionTrace.ts',
    'packages/shared/src/processResourceTelemetry.ts',
    'packages/shared/src/telemetryRedaction.ts',
    'packages/ui/src/lib/appTelemetry.ts',
    'packages/ui/src/lib/sessionCreateTelemetry.ts',
    'packages/ui/src/lib/uiPerfArmsTelemetry.ts',
    'packages/ui/src/lib/sessionOpenArmsTelemetry.ts',
    'packages/ui/src/lib/userActionTelemetry.ts',
    'packages/ui/src/lib/userActionTraceCatalog.ts',
    'packages/ui/src/v4/telemetry/conversationTelemetrySupervisor.ts',
    'packages/ui/src/v4/telemetry/ConversationTelemetryAttachment.tsx',
    'packages/ui/src/v4/telemetry/localTtftObserver.ts',
    'packages/ui/src/onboarding/useOnboardingTelemetry.ts',
    'packages/desktop/src/renderer/appTelemetryBridge.ts',
  ];
  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});
test('[structural, not runtime] Desktop OTLP initialization and IPC bridge methods are removed', () => {
  for (const file of ['packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/desktop/src/renderer/src/desktopPlatform.ts', 'packages/shared/src/platform.ts']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /createLocalTtftExporter|createRendererActionTraceExporter|reportLocalTtftBatch|reportRendererActionTraceBatch|getRendererActionTraceConfig/);
  }
});
test('[structural, not runtime] build configs no longer validate or inject telemetry runtime modules', () => {
  const bundle = fs.readFileSync(path.join(root, 'packages/desktop/scripts/bundle.mjs'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'packages/desktop/electron-builder.config.js'), 'utf8');
  assert.doesNotMatch(bundle, /@opentelemetry|@arms\/|@babel\/runtime/);
  assert.doesNotMatch(builder, /@opentelemetry|@arms\/|@babel\/runtime/);
});
test('[structural, not runtime] shared telemetry env constants and channels are removed', () => {
  const env = fs.readFileSync(path.join(root, 'packages/shared/src/env.ts'), 'utf8');
  assert.doesNotMatch(env, /ZCODE_TELEMETRY_ENABLED|ZCODE_TELEMETRY_REPORT_ENDPOINT|ZCODE_ARMS_RUM_ENDPOINT|ArmsRumEnv/);
  const channels = fs.readFileSync(path.join(root, 'packages/shared/src/channels.ts'), 'utf8');
  assert.doesNotMatch(channels, /SyncTelemetryContext|ReportTelemetryEvent|ReportArmsCustomEvent|ReportRendererHeapSample|FinalArmsCustomEventsE2E/);
});
test('[structural, not runtime] Agent and Desktop direct exporter dependencies are removed', () => {
  const bootstrap = JSON.parse(fs.readFileSync(path.join(root, 'apps/zcode-cli/packages/bootstrap/package.json')));
  assert.equal(bootstrap.dependencies['@zcode/telemetry'], undefined);
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'packages/desktop/package.json')));
  assert.equal(Object.keys(desktop.dependencies).filter(x => x.startsWith('@opentelemetry/')).length, 0);
});
test('[structural, not runtime] tool executor uses its business implementation, not a telemetry wrapper', () => {
  const text = fs.readFileSync(path.join(root, 'apps/zcode-cli/packages/core/src/tool/executor/call-runner.ts'), 'utf8');
  assert.doesNotMatch(text, /runToolCallWithTelemetry/); assert.match(text, /executeToolCallImpl/);
});
test('[structural, not runtime] bootstrap no longer treats ordinary Agent directory as a submodule', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'scripts/bootstrap.mjs'), 'utf8'), /git submodule|runGit\(|["']submodule["']/);
});
test('[structural, not runtime] WP-06: official MCP residue is removed from agent packages', () => {
  for (const file of [
    'apps/zcode-cli/packages/adapters/src/mcp/index.ts',
    'apps/zcode-cli/packages/adapters/src/plugins/mcp.ts',
    'apps/zcode-cli/packages/contracts/src/interfaces/mcp.port.ts',
    'apps/zcode-cli/packages/core/src/tool/types.ts',
    'packages/shared/src/index.ts',
    'packages/shared/src/channels.ts',
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    // zcode_official 只允许作为旧缓存配置的显式拒绝文案存在（plugins/mcp.ts 的退役 throw）。
    assert.doesNotMatch(text, /officialMcp|OfficialMcp|official_mcp|OFFICIAL_MCP/);
  }
  for (const removed of [
    'packages/shared/src/official-mcp-auth.ts',
    'packages/shared/src/official-mcp-tool-error.ts',
    'packages/shared/src/clientConfig.ts',
    'packages/shared/src/cuaAccessibilitySettings.ts',
    'packages/zcode-cua',
    'apps/zcode-cli/packages/adapters/src/mcp/official-auth.ts',
    'apps/zcode-cli/packages/adapters/src/plugins/mcp-official-auth.ts',
    'apps/zcode-cli/packages/services/client-config',
    'apps/zcode-cli/packages/services/client-scenes',
    'apps/zcode-cli/packages/services/cua-permission-broker',
    'apps/zcode-cli/packages/core/src/runtime/helpers/official-cua-media.ts',
    'apps/zcode-cli/packages/core/src/subagent/computer-use-policy.ts',
    'apps/zcode-cli/packages/node-repl-host/src/cua-bridge.ts',
    'apps/zcode-cli/packages/node-repl-host/src/cua-broker.ts',
    'apps/zcode-cli/packages/bootstrap/src/zcode-protocol/computer-use-operation-event.ts',
    'apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/cua-app-snapshot.ts',
    'apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/cua-permission-observation.ts',
    'apps/zcode-cli/packages/bootstrap/src/app/superpowers-plugin',
    'packages/services/src/cua-permission-broker',
    'packages/services/src/client-config',
    'packages/services/src/client-scenes',
    'packages/ui/src/settings/ComputerUseSection.tsx',
    'packages/desktop/src/main/desktopCuaPermissionIpc.ts',
    'packages/desktop/src/main/cuaPermissionDragPanel.ts',
    'packages/desktop/src/main/windowsCuaOperationIndicator.ts',
    'packages/desktop/src/preload/cuaPermissionPanel.ts',
    'packages/desktop/src/renderer/cuaPermissionPanel.tsx',
  ]) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, removed);
  }
});
test('[structural, not runtime] WP-06: CUA / clientScenes / plugin-creator surfaces are gone', () => {
  const surfaces = [
    'packages/shared/src/runtimeEnv.ts',
    'packages/shared/src/platform.ts',
    'packages/shared/src/zcode-protocol/index.ts',
    'packages/shared/src/zcode-protocol-v4/rows.ts',
    'packages/services/src/node.ts',
    'packages/services/src/zcode-agent/zcodeAgentService.ts',
    'packages/desktop/src/main/index.ts',
    'packages/desktop/src/preload/index.ts',
    'packages/desktop/src/renderer/src/desktopPlatform.ts',
    'packages/ui/src/v4/ConversationDraftSuggestedPromptsContainer.tsx',
    'packages/ui/src/settings/settingsPageConfig.ts',
    'packages/ui/src/i18n/locales/zh-CN.ts',
    'packages/ui/src/i18n/locales/en-US.ts',
    'packages/client/src/globals.d.ts',
    'apps/zcode-cli/packages/bootstrap/src/app/runtime-config.ts',
    'apps/zcode-cli/packages/bootstrap/src/mcp-config.ts',
    'apps/zcode-cli/packages/core/src/mcp/index.ts',
    'apps/zcode-cli/packages/core/src/runtime/types.ts',
    'apps/zcode-cli/packages/node-repl-host/src/server.ts',
    'apps/zcode-cli/packages/cli/src/plugin-host-command.ts',
  ];
  for (const file of surfaces) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /cuaPermission|CuaPermission|cuaAccessibility|CuaOsSupport|computerUse|ComputerUse|clientScenes|ClientScenes|pluginCreator|trustedOfficialCua|syncActiveTaskSession|ZCODE_CUA_/, file);
  }
});

test('[structural, not runtime] WP-07: conversation-share / cloud feedback / app-update sources are physically absent', () => {
  const dm = 'packages/desktop/src/main/', sh = 'packages/shared/src/', ui = 'packages/ui/src/';
  const v4 = ui + 'v4/', fb = 'packages/services/src/feedback/', web = 'packages/web/src/';
  // 应用更新与强更门禁 / conversationShare 全链 / 云端反馈工单与 UI / web 分享页登录
  const removed = [
    dm + 'autoUpdater.ts', dm + 'forceUpdateGuard.ts', dm + 'forceUpdatePrompt.ts',
    dm + 'manifestUpdateProvider.ts', dm + 'windowsInstallResourceLocks.ts',
    sh + 'update.ts', sh + 'forceUpdate.ts', sh + 'conversation-share.ts', sh + 'feedback.ts',
    ui + 'UpdateStatusButton.tsx', ui + 'UpdateStatusDialog.tsx', ui + 'UpdateStatusDialogController.tsx',
    ui + 'UpdateStatusWindowRoot.tsx', ui + 'updateStatusModel.ts', ui + 'updateStatusButtonLayout.ts',
    ui + 'UpdateReleaseNotesTooltip.tsx', ui + 'updateReleaseNotes.ts',
    ui + 'hooks/useDesktopUpdateMenu.ts', ui + 'lib/desktopUpdateMenu.ts',
    'packages/services/src/conversation-share', 'packages/desktop/src/host/conversationShareAttachmentService.ts',
    ui + 'ConversationShareMenu.tsx', ui + 'ConversationSharePermissionPicker.tsx',
    ui + 'store/conversationShareSelectionStore.ts', ui + 'lib/conversationShareContext.ts',
    ui + 'lib/conversationShareError.ts', ui + 'root/shareImportIntent.ts',
    v4 + 'ConversationShareConfirmationDock.tsx', v4 + 'ConversationShareSuccessDock.tsx',
    v4 + 'ConversationShareSelectionDock.tsx', v4 + 'ConversationShareSelectionPanel.tsx',
    v4 + 'ConversationShareSelectionReopenTab.tsx', v4 + 'ConversationShareSelectionScrim.tsx',
    v4 + 'ConversationShareImportNotice.tsx', v4 + 'ConversationShareReadonlyTimeline.tsx',
    v4 + 'conversationShareAttempt.ts', v4 + 'conversationShareMarkdown.ts',
    v4 + 'conversationShareModeMotion.ts', v4 + 'conversationShareModePolicy.ts',
    v4 + 'conversationSharePreflightCache.ts', v4 + 'conversationShareScrollbarMetrics.ts',
    v4 + 'conversationShareSelectionPanelLayout.ts', v4 + 'useConversationShareSelectionOutsideDismiss.ts',
    web + 'share',
    // 云端反馈工单与 UI（保留本地日志导出 feedbackLogArchive）
    fb + 'feedbackHttpClient.ts', fb + 'feedbackService.ts', fb + 'feedback.ts',
    fb + 'feedbackLocalTicketStore.ts', fb + 'compactLogArchive.ts',
    ui + 'feedback', ui + 'lib/errorFeedbackDraft.ts', ui + 'lib/taskFeedbackDraft.ts',
    web + 'auth', // OAuthCredentialRepo 最后残留
  ];
  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});

test('[structural, not runtime] WP-07: updater dependencies and share/feedback/update channel surface are gone', () => {
  // 依赖声明暂留（lockfile 未同步，归 WP-09 终审删除）；此处断言更强的行为事实：
  // desktop 源码不再 import 更新链三包，声明本身不产生任何可执行路径。
  const depImported = dep => {
    const re = new RegExp(`['"]${dep}(/[^'"]*)?['"]`);
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).some(e =>
      e.isDirectory() ? walk(path.join(d, e.name))
        : /\.[cm]?[jt]sx?$/.test(e.name) && re.test(fs.readFileSync(path.join(d, e.name), 'utf8')));
    return walk(path.join(root, 'packages/desktop/src'));
  };
  for (const dep of ['electron-updater', 'semver', 'yaml']) {
    assert.equal(depImported(dep), false, dep);
  }
  for (const file of [
    'packages/shared/src/channels.ts', 'packages/shared/src/platform.ts', 'packages/shared/src/index.ts',
    'packages/shared/src/protocol.ts', 'packages/shared/src/desktopMenu.ts',
    'packages/desktop/src/main/index.ts', 'packages/desktop/src/main/desktopCommandHandlers.ts',
    'packages/desktop/src/preload/index.ts', 'packages/desktop/src/renderer/src/desktopPlatform.ts',
    'packages/client/src/globals.d.ts', 'packages/client/src/remoteServiceAccess.ts',
    'packages/web/src/main.tsx', 'packages/web/vite.config.ts',
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /ConversationShare|conversationShareService|IConversationShareService/, file);
    assert.doesNotMatch(text, /openFeedback|OpenFeedbackDialog|onShareImport|ShareImport|IFeedbackService|feedbackService/, file);
    assert.doesNotMatch(text, /UpdateReady|UpdateCheckResult|UpdateStateChanged|GetUpdateState|DownloadUpdate|CancelUpdateDownload|OpenUpdateStatusWindow|AutoUpdatePreferences|AutoDownloadAndInstallUpdates|PostUpdateReleaseNotes|SkipUpdateVersion|QuitAndInstallUpdate|updateStatusWindow|forceUpdate|ForceUpdate|initAutoUpdater|electron-updater|VITE_ZAI_OAUTH|ZAI_OAUTH_ORIGIN|ZAI_OAUTH_CLIENT_ID/, file);
  }
});

test('[structural, not runtime] WP-07: local log export chain is preserved', () => {
  assert.equal(fs.existsSync(path.join(root, 'packages/services/src/feedback/feedbackLogArchive.ts')), true);
  const nodeExports = fs.readFileSync(path.join(root, 'packages/services/src/node.ts'), 'utf8');
  assert.match(nodeExports, /export \{ createFeedbackDiagnosticArchive \} from "\.\/feedback\/feedbackLogArchive\.js";/);
  assert.doesNotMatch(nodeExports, /createFeedbackService|CreateFeedbackServiceOptions/);
  const sharedIndex = fs.readFileSync(path.join(root, 'packages/shared/src/index.ts'), 'utf8');
  assert.match(sharedIndex, /redactFeedbackText/);
});

test('[structural, not runtime] WP-08: official product endpoints are absent outside the explicit exemption list', () => {
  // WP-08 收敛后源码树不得再携带官方产品域。允许残留的文件必须在此显式登记豁免，
  // 并在 PR 描述里挂待办：D-2（builtin.json off-peak 规则）、D-3（productDocs 官方文档外链）。
  const officialDomainRe =
    /zcode\.z\.ai|open\.bigmodel\.cn|chat\.z\.ai|api\.z\.ai|cdn-zcode\.z\.ai|bigmodel\.cn|(?:^|[^a-z0-9.-])z\.ai(?:\/|[^a-z0-9.-]|$)|zcode\.ai/;
  const exemptFiles = new Set([
    // D-2：off-peak 两条 providerRules 仍绑定官方域（路线乙过渡态，独立工作包下线 off-peak 链后收敛）。
    'config/provider/zcode-builtin.json',
    // D-3：帮助菜单产品文档外链去留未决，先豁免登记。
    'packages/ui/src/lib/productDocs.ts',
  ]);
  const scanRoots = [
    'packages/shared/src', 'packages/services/src', 'packages/server/src',
    'packages/desktop/src', 'packages/ui/src', 'packages/web/src',
    'packages/client/src', 'packages/provider/src', 'packages/provider-node/src',
    'apps/zcode-cli/packages',
    'scripts', 'tests',
  ];
  const scanExtensions = /\.(?:[cm]?[jt]sx?|mjs|cjs|json)$/;
  const ignoreDirs = new Set(['node_modules', 'dist', 'out', '.git', 'mock-cdn']);
  // 豁免表与本测试自排除串统一使用 POSIX 风格相对路径；
  // path.relative 在 Windows 上返回反斜杠，必须先归一化再比较，否则豁免/自排除在 win32 全部失效。
  const toPosixRelative = file => file.split(path.sep).join('/');
  const violations = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!scanExtensions.test(entry.name)) continue;
      const file = toPosixRelative(path.relative(root, path.join(dir, entry.name)));
      if (exemptFiles.has(file) || file === 'tests/private-cleanup/cleanup.test.cjs') continue;
      const text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      const match = text.match(officialDomainRe);
      if (match) violations.push(`${file}: ${match[0]}`);
    }
  };
  for (const rel of scanRoots) walk(path.join(root, rel));
  assert.deepEqual(violations, [], `official domains found outside exemptions:\n${violations.join('\n')}`);
});

test('[structural, not runtime] WP-08: builtin release keeps 16 third-party templates, no account plan bindings outside off-peak', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/provider/zcode-builtin.json'), 'utf8'));
  assert.equal(cfg.revision, 31);
  const pcr = cfg.config.providerConfigRules;
  assert.equal(pcr.templateRules.length, 16);
  const templateIds = new Set(pcr.templateRules.map(t => t.templateId));
  for (const official of ['zai-api', 'zai-standard-api', 'bigmodel-api', 'bigmodel-standard-api']) {
    assert.equal(templateIds.has(official), false, official);
  }
  const providerIds = pcr.providerRules.map(r => r.providerId);
  // D-2 路线乙：仅保留两条 off-peak idle plan 规则（zhipu-account 无法物化后不可达，属过渡态）。
  assert.deepEqual(providerIds.sort(), [
    'account:bigmodel-offpeak-idle-plan',
    'account:zai-offpeak-idle-plan',
  ]);
  for (const r of pcr.providerRules) {
    assert.match(r.config.access.type, /zhipu-account/, r.providerId);
  }
  const mcr = cfg.config.modelConfigRules;
  const builtinRuleProviderIds = new Set(mcr.builtinProviderModelRules.map(r => r.providerId));
  for (const id of builtinRuleProviderIds) {
    assert.match(id, /offpeak-idle-plan$/, id);
  }
  const templateModelTemplateIds = new Set(mcr.templateModelRules.map(r => r.templateId));
  for (const official of ['zai-api', 'zai-standard-api', 'bigmodel-api', 'bigmodel-standard-api']) {
    assert.equal(templateModelTemplateIds.has(official), false, official);
  }
});

test('[behavior, not runtime] WP-08: endpoint resolver returns undefined without configuration and never invents official origins', async () => {
  const load = createLoader();
  const endpoint = load('packages/shared/src/zcodeEndpoint.ts');
  // 缺配置 = undefined（能力未配置），不 throw、不回退官方默认域。
  assert.equal(endpoint.resolveZCodeEndpointOrigin({}), undefined);
  assert.equal(endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: '', overrideOrigin: '' }), undefined);
  assert.equal(endpoint.resolveRuntimeZCodeEndpointOrigin({ ZCODE_ENV: 'production' }), undefined);
  assert.equal(endpoint.resolveRuntimeZCodeEndpointOrigin({}), undefined);
  // 显式传入合法值仍解析；显式非法值仍 throw（配置错误 ≠ 缺配置）。
  assert.equal(
    endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: 'http://intra.example:8443/' }),
    'http://intra.example:8443',
  );
  assert.throws(() => endpoint.resolveZCodeEndpointOrigin({ envBaseOrigin: 'not a url' }));
  // 键表收缩：产品端点 env 只透传通用键，不再收集官方 provider 键。
  const picked = endpoint.pickProductEndpointEnv({
    ZCODE_BASE_URL: 'http://127.0.0.1:9/',
    ZAI_OAUTH_ORIGIN: 'https://chat.z.ai',
    BIGMODEL_API_BASE_URL: 'https://bigmodel.cn',
  });
  assert.deepEqual(picked, { ZCODE_BASE_URL: 'http://127.0.0.1:9/' });
  // CDN 缺配置返回空数组，由远端连接链显式报错。
  const cdnText = fs.readFileSync(path.join(root, 'packages/desktop/src/main/remoteCdn.ts'), 'utf8');
  assert.doesNotMatch(cdnText, /DEFAULT_CDN_BASE_URL/);
});

test('[structural, not runtime] WP-08: removed login/startPlan key families stay absent and locales stay aligned', () => {
  // 覆盖率口径：WP-08 只承诺「本包删除文件的直接键不再存在」与「双 locale 键集一致」。
  // 存量历史孤儿键的清理归 D-4 独立决策，这里不设立全局零孤儿断言，避免门禁必红。
  const localeFiles = [
    'packages/ui/src/i18n/locales/zh-CN.ts',
    'packages/ui/src/i18n/locales/en-US.ts',
  ];
  const collectKeys = file =>
    [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/^[ \t]*"((?:[^"\\]|\\.)+)":/gm)]
      .map(m => m[1]);
  const zhKeys = collectKeys(localeFiles[0]);
  const enKeys = collectKeys(localeFiles[1]);
  // 存量 locale 存在历史键集漂移（归 D-4）；WP-08 只承诺被删键族在两个 locale 同步消失。
  const bannedExact = new Set([
    'quickPick.command.login',
    'quickPick.command.logout',
    'welcome.login',
    'welcome.loginFailed',
    'app.login',
    'settings.modelProvider.useSubscription',
  ]);
  const bannedPrefixes = ['login.', 'settings.modelProvider.startPlan.'];
  for (const keys of [zhKeys, enKeys]) {
    for (const key of keys) {
      assert.equal(bannedExact.has(key), false, key);
      for (const prefix of bannedPrefixes) {
        assert.equal(key.startsWith(prefix), false, `${key} (prefix ${prefix})`);
      }
    }
  }
});

test('[structural, not runtime] WP-08: retained live i18n key families stay defined', () => {
  const zh = fs.readFileSync(path.join(root, 'packages/ui/src/i18n/locales/zh-CN.ts'), 'utf8');
  // 这些键族在源码仍有静态/动态引用，必须保留，防止后续清理误删活键。
  const mustStay = [
    'settings.modelProvider.connectionMode.codingPlan',
    'settings.modelProvider.connectionMode.startPlan',
    'settings.modelProvider.connectionMode.teamPlan',
    'settings.mcp.oauth.',
    'offPeak.',
    'chat.permission.feedback.',
  ];
  for (const key of mustStay) {
    assert.ok(zh.includes(`"${key}`), key);
  }
});
