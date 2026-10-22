import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import en from "@/i18n/locales/en-US.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";
import { DailyModelTrend } from "@/settings/usage-stats/UsageVisualizations.js";

describe("本地每日模型趋势", () => {
  it("显示每日总量、日期和未知模型标签，跨日模型只生成一个图例", () => {
    const snapshot = createSnapshot({ dailyModelUsage: [
      { date: "2026-10-20", models: [{ modelId: "model-a", totalTokens: 1000 }, { modelId: null, totalTokens: 500 }] },
      { date: "2026-10-21", models: [{ modelId: "model-a", totalTokens: 200 }] },
    ] });
    const before = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(DailyModelTrend, { snapshot, locale: "en-US" })));
    expect(html).toContain("2026-10-20: 1,500 tokens");
    expect(html).toContain("2026-10-21: 200 tokens");
    expect(html).toContain(en["settings.usage.unknownModel"]);
    expect(html.match(/>model-a</g)).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
