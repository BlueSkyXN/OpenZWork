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
test('[structural, not runtime] Desktop OTLP initialization and IPC bridge methods are removed', () => {
  for (const file of ['packages/desktop/src/main/index.ts', 'packages/desktop/src/preload/index.ts', 'packages/desktop/src/renderer/src/desktopPlatform.ts', 'packages/shared/src/platform.ts']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /createLocalTtftExporter|createRendererActionTraceExporter|reportLocalTtftBatch|reportRendererActionTraceBatch|getRendererActionTraceConfig/);
  }
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
