import type { IPlatformService } from "@zcode/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";

const buttonMock = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/ui/button.js", async () => {
  const React = await import("react");
  return {
    Button: (props: Record<string, unknown>) => {
      buttonMock.props.push(props);
      const { children, size, variant, ...domProps } = props;
      void size;
      void variant;
      return React.createElement("button", domProps, children);
    },
  };
});

vi.mock("@/components/ui/toast.js", () => ({
  toast: vi.fn(),
}));

const mockPlatform = {
  captureWindowScreenshot: vi.fn(async () => null),
} as unknown as IPlatformService;

describe("ChatErrorBanner local actions", () => {
  beforeEach(() => {
    buttonMock.props = [];
    vi.clearAllMocks();
  });

  it("没有升级处理器时不展示不可用的升级动作", () => {
    renderToStaticMarkup(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          PlatformProvider,
          { platform: mockPlatform },
          createElement(ChatErrorBanner, {
            error: {
              code: "model_config_missing",
              message: "Model config is missing.",
            },
            onOpenModelSettings: vi.fn(),
          }),
        ),
      ),
    );

    expect(buttonMock.props.some((props) => props["aria-label"] === "升级")).toBe(false);
    expect(buttonMock.props.some((props) => props["aria-label"] === "配置")).toBe(true);
  });

  it("远程 workspace 缺模型时保留本机配置入口", () => {
    const html = renderToStaticMarkup(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          PlatformProvider,
          { platform: mockPlatform },
          createElement(ChatErrorBanner, {
            error: {
              code: "model_config_missing",
              message: "Model config is missing.",
            },
            modelConfigTarget: "remote",
            onOpenModelSettings: vi.fn(),
          }),
        ),
      ),
    );

    expect(html).toContain(zhCN["chat.error.remoteNoAvailableModel"]);
    expect(html).not.toContain(zhCN["chat.error.noAvailableModel"]);
    expect(buttonMock.props.some((props) => props["aria-label"] === "配置")).toBe(true);
    expect(buttonMock.props.some((props) => props["aria-label"] === "升级")).toBe(false);
    expect(buttonMock.props.some((props) => props["aria-label"] === "去同步")).toBe(false);
  });
});

it("远程发送竞态提供重连", async () => {
  const reconnect = vi.fn();
  renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: mockPlatform },
        createElement(ChatErrorBanner, {
          error: {
            code: "ZCODE_REMOTE_WORKSPACE_DISCONNECTED",
            message: "ZCODE_REMOTE_WORKSPACE_DISCONNECTED",
          },
          remoteKind: "ssh",
          onReconnect: reconnect,
        }),
      ),
    ),
  );
  const button = buttonMock.props.find((props) => props.children === "重新连接");
  expect(button).toBeDefined();
  (button!.onClick as () => void)();
  expect(reconnect).toHaveBeenCalledOnce();
});
