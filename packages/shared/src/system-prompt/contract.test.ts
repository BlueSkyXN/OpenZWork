import { describe, expect, it } from "vitest";
import {
  createDefaultSystemPromptSettings,
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  resolveSystemPromptSection,
  SYSTEM_PROMPT_SECTION_IDS,
  systemPromptSettingsSchema,
  resolveSystemPromptRuntimeSection,
  systemPromptCatalogSchema,
  type SystemPromptCatalog,
} from "./contract.js";
import {
  createSystemPromptReplacement,
  mergeSystemPromptProfile,
  parseSystemPromptProfile,
} from "./profile.js";

describe("system prompt settings contract", () => {
  it("keeps runtime facts separate from rule overrides and respects availability", () => {
    const settings = createDefaultSystemPromptSettings();
    const template = {
      available: true,
      defaultContent: "ORIGINAL_DEFAULT",
      runtimeBefore: "CURRENT_CAPABILITY",
      runtimeAfter: "CURRENT_LOCATION",
      variables: {},
    };
    expect(resolveSystemPromptRuntimeSection(settings, "desktop_context", template)).toBe(
      "ORIGINAL_DEFAULT",
    );
    settings.sections.desktop_context = { mode: "replace", content: "RULE" };
    expect(resolveSystemPromptRuntimeSection(settings, "desktop_context", template)).toBe(
      "CURRENT_CAPABILITY\n\nRULE\n\nCURRENT_LOCATION",
    );
    settings.sections.desktop_context.mode = "disabled";
    expect(resolveSystemPromptRuntimeSection(settings, "desktop_context", template)).toBe(
      "CURRENT_CAPABILITY\n\nCURRENT_LOCATION",
    );
    expect(
      resolveSystemPromptRuntimeSection(settings, "desktop_context", {
        ...template,
        available: false,
      }),
    ).toBe("");
  });
  it("rejects old or malformed catalogs rather than presenting incomplete dynamic defaults", () => {
    expect(systemPromptCatalogSchema.safeParse({ version: 1, sections: [] }).success).toBe(false);
    expect(
      systemPromptCatalogSchema.safeParse({
        version: 2,
        sections: [
          {
            id: "memory",
            content: "",
            generated: false,
            runtime: true,
            injectionTarget: "system",
            scenarios: [{ id: "memory_enabled", template: { available: "yes" } }],
          },
        ],
      }).success,
    ).toBe(false);
  });
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
  it("registers finishing_work and memory_notes as editable rule chapters while keeping legacy sparse configs compatible", () => {
    expect(SYSTEM_PROMPT_SECTION_IDS).toHaveLength(19);
    expect(SYSTEM_PROMPT_SECTION_IDS.slice(11, 15)).toEqual([
      "context_management",
      "persistence",
      "finishing_work",
      "memory_notes",
    ]);
    expect(GENERATED_SYSTEM_PROMPT_SECTIONS).not.toContain("finishing_work");
    expect(GENERATED_SYSTEM_PROMPT_SECTIONS).not.toContain("memory_notes");

    // Legacy 17-chapter setting.json & Profile JSON omit finishing_work and memory_notes.
    const legacySettings = systemPromptSettingsSchema.parse({
      version: 1,
      mode: "sections",
      sections: { role: { mode: "append", content: "LEGACY_ROLE" } },
      replacement: "",
      customSections: [],
    });
    expect(resolveSystemPromptSection(legacySettings, "finishing_work", "# Finishing work")).toBe(
      "# Finishing work",
    );
    expect(
      resolveSystemPromptSection(legacySettings, "memory_notes", "# Memory, notes and feedback"),
    ).toBe("# Memory, notes and feedback");

    const catalog: SystemPromptCatalog = {
      version: 2,
      sections: SYSTEM_PROMPT_SECTION_IDS.map((id) => ({
        id,
        content: GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id) ? "" : `DEFAULT_${id.toUpperCase()}`,
        generated: GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id),
        runtime: ["desktop_context", "memory", "output_style"].includes(id),
        scenarios: [],
        injectionTarget: ["skills", "request_user_context", "current_date"].includes(id)
          ? "meta_user"
          : "system",
      })),
    };
    const legacyProfile = parseSystemPromptProfile(
      JSON.stringify({
        schema: "openzwork.system-prompt-profile",
        schemaVersion: 1,
        id: "legacy-v3",
        name: "Legacy v3 Profile",
        settings: legacySettings,
      }),
    );
    const merged = mergeSystemPromptProfile(
      createDefaultSystemPromptSettings(),
      legacyProfile,
      catalog,
    );
    expect(merged.sections.finishing_work).toBeUndefined();
    expect(merged.sections.memory_notes).toBeUndefined();

    const defaultReplacement = createSystemPromptReplacement(
      createDefaultSystemPromptSettings(),
      catalog,
    );
    expect(defaultReplacement.replacement).toContain("DEFAULT_FINISHING_WORK");
    expect(defaultReplacement.replacement).toContain("DEFAULT_MEMORY_NOTES");

    const customized = createDefaultSystemPromptSettings();
    customized.sections.finishing_work = { mode: "replace", content: "CUSTOM_FINISHING" };
    customized.sections.memory_notes = { mode: "disabled", content: "" };
    const currentReplacement = createSystemPromptReplacement(customized, catalog);
    expect(currentReplacement.replacement).toContain("CUSTOM_FINISHING");
    expect(currentReplacement.replacement).not.toContain("DEFAULT_FINISHING_WORK");
    expect(currentReplacement.replacement).not.toContain("DEFAULT_MEMORY_NOTES");
  });
});
