// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";

describe("ProviderLogo", () => {
  it("旧 logo key 也统一显示中性图标", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderLogo, {
        logo: { type: "builtin", key: "retired-vendor" },
        className: "size-5",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("lucide-package");
  });
});
