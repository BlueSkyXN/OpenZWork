import { describe, expect, it } from "vitest";
import {
  createDefaultSystemPromptSettings,
  resolveSystemPromptSection,
  systemPromptSettingsSchema,
} from "./contract.js";

describe("system prompt settings contract", () => {
  it("preserves default bytes and resolves only the selected chapter", () => {
    const settings = createDefaultSystemPromptSettings();
    expect(resolveSystemPromptSection(settings, "role", "\nDefault\n")).toBe("\nDefault\n");
    settings.sections.role = { mode: "append", content: "Custom" };
    expect(resolveSystemPromptSection(settings, "role", "Default")).toBe("Default\n\nCustom");
    expect(resolveSystemPromptSection(settings, "security", "Security")).toBe("Security");
    settings.sections.role.mode = "replace";
    expect(resolveSystemPromptSection(settings, "role", "Default")).toBe("Custom");
    settings.sections.role.mode = "disabled";
    expect(resolveSystemPromptSection(settings, "role", "Default")).toBe("");
  });
  it("rejects unsupported chapters, forged generated facts, and empty overrides", () => {
    const settings = createDefaultSystemPromptSettings();
    for (const sections of [
      { unknown: { mode: "replace", content: "x" } },
      { env_info: { mode: "replace", content: "false cwd" } },
      { role: { mode: "append", content: " " } },
    ])
      expect(systemPromptSettingsSchema.safeParse({ ...settings, sections }).success).toBe(false);
    expect(systemPromptSettingsSchema.safeParse({ ...settings, mode: "replace" }).success).toBe(
      false,
    );
    expect(
      systemPromptSettingsSchema.safeParse({ ...settings, replacement: "x".repeat(64_001) })
        .success,
    ).toBe(false);
  });
  it("substitutes documented variables without interpreting other syntax", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections.memory = { mode: "replace", content: "Use {{memoryRoot}}; {{anything}}" };
    expect(
      resolveSystemPromptSection(settings, "memory", "", { memoryRoot: "/fixture/memory" }),
    ).toBe("Use /fixture/memory; {{anything}}");
  });
});
