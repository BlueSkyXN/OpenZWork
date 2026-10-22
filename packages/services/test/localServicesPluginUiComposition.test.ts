import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ChannelClient, ChannelServer, createQueuePair, ProxyChannel } from "@zcode/rpc";
import { GEN_UI_OUTPUT_DIRECTORY } from "@zcode/shared/node";
import type { PluginSandboxRegisterInput } from "@zcode/shared/mcp-apps";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
const hosts: Array<{ close(): Promise<void> }> = [];
const connections: Array<{ dispose(): void }> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openzwork-host-ui-"));
  vi.stubEnv("ZCODE_DATA_BASE_DIR", root);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 0, data: {} }));
});

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.dispose();
  for (const host of hosts.splice(0)) await host.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function fixture() {
  const config = join(root, "provider.json");
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      config: {
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: {
          modelRules: [],
          modelApiRules: [],
          providerSiteRules: [],
          templateModelRules: [],
          builtinProviderModelRules: [],
        },
      },
    }),
  );
  const node = await import("../src/node.js");
  const descriptors = await import("../src/index.js");
  const { IGenUiService } = await import("../src/gen-ui/contract.js");
  const register = vi.fn(async (input: PluginSandboxRegisterInput) => ({
    instance: input.instance,
    sandboxId: "fixture-sandbox",
    initId: 1,
    partition: "fixture",
    shellUrl: "zcode-sandbox://fixture",
  }));
  const services = node.createLocalServices({
    zcodeBuiltinProviderConfigFilePath: config,
    registerPluginSandbox: register,
  });
  hosts.push({ close: () => node.disposeServiceResourcesAndWait(services) });
  await services.get(descriptors.IModelSelectionService).getView();
  const [clientProtocol, serverProtocol] = createQueuePair();
  const client = new ChannelClient(clientProtocol);
  const server = new ChannelServer(serverProtocol, "fixture");
  services.exposeOnChannelServer(server);
  connections.push(client, server);
  const genUi = ProxyChannel.toService<import("../src/gen-ui/contract.js").IGenUiService>(
    client.getChannel(IGenUiService.channelName),
  );
  const bridge = ProxyChannel.toService<
    import("../src/plugin-ui-bridge/contract.js").IPluginUiBridgeService
  >(client.getChannel(descriptors.IPluginUiBridgeService.channelName));
  return { node, services, descriptors, IGenUiService, genUi, bridge, register };
}

it("real Host RPC reads GenUI files and state, then registers a sandbox", async () => {
  const { genUi, register } = await fixture();
  const directory = join(root, ".openzwork", "v2", GEN_UI_OUTPUT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const target = {
    workspacePath: root,
    workspaceIdentity: "local:fixture",
    sessionId: "fixture-session",
    path: join(directory, "chart.html"),
  };
  const scope = {
    workspacePath: target.workspacePath,
    workspaceIdentity: target.workspaceIdentity,
    sessionId: target.sessionId,
  };
  await writeFile(target.path, "<main>chart fixture</main>");
  await expect(genUi.listState(scope)).resolves.toEqual([]);
  await expect(genUi.readDocument(target)).resolves.toMatchObject({
    html: "<main>chart fixture</main>",
  });
  await genUi.setState({ target, state: { modelContent: { selection: 2 }, privateContent: null } });
  await expect(genUi.listState(scope)).resolves.toEqual([
    { path: target.path, state: { modelContent: { selection: 2 }, privateContent: null } },
  ]);
  await expect(
    genUi.prepareSandbox({
      ...target,
      html: "<main>chart fixture</main>",
      ownerWebContentsId: 1,
      instanceKey: "row:0",
    }),
  ).resolves.toMatchObject({ sandboxId: "fixture-sandbox" });
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({
      contentKind: "gen-ui",
      sessionId: target.sessionId,
      workspaceIdentity: target.workspaceIdentity,
    }),
  );
});

it("MCP App RPC delegates to the existing Agent without an official account", async () => {
  const { services, descriptors, bridge, register } = await fixture();
  const agent = services.get(descriptors.IZCodeAgentService);
  const instance = {
    runtimeId: "fixture-runtime",
    generation: 1,
    appIdentity: "a".repeat(64),
    token: "fixture-token",
  };
  const open = vi.spyOn(agent, "openMcpUiInstance").mockResolvedValue(instance);
  const read = vi.spyOn(agent, "readMcpResource").mockResolvedValue({
    contents: [{ uri: "ui://fixture/view", mimeType: "text/html", text: "<main>MCP App</main>" }],
  });
  vi.spyOn(agent, "listMcpResourcesForUi").mockResolvedValue({ resources: [] });
  const close = vi.spyOn(agent, "closeMcpUiInstance").mockResolvedValue(undefined);
  const params = {
    workspacePath: root,
    workspaceIdentity: "local:fixture",
    sessionId: "fixture-session",
    pluginId: "fixture",
    serverName: "plugin:fixture:server",
    scopeId: "surface:view",
    resourceUri: "ui://fixture/view",
    ownerWebContentsId: 1,
  };
  await expect(bridge.prepareSandbox(params)).resolves.toMatchObject({
    instance,
    sandboxId: "fixture-sandbox",
  });
  expect(open).toHaveBeenCalledWith({
    ...params,
    accountContext: createHash("sha256").update("null").digest("hex"),
  });
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({
      instance,
      workspaceIdentity: params.workspaceIdentity,
      uri: params.resourceUri,
    }),
  );
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({ instance, html: "<main>MCP App</main>" }),
  );
  await bridge.closeInstance({ ...params, instance });
  expect(close).toHaveBeenCalledWith(
    expect.objectContaining({ instance, workspaceIdentity: params.workspaceIdentity }),
  );
});

it("Host disposal closes the registered GenUI state owner", async () => {
  const { node, services, IGenUiService } = await fixture();
  const service = services.get(IGenUiService);
  const target = {
    workspacePath: root,
    sessionId: "fixture-session",
    path: join(root, "chart.html"),
  };
  await service.setState({ target, state: { modelContent: "before close", privateContent: null } });
  await node.disposeServiceResourcesAndWait(services);
  await expect(
    service.setState({
      target,
      state: { modelContent: "after close", privateContent: null },
    }),
  ).rejects.toThrow("closed");
});
