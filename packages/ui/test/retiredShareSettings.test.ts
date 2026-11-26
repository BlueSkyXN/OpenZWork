// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { LOCALE_MESSAGES } from "../src/i18n/localeMessages.js";
import { consumeInitialSettingsSection } from "../src/lib/settingsNavigation.js";
import { SETTINGS_SEARCH_ITEMS } from "../src/settings-search/settingsSearchIndex.js";
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

it("设置搜索不提供已裁剪的自动更新入口，其余设置项都有名称", () => {
  const ids = SETTINGS_SEARCH_ITEMS.map(({ id }) => id);
  expect(ids).not.toContain("settings.receivePreviewUpdates");
  expect(ids).not.toContain("settings.autoDownloadAndInstallUpdates");
  for (const id of ids) {
    for (const messages of Object.values(LOCALE_MESSAGES)) {
      expect(messages[id], id).toBeTruthy();
    }
  }
});

it("常规通知搜索只提供本机任务通知与声音", () => {
  const ids = SETTINGS_SEARCH_ITEMS.map(({ id }) => id);
  expect(ids).toContain("settings.notification");
  expect(ids).toContain("settings.notificationSound");
  expect(ids).not.toContain("settings.mobilePush");
});

it("旧分享页偏好回到常规，过期的单次跳转保留用户上次有效的分区", () => {
  localStorage.setItem("zcode-settings-last-section", "shares");
  expect(consumeInitialSettingsSection()).toBe("general");
  localStorage.setItem("zcode-settings-last-section", "archives");
  sessionStorage.setItem("zcode-settings-section-intent", "shares");
  expect(consumeInitialSettingsSection()).toBe("archives");
  expect(sessionStorage.getItem("zcode-settings-section-intent")).toBeNull();
});
