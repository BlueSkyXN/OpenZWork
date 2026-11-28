import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotConfig } from "@zcode/shared";
import { createDefaultBotCommands } from "../src/bots/config.js";
import { createTelegramBotProvider } from "../src/bots/providers/telegramProvider.js";
import { createTelegramChannelRuntime } from "../src/bots/telegramChannelRuntime.js";

// OW-P057：使用真实 provider 解析 HTTP / 业务回执，轮询锁由夹具持有。
function menuFixture() {
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
  const load = vi.fn(async (_key: string) => "fixture");
  const warn = vi.fn();
  const reply = vi.fn((_method: string) => Response.json({ ok: true }));
  vi.stubGlobal("fetch", async (url: string) => reply(new URL(url).pathname.split("/").at(-1)!));
  const runtime = createTelegramChannelRuntime({
    credentialService: { load },
    telegramProvider: createTelegramBotProvider({ loadCredential: load }),
    logger: { debug: vi.fn(), info: vi.fn(), warn },
    statusSink: { getRuntimeStatus: () => undefined, setRuntimeStatus: vi.fn() },
    ensureBotStorageMigrated: async () => {},
    readConfig: async () => ({ version: 3, bots: [{ ...bot }] }),
    readTelegramOffset: async () => undefined,
    writeTelegramOffset: async () => {},
    processProviderCallback: vi.fn(),
    acquirePollingLock: async () => null,
  });
  return {
    runtime,
    load,
    warn,
    reply,
    methods: () => reply.mock.calls.map(([method]) => method),
    async setEnabled(enabled: boolean) {
      bot.enabled = enabled;
      await runtime.refresh();
    },
  };
}

let fixture: ReturnType<typeof menuFixture>;
beforeEach(() => {
  vi.useFakeTimers();
  fixture = menuFixture();
});
afterEach(async () => {
  await fixture.runtime.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("冷启动及重复读取停用配置保持静默，成功清理一次后结束", async () => {
  await fixture.runtime.refresh();
  await fixture.runtime.refresh();
  expect(fixture.methods()).toEqual([]);
  expect(fixture.load).not.toHaveBeenCalled();
  await fixture.setEnabled(true);
  await fixture.setEnabled(false);
  await fixture.runtime.refresh();
  expect(fixture.methods()).toEqual(["setMyCommands", "deleteMyCommands"]);
});

it("同引用更换 token、菜单登记被拒时均不清理菜单", async () => {
  await fixture.setEnabled(true);
  fixture.load.mockResolvedValue("replacement-fixture");
  await fixture.setEnabled(false);
  fixture.reply.mockReturnValueOnce(Response.json({ ok: false }));
  await fixture.setEnabled(true);
  await fixture.setEnabled(false);
  expect(fixture.methods()).toEqual(["setMyCommands", "setMyCommands"]);
});

it("删除遇到 HTTP 和业务拒绝后按退避重试，收到成功回执后结束", async () => {
  await fixture.setEnabled(true);
  fixture.reply
    .mockReturnValueOnce(Response.json({ ok: false }, { status: 503 }))
    .mockReturnValueOnce(Response.json({ ok: false }));
  await fixture.setEnabled(false);
  await fixture.runtime.refresh();
  expect(fixture.methods()).toEqual(["setMyCommands", "deleteMyCommands"]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fixture.warn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000);
  await fixture.runtime.refresh();
  expect(fixture.methods()).toEqual([
    "setMyCommands",
    "deleteMyCommands",
    "deleteMyCommands",
    "deleteMyCommands",
  ]);
});

it("持续网络错误最多删除三次，后续读取不再发请求", async () => {
  await fixture.setEnabled(true);
  fixture.reply.mockImplementation(() => {
    throw new Error("fixture offline");
  });
  await fixture.setEnabled(false);
  await vi.advanceTimersByTimeAsync(60_000);
  await fixture.runtime.refresh();
  expect(fixture.methods()).toEqual([
    "setMyCommands",
    "deleteMyCommands",
    "deleteMyCommands",
    "deleteMyCommands",
  ]);
  expect(fixture.warn).toHaveBeenCalledTimes(3);
});

it.each(["重新启用", "替换 token", "退出 Host"])("退避期间%s会停止旧菜单的清理", async (action) => {
  await fixture.setEnabled(true);
  fixture.reply.mockReturnValueOnce(Response.json({ ok: false }));
  await fixture.setEnabled(false);
  if (action === "重新启用") await fixture.setEnabled(true);
  if (action === "替换 token") fixture.load.mockResolvedValue("replacement-fixture");
  if (action === "退出 Host") await fixture.runtime.dispose();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.methods().filter((method) => method === "deleteMyCommands")).toHaveLength(1);
});
