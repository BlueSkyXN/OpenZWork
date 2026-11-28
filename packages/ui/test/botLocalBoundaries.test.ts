// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BotConfig, BotProvider } from "@zcode/shared";
import { BotsDialog } from "@/BotsDialog.js";

const { bots, service, intl, platform } = vi.hoisted(() => {
  const bots: BotConfig[] = [];
  const service = {
    getConfig: vi.fn(async () => ({ version: 3, bots: [...bots] })),
    getStatus: async () => ({
      botRuntime: bots.map((bot) => ({
        botId: bot.id,
        provider: bot.provider,
        status: bot.enabled ? "idle" : "disabled",
      })),
    }),
    listWorkspaceRefs: async () => [],
    getBotStates: async () => [],
    saveBot: vi.fn(async ({ bot }: { bot: BotConfig }) => {
      bots.splice(0, bots.length, bot);
      return bot;
    }),
    createBindCode: vi.fn(async () => ({ code: "TESTBIND", expiresAt: Date.now() + 30_000 })),
    beginFeishuRegistration: vi.fn(async () => {
      throw new Error("模拟扫码服务离线");
    }),
    beginWeixinRegistration: vi.fn(async () => {
      throw new Error("模拟扫码服务离线");
    }),
  };
  return { bots, service, intl: { formatMessage: ({ id }: { id: string }) => id }, platform: {} };
});

vi.mock("@/hooks/useServices.js", () => ({ useServices: () => ({ botsService: service }) }));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => platform }));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => ({ intl }) }));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock("@/components/ui/toast.js", () => ({ toast: vi.fn() }));
vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/BotsDialog/BoundGroupsCard.js", () => ({ BoundGroupsCard: () => null }));
vi.mock("@/BotsDialog/WorkspaceAccessCard.js", () => ({ WorkspaceAccessCard: () => null }));

afterEach(() => {
  cleanup();
  bots.length = 0;
  vi.clearAllMocks();
});

function openBot(provider: BotProvider) {
  return render(
    createElement(BotsDialog, {
      open: true,
      embedded: true,
      entryProvider: provider,
      onOpenChange: vi.fn(),
    }),
  );
}

function configuredBot(provider: BotProvider, enabled = false): BotConfig {
  return {
    id: "test-bot",
    name: "Test bot",
    provider,
    enabled,
    credentialRef: "test-ref",
    currentOptions: {},
    allowedCommands: {
      status: true,
      new: true,
      workspace: true,
      model: true,
      thoughtLevel: true,
      reply: true,
    },
    allowedWorkspaces: ["*"],
    replyMode: "assistant_changes",
  };
}

it.each(["feishu", "lark", "weixin"] as const)(
  "%s 新建后保持停用，点击扫码才请求注册",
  async (provider) => {
    const view = openBot(provider);
    const scan = await view.findByRole("button", { name: "bots.scanQrCode" });
    expect(bots[0]?.enabled).toBe(false);
    expect(service.beginFeishuRegistration).not.toHaveBeenCalled();
    expect(service.beginWeixinRegistration).not.toHaveBeenCalled();
    fireEvent.click(scan);
    await waitFor(() =>
      expect(
        provider === "weixin" ? service.beginWeixinRegistration : service.beginFeishuRegistration,
      ).toHaveBeenCalledOnce(),
    );
  },
);

it.each(["feishu", "lark", "telegram", "weixin"] as const)(
  "%s 随启用状态展示聊天操作",
  async (provider) => {
    bots.push(configuredBot(provider));
    const view = openBot(provider);
    const toggle = await view.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(view.container.textContent).toContain("bots.enableToConnect");
    expect(service.createBindCode).not.toHaveBeenCalled();
    expect(view.queryByText("bots.connected")).toBeNull();
    expect(view.queryByText("bots.weixinActivationHint")).toBeNull();
    expect(view.queryByText("bots.bind")).toBeNull();

    fireEvent.click(toggle);
    const action = provider === "weixin" ? "bots.weixinActivationHint" : "/bind TESTBIND";
    await view.findByText(action);
    expect(service.createBindCode).toHaveBeenCalledTimes(provider === "weixin" ? 0 : 1);
    fireEvent.click(toggle);
    await view.findByText("bots.enableToConnect");
    expect(view.queryByText(action)).toBeNull();
    expect(view.queryByText("bots.connected")).toBeNull();
  },
);

it("飞书绑定码在停用后返回时，关闭的面板不显示旧码或开始轮询", async () => {
  bots.push(configuredBot("feishu", true));
  const pending = Promise.withResolvers<{ code: string; expiresAt: number }>();
  service.createBindCode.mockReturnValueOnce(pending.promise);
  const view = openBot("feishu");
  const toggle = await view.findByRole("switch");
  await waitFor(() => expect(service.createBindCode).toHaveBeenCalledOnce());
  fireEvent.click(toggle);
  await view.findByText("bots.enableToConnect");
  const readsWhileDisabled = service.getConfig.mock.calls.length;
  await act(async () => {
    pending.resolve({ code: "LATECODE", expiresAt: Date.now() + 30_000 });
    await pending.promise;
  });
  expect(view.queryByText("/bind LATECODE")).toBeNull();
  expect(service.getConfig).toHaveBeenCalledTimes(readsWhileDisabled);
  fireEvent.click(toggle);
  await view.findByText("/bind TESTBIND");
  expect(service.createBindCode).toHaveBeenCalledTimes(2);
});
