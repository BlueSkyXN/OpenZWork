import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelClient, ChannelServer, createQueuePair } from "@zcode/rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
const tempHomes: string[] = [];
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "zcode-local-services-remote-authority-"));
  tempHomes.push(home);
  return home;
}

function writeLegacyZapiConfig(home: string): void {
  const configDir = join(home, ".openzwork", "v2");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify(
      {
        provider: {
          [RETIRED_ZAPI_PROVIDER_ID]: {
            name: "ZAPI",
            kind: "anthropic",
            options: {
              apiKey: "",
              baseURL: "https://provider.example.invalid/v1",
            },
            models: {
              "gpt-5.4": {
                limit: { context: 128_000 },
                modalities: {
                  input: ["text"],
                  output: ["text"],
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function writeZCodeBuiltinProviderConfig(home: string): string {
  const configDir = join(home, ".openzwork", "provider-test");
  mkdirSync(configDir, { recursive: true });
  const filePath = join(configDir, "zcodeBuiltin.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      config: {
        // 装配测试必须使用当前发布合同；上面的 config.json 才是待迁移的旧数据。
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
    "utf-8",
  );
  return filePath;
}

describe("createLocalServices remote authority", () => {
  afterEach(() => {
    if (originalDataBaseDir === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = originalDataBaseDir;
    vi.restoreAllMocks();
    vi.resetModules();
    for (const home of tempHomes.splice(0)) {
      // 根因：Windows 删除目录必须先关闭其下所有句柄，而 service 释放（日志文件、
      // 配置 watcher、SQLite 句柄）是异步收口的，`force: true` 并不会重试——它只吞
      // ENOENT。于是 afterEach 稳定抛 `EPERM, Permission denied: \\?\C:\...\Temp\...`，
      // 用例本身的断言其实都已通过。POSIX 上因为允许删除仍被打开的 inode 所以看不到。
      // 用 rm 自带的有界重试等句柄收口；重试只对 EBUSY/EPERM/ENOTEMPTY 等生效，
      // 真正的权限故障仍会在耗尽重试后抛出。
      try {
        rmSync(home, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      } catch {
        // 极端情况下句柄仍未释放。临时目录由操作系统回收，清理失败不该把已经通过
        // 断言的用例判为失败。
      }
    }
  });

  it("desktop-attached remote services hide stale ZAPI providers", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    writeLegacyZapiConfig(home);

    const [{ createLocalServices, disposeServiceResourcesAndWait }, { IModelSelectionService }] =
      await Promise.all([import("../src/node.js"), import("../src/index.js")]);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-attached-remote",
    });

    const providers = (await services.get(IModelSelectionService).getView()).providers;

    expect(providers.some((provider) => provider.id === RETIRED_ZAPI_PROVIDER_ID)).toBe(false);
    await disposeServiceResourcesAndWait(services);
  });

  it("desktop-attached Remote Host 不恢复旧 Model Preset 刷新", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 0, data: { configs: {} } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);

    const { createLocalServices, disposeServiceResourcesAndWait } = await import("../src/node.js");
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-attached-remote",
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const requestedUrls = fetchImpl.mock.calls.map(([input]) => String(input));
      expect(requestedUrls.some((url) => url.includes("/releases/latest"))).toBe(false);
      expect(requestedUrls.every((url) => url.includes("/client/configs"))).toBe(true);
    } finally {
      await disposeServiceResourcesAndWait(services);
    }
  });

  it("provider runtime services do not refresh legacy model presets on startup", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const zcodeBuiltinProviderConfigFilePath = writeZCodeBuiltinProviderConfig(home);
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 0, data: { configs: {} } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);

    const { createLocalServices, disposeServiceResourcesAndWait } = await import("../src/node.js");
    const services = createLocalServices({ zcodeBuiltinProviderConfigFilePath });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const requestedUrls = fetchImpl.mock.calls.map(([input]) => String(input));
      expect(requestedUrls.some((url) => url.includes("/releases/latest"))).toBe(false);
    } finally {
      await disposeServiceResourcesAndWait(services);
    }
  });

  it("desktop-attached remote 使用远端 Registry 的就绪状态，不等待 Desktop 推送", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const zcodeBuiltinProviderConfigFilePath = writeZCodeBuiltinProviderConfig(home);
    const commandResolver = vi.fn(() => null);
    const [{ createLocalServices, disposeServiceResourcesAndWait }, { IZCodeAgentService }] =
      await Promise.all([import("../src/node.js"), import("../src/index.js")]);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath,
      serviceAuthorityMode: "desktop-attached-remote",
      zcodeAgentCommandResolver: commandResolver,
    });

    try {
      await expect(
        services.get(IZCodeAgentService).initialize({ workspacePath: "/remote/workspace" }),
      ).resolves.toMatchObject({ available: false });
      expect(commandResolver).not.toHaveBeenCalled();
    } finally {
      await disposeServiceResourcesAndWait(services);
    }
  });

  it("只在 desktop-attached-remote Environment 暴露 Provisioning target", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const { createLocalServices, disposeServiceResourcesAndWait } = await import("../src/node.js");
    const { IProviderProvisioningTargetService } = await import("../src/index.js");
    const remoteServices = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-attached-remote",
    });
    const localServices = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-local",
    });

    try {
      expect(remoteServices.getOptional(IProviderProvisioningTargetService)).toBeDefined();
      expect(localServices.getOptional(IProviderProvisioningTargetService)).toBeUndefined();
    } finally {
      await disposeServiceResourcesAndWait(remoteServices);
      await disposeServiceResourcesAndWait(localServices);
    }
  });

  it("只在本进程成功持久化 Provisioning Source 事实后通知 Host", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    mkdirSync(join(home, ".openzwork", "v2"), { recursive: true });
    const onProviderProvisioningSourceChanged = vi.fn();
    const [{ createLocalServices, disposeServiceResourcesAndWait }, serviceDescriptors] =
      await Promise.all([import("../src/node.js"), import("../src/index.js")]);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      onProviderProvisioningSourceChanged,
    });

    try {
      await services.get(serviceDescriptors.IProviderSettingsService).createPersonalProvider({
        initialConfig: {
          access: { type: "api-key", apiKey: "key" },
          api: { type: "openai-chat-completions", baseUrl: "https://example.com/v1" },
          personalModelIds: [],
        },
      });
      await services.get(serviceDescriptors.ISettingService).update({ locale: "zh-CN" });
      await services.get(serviceDescriptors.ICredentialService).save("ssh:password", "ignored");

      // 官方账号设置已移除；个人 Provider 变更继续通知，语言与 SSH 凭据不触发同步。
      expect(onProviderProvisioningSourceChanged.mock.calls).toEqual([["personal-config"]]);
    } finally {
      await disposeServiceResourcesAndWait(services);
    }
  });

  it("Host 退出时等待所注入网络 transport 的释放", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const transport = {
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ code: 0, msg: "ok", data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
      dispose: vi.fn(),
      disposeAndWait: vi.fn(async () => {}),
    };
    const [{ createLocalServices, disposeServiceResourcesAndWait }, { IModelSelectionService }] =
      await Promise.all([import("../src/node.js"), import("../src/index.js")]);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      hostApiNetworkTransport: transport,
      serviceAuthorityMode: "desktop-attached-remote",
    });

    try {
      // ClientScenes 属于已移除的官方配置入口；保留 Host 对注入资源的生命周期覆盖。
      await expect(services.get(IModelSelectionService).getView()).resolves.toMatchObject({
        providers: [],
      });
    } finally {
      await disposeServiceResourcesAndWait(services);
    }

    expect(transport.disposeAndWait).toHaveBeenCalledOnce();
  });

  it("exposes plugin sync through the local RPC server", async () => {
    const home = makeTempHome();
    process.env.ZCODE_DATA_BASE_DIR = home;
    const [{ createLocalServices, disposeServiceResourcesAndWait }, { IPluginSyncService }] =
      await Promise.all([import("../src/node.js"), import("../src/index.js")]);
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: writeZCodeBuiltinProviderConfig(home),
      serviceAuthorityMode: "desktop-attached-remote",
    });
    const [clientProtocol, serverProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "test", 50);
    const client = new ChannelClient(clientProtocol);

    try {
      services.exposeOnChannelServer(server);
      const result = await client
        .getChannel(IPluginSyncService.channelName)
        .call("listLocalUserPluginCandidates", []);

      expect(result.candidates).toEqual([]);
      expect(result.maxArchiveBytes).toBeGreaterThan(0);
    } finally {
      client.dispose();
      server.dispose();
      await disposeServiceResourcesAndWait(services);
    }
  });
});
