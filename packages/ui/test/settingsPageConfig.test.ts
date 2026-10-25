import { afterEach, describe, expect, it, vi } from "vitest";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import { isSettingsSectionAvailable } from "../src/settings/settingsPageConfig.js";

async function loadSettingsPageConfig(env: "test" | "production") {
  vi.resetModules();
  vi.doMock("@zcode/shared", async () => {
    const actual = await vi.importActual<typeof import("@zcode/shared")>("@zcode/shared");
    return {
      ...actual,
      ZCODE_ENV: env,
    };
  });
  return import("../src/settings/settingsPageConfig.js");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("settingsPageConfig", () => {
  it("only exposes remote device management on desktop", () => {
    expect(isSettingsSectionAvailable("remoteDevices", true)).toBe(true);
    expect(isSettingsSectionAvailable("remoteDevices", false)).toBe(false);
    expect(isSettingsSectionAvailable("remoteControl", true)).toBe(true);
    expect(isSettingsSectionAvailable("remoteControl", false)).toBe(false);
    expect(isSettingsSectionAvailable("remoteControl", true, false)).toBe(false);
    expect(isSettingsSectionAvailable("general", false)).toBe(true);
  });
  it("按设置页分组与顺序展示公开分区", async () => {
    const { createSettingsPageConfig } = await loadSettingsPageConfig("test");
    const { settingsSectionGroups, settingsSections } = createSettingsPageConfig({});
    expect(
      settingsSectionGroups.map((group) => ({
        id: group.id,
        sections: group.sections.map((section) => section.id),
      })),
    ).toEqual([
      {
        id: "basics",
        sections: [
          "general",
          "appearance",
          "modelProvider",
          "browser",
          "remoteDevices",
          "remoteControl",
          "shortcuts",
        ],
      },
      {
        id: "agentCapabilities",
        sections: ["memory", "subagents", "plugin", "mcp", "skill", "commands", "hooks"],
      },
      { id: "dataAndStats", sections: ["usage", "archives"] },
    ]);
    expect(settingsSections.map((section) => section.id)).toEqual([
      "general",
      "appearance",
      "modelProvider",
      "memory",
      "subagents",
      "plugin",
      "mcp",
      "skill",
      "commands",
      "hooks",
      "browser",
      "remoteDevices",
      "remoteControl",
      "shortcuts",
      "usage",
      "archives",
    ]);
  });

  it("Usage 分区文案和头像菜单使用统计入口保持一致", () => {
    expect(enUS["settings.usageTitle"]).toBe(enUS["sidebar.usage.plan.openStats"]);
    expect(enUS["settings.usage.sectionTitle"]).toBe(enUS["sidebar.usage.plan.openStats"]);
    expect(zhCN["settings.usageTitle"]).toBe(zhCN["sidebar.usage.plan.openStats"]);
  });

  it("侧栏分组标题同时提供中英文文案", () => {
    expect(enUS["settings.sidebar.group.basics"]).toBe("Basics");
    expect(enUS["settings.sidebar.group.agentCapabilities"]).toBe("Agent capabilities");
    expect(enUS["settings.sidebar.group.dataAndStats"]).toBe("Data and statistics");
    expect(zhCN["settings.sidebar.group.basics"]).toBe("基础设置");
    expect(zhCN["settings.sidebar.group.agentCapabilities"]).toBe("Agent 能力");
    expect(zhCN["settings.sidebar.group.dataAndStats"]).toBe("数据与统计");
  });
});
