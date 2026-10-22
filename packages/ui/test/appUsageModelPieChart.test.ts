import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import en from "@/i18n/locales/en-US.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";
import { ModelRanking } from "@/settings/usage-stats/UsageVisualizations.js";

describe("本地模型用量排行", () => {
  it("显示累计 token、占比及请求数，未知模型保留独立条目", () => {
    const snapshot = createSnapshot({ models: [
      { modelId: "model-a", totalTokens: 1500, inputTokens: 1000, outputTokens: 500, requestCount: 3, share: 0.75 },
      { modelId: null, totalTokens: 500, inputTokens: 400, outputTokens: 100, requestCount: 1, share: 0.25 },
    ] });
    const before = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(ModelRanking, { snapshot, locale: "en-US" })));
    expect(html).toContain("1,500"); expect(html).toContain("75%"); expect(html).toContain("25%");
    expect(html).toContain("model-a"); expect(html).toContain(en["settings.usage.unknownModel"]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
