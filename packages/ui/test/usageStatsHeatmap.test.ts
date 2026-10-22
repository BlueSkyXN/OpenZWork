import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import en from "@/i18n/locales/en-US.js";
import { createSnapshot } from "./fixtures/appUsageSnapshot.js";
import { UsageHeatmap } from "@/settings/usage-stats/UsageVisualizations.js";

describe("本地用量热力图", () => {
  it("保留日期与实际 token/tool/turn 数，空格不伪造日期", () => {
    const snapshot = createSnapshot({ heatmap: { startDate: "2026-10-20", endDate: "2026-10-20", maxTokens: 1500, weeks: [{ weekIndex: 0, days: [null, { date: "2026-10-20", level: 3, totalTokens: 1500, turnCount: 2, toolCallCount: 4 }] }] } });
    const html = renderToStaticMarkup(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(UsageHeatmap, { snapshot, locale: "en-US" })));
    expect(html).toContain("2026-10-20"); expect(html).toContain("1,500");
    expect(html).toContain('tabindex="0"'); expect(html).toContain('role="region"');
    expect(html.match(/title=/g)).toHaveLength(1);
  });
  it("没有使用记录时展示空状态", () => {
    const html = renderToStaticMarkup(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(UsageHeatmap, { snapshot: createSnapshot(), locale: "en-US" })));
    expect(html).toContain(en["settings.usage.toolCallsEmpty"]);
    expect(html).not.toContain('role="region"');
  });
});
