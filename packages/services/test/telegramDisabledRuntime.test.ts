import { expect, it, vi } from "vitest";
import type { BotConfig, BotsConfigFile } from "@zcode/shared";
import { createDefaultBotCommands } from "../src/bots/config.js";
import { createTelegramBotProvider } from "../src/bots/providers/telegramProvider.js";
import { createTelegramChannelRuntime } from "../src/bots/telegramChannelRuntime.js";

it("OW-P057：停用配置的冷启动和重复刷新不改菜单，运行中停用只清理一次", async () => {
  const bot: BotConfig = {
    id: "menu",
    name: "Menu",
    provider: "telegram",
    enabled: false,
    credentialRef: "fixture-ref",
    allowedCommands: createDefaultBotCommands(),
    allowedWorkspaces: ["*"],
    currentOptions: {},
    replyMode: "assistant_changes",
  };
  let config: BotsConfigFile = { version: 3, bots: [bot] };
  const load = vi.fn(async (_key: string) => "fixture");
  const requests: string[] = [];
  let menuAccepted = true;
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(new URL(url).pathname.split("/").at(-1)!);
    return Response.json({ ok: menuAccepted });
  });
  const runtime = createTelegramChannelRuntime({
    credentialService: { load },
    telegramProvider: createTelegramBotProvider({ loadCredential: load }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    statusSink: { getRuntimeStatus: () => undefined, setRuntimeStatus: vi.fn() },
    ensureBotStorageMigrated: async () => {},
    readConfig: async () => config,
    readTelegramOffset: async () => undefined,
    writeTelegramOffset: async () => {},
    processProviderCallback: vi.fn(),
    acquirePollingLock: async () => null,
  });
  try {
    await runtime.refresh();
    await runtime.refresh();
    expect(requests).toEqual([]);
    expect(load).not.toHaveBeenCalled();

    config = { ...config, bots: [{ ...bot, enabled: true }] };
    await runtime.refresh();
    config = { ...config, bots: [bot] };
    await runtime.refresh();
    await runtime.refresh();
    expect(requests).toEqual(["setMyCommands", "deleteMyCommands"]);

    config = { ...config, bots: [{ ...bot, enabled: true }] };
    await runtime.refresh();
    load.mockResolvedValue("replacement-fixture");
    config = { ...config, bots: [bot] };
    await runtime.refresh();
    expect(requests).toEqual(["setMyCommands", "deleteMyCommands", "setMyCommands"]);

    requests.length = 0;
    menuAccepted = false;
    config = { ...config, bots: [{ ...bot, enabled: true }] };
    await runtime.refresh();
    config = { ...config, bots: [bot] };
    await runtime.refresh();
    expect(requests).toEqual(["setMyCommands"]);
  } finally {
    await runtime.dispose();
    vi.unstubAllGlobals();
  }
});
