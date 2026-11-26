// @vitest-environment jsdom
import { SUPPORTED_LOCALES } from "@zcode/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";
import { LOCALE_MESSAGES } from "../src/i18n/localeMessages.js";
import { AutomationKeepAwakeNotice } from "../src/settings/AutomationDesignPrimitives.js";

it.each(SUPPORTED_LOCALES)("%s 自动化开关沿用常规设置的可见名称和无障碍名称", (locale) => {
  const label = LOCALE_MESSAGES[locale]["settings.keepAwakeWhileRunning"];
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(ZCodeIntlProvider, {
      initialLocale: locale,
      children: createElement(AutomationKeepAwakeNotice, { checked: false, onChange: () => {} }),
    }),
  );
  expect(label).toBeTruthy();
  expect(container.querySelector("p")?.textContent).toBe(label);
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe(label);
});
