// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { LOCALE_MESSAGES } from "../src/i18n/localeMessages.js";
import { consumeInitialSettingsSection } from "../src/lib/settingsNavigation.js";
import {
  createSettingsPageConfig,
  isSettingsSectionAvailable,
} from "../src/settings/settingsPageConfig.js";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("桌面可见的设置分区都有显示名，侧栏和搜索的来源不包含已裁剪的分享页", () => {
  const visible = createSettingsPageConfig({ isDesktop: true }).settingsSections.filter(({ id }) =>
    isSettingsSectionAvailable(id, true),
  );
  expect(visible.map(({ id }) => id)).not.toContain("shares");
  for (const { titleId } of visible) {
    for (const messages of Object.values(LOCALE_MESSAGES)) {
      expect(messages[titleId], titleId).toBeTruthy();
    }
  }
});

it("旧分享页偏好回到常规，过期的单次跳转保留用户上次有效的分区", () => {
  localStorage.setItem("zcode-settings-last-section", "shares");
  expect(consumeInitialSettingsSection()).toBe("general");
  localStorage.setItem("zcode-settings-last-section", "archives");
  sessionStorage.setItem("zcode-settings-section-intent", "shares");
  expect(consumeInitialSettingsSection()).toBe("archives");
  expect(sessionStorage.getItem("zcode-settings-section-intent")).toBeNull();
});
