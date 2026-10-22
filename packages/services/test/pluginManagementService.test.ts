import { describe, expect, it, vi } from "vitest";
import {
  createPluginManagementService,
  type PluginManagementServiceDependencies,
} from "../src/plugins/pluginManagementService.js";

describe("plugin management agent delegation", () => {
  const methods = [
    "listPlugins",
    "getPluginReferenceCatalog",
    "resolveSuggestedPluginReference",
    "onDynamicPluginOperationProgress",
    "getPluginsOverview",
    "addPluginMarketplace",
    "removePluginMarketplace",
    "updatePluginMarketplace",
    "installPlugin",
    "cancelPluginOperation",
    "uninstallPlugin",
    "updatePlugin",
    "restoreBuiltinPlugin",
    "configurePlugin",
    "resetPluginConfig",
    "validatePlugin",
    "describePlugin",
    "setPluginEnabled",
  ] as const;

  it.each(methods)("preserves the agent input and result for %s", async (method) => {
    const result = { diagnostics: [], marker: method };
    const invoke = vi.fn(() => result);
    const agent = new Proxy({}, { get: (_target, key) => (key === method ? invoke : undefined) });
    const service = createPluginManagementService({
      zcodeAgentService: agent as PluginManagementServiceDependencies["zcodeAgentService"],
    });
    const params = {
      workspacePath: "/fixture",
      workspaceIdentity: "remote:fixture",
      operationId: "op",
    };
    const target = service[method] as (input: unknown) => unknown;
    expect(await target(params)).toBe(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(params);
    expect(invoke.mock.instances[0]).toBe(agent);
  });

  it("preserves cancellation failures and does not retry the operation", async () => {
    const error = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const installPlugin = vi.fn(async () => {
      throw error;
    });
    const service = createPluginManagementService({
      zcodeAgentService: {
        installPlugin,
      } as unknown as PluginManagementServiceDependencies["zcodeAgentService"],
    });
    await expect(
      service.installPlugin({
        workspacePath: "/fixture",
        pluginName: "demo",
        marketplace: "market",
      }),
    ).rejects.toBe(error);
    expect(installPlugin).toHaveBeenCalledTimes(1);
  });
});
