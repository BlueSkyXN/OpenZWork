// @vitest-environment jsdom

import type { IPlatformService } from "@zcode/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { SessionSubscriptionErrorPanel } from "@/v4/SessionSubscriptionErrorPanel.js";

const screenshot = {
  filename: "session-subscription-error.png",
  contentType: "image/png",
  dataBase64: "c2NyZWVuc2hvdA==",
  size: 10,
};
const onReconnect = vi.fn();
const captureWindowScreenshot = vi.fn(async () => screenshot);
const platform = {
  captureWindowScreenshot,
} as unknown as IPlatformService;

function renderPanel() {
  return render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform },
        createElement(SessionSubscriptionErrorPanel, {
          error: "EPERM: operation not permitted",
          sessionId: "session-1",
          workspacePath: "F:\\ZCode_data",
          onReconnect,
        }),
      ),
    ),
  );
}


afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionSubscriptionErrorPanel", () => {
  it("shows the subscription error with reconnect action", () => {
    renderPanel();

    expect(screen.getByText("EPERM: operation not permitted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeTruthy();
  });

  it("点击重新连接调用原订阅恢复入口", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});
