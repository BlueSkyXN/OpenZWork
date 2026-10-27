// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TID_MODEL_PROVIDER_TEMPLATE_ITEM,
  TID_MODEL_PROVIDER_TEMPLATE_PICKER,
  testId,
} from "@zcode/shared/test-ids";
import { ProviderTemplatePicker } from "@/settings/model-provider-section/ProviderTemplatePicker.js";
import { ProviderDetailFeedbackBoundary } from "@/settings/model-provider-section/ProviderDetailFeedback.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";

const loggerMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/logger.js", () => ({ logger: loggerMock }));

afterEach(cleanup);

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) => {
        const message =
          {
            "settings.modelProvider.templatePickerTitle": "添加供应商",
            "settings.modelProvider.templatePickerBack": "返回供应商详情",
            "settings.modelProvider.createCustomProvider": "创建自定义供应商",
            "settings.modelProvider.templateCreateFailed": "创建供应商失败：个人供应商配置格式无效",
            "settings.modelProvider.templateCreateRetry": "重试",
          }[id] ?? id;
        return message.replace("{reason}", values?.reason ?? "");
      },
    },
  }),
}));

describe("ProviderTemplatePicker", () => {
  it("按 Settings View 顺序展示本地化 Template，并提供同页自定义入口", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ProviderTemplatePicker, {
          templates: [
            {
              templateId: "standard-anthropic-messages",
              templateNameMap: { "zh-CN": "Anthropic Messages", "en-US": "Anthropic Messages" },
              config: { api: { type: "anthropic-messages" } },
            },
            {
              templateId: "standard-openai-chat-completions",
              templateNameMap: { "en-US": "OpenAI Chat Completions" },
              config: {},
            },
          ],
          onBack: vi.fn(),
          onCreateFromTemplate: vi.fn(),
          onCreateCustom: vi.fn(),
          creating: false,
        }),
      ),
    );

    expect(html).toContain("添加供应商");
    expect(html).toContain(`data-testid="${TID_MODEL_PROVIDER_TEMPLATE_PICKER}"`);
    expect(html).toContain(`data-testid="${testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "custom")}"`);
    expect(html).toContain(
      `data-testid="${testId(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "standard-anthropic-messages")}"`,
    );
    expect(html).toContain("创建自定义供应商");
    expect(html).toContain("Anthropic Messages");
    expect(html).toContain("OpenAI Chat Completions");
    expect(html.indexOf("Anthropic Messages")).toBeLessThan(
      html.indexOf("OpenAI Chat Completions"),
    );
  });

  it("Template 创建失败时在详情底部显示错误并允许重试", async () => {
    const onCreateFromTemplate = vi
      .fn<(templateId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("写入失败"))
      .mockResolvedValueOnce();

    render(
      createElement(
        ProviderDetailFeedbackBoundary,
        null,
        createElement(
          TooltipProvider,
          null,
          createElement(ProviderTemplatePicker, {
            templates: [
              {
                templateId: "standard-anthropic-messages",
                templateNameMap: { "zh-CN": "Anthropic Messages" },
                config: { api: { type: "anthropic-messages" } },
              },
            ],
            onBack: vi.fn(),
            onCreateFromTemplate,
            onCreateCustom: vi.fn(),
            creating: false,
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Anthropic Messages" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "创建供应商失败：个人供应商配置格式无效",
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      "[ProviderTemplatePicker] 创建供应商失败",
      expect.any(Error),
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(onCreateFromTemplate).toHaveBeenCalledTimes(2));
    expect(onCreateFromTemplate).toHaveBeenLastCalledWith("standard-anthropic-messages");
  });
});
