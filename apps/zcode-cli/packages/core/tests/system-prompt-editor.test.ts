import { describe, expect, it } from "vitest";
import {
  createDefaultSystemPromptSettings,
  exportSystemPromptProfile,
  mergeSystemPromptProfile,
  parseSystemPromptProfile,
  systemPromptProfileSchema,
} from "@zcode/shared";
import { getSystemPromptCatalog } from "../src/context/prompt-settings/contract.js";
import { createContextBuilder } from "../src/context/builder.js";

const catalog = getSystemPromptCatalog();
function profile() {
  return {
    schema: "openzwork.system-prompt-profile" as const,
    schemaVersion: 1 as const,
    id: "fixture",
    name: "Fixture",
    settings: {
      ...createDefaultSystemPromptSettings(),
      sections: { role: { mode: "replace" as const, content: "PROFILE_ROLE", baseContent: "OLD" } },
    },
  };
}

describe("portable prompt settings applied to runtime", () => {
  it("PP01/05/06 preserves unrelated raw drafts and refreshes only imported defaults", () => {
    const draft = createDefaultSystemPromptSettings();
    draft.sections.communication = { mode: "append", content: "  UNSAVED\n", baseContent: "PRIOR" };
    draft.customSections = [{ id: "notes", title: "  Notes  ", content: "  Keep bytes\n" }];
    const before = structuredClone(draft);
    const next = mergeSystemPromptProfile(draft, profile(), catalog);
    expect(draft).toEqual(before);
    expect(next.sections.communication).toEqual(before.sections.communication);
    expect(next.customSections).toEqual(before.customSections);
    expect(next.sections.role?.baseContent).toBe(
      catalog.sections.find((x) => x.id === "role")?.content,
    );
    const built = createContextBuilder({
      workingDirectory: "/example/project",
      envInfo: {
        cwd: "/example/project",
        platform: "linux",
        shell: "bash",
        osVersion: "test",
        nodeVersion: "24",
      },
      systemPromptSettings: next,
    }).build();
    expect(JSON.stringify(built.systemMessages)).toContain("PROFILE_ROLE");
    expect(JSON.stringify(built.systemMessages)).toContain("UNSAVED");
  });

  it("PP04 replaces custom IDs in position, appends new IDs, and rejects merged overflow atomically", () => {
    const draft = createDefaultSystemPromptSettings();
    draft.customSections = [
      { id: "a", title: "A", content: "one" },
      { id: "b", title: "B", content: "two" },
    ];
    const incoming = profile();
    incoming.settings.customSections = [
      { id: "b", title: "Updated", content: "new" },
      { id: "c", title: "C", content: "three" },
    ];
    expect(
      mergeSystemPromptProfile(draft, incoming, catalog).customSections.map((x) => x.id),
    ).toEqual(["a", "b", "c"]);
    draft.customSections = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      title: "A",
      content: "a".repeat(32_000),
    }));
    incoming.settings.customSections = Array.from({ length: 3 }, (_, i) => ({
      id: `b${i}`,
      title: "B",
      content: "b".repeat(32_000),
    }));
    expect(() => systemPromptProfileSchema.parse(incoming)).not.toThrow();
    expect(() => mergeSystemPromptProfile(draft, incoming, catalog)).toThrow();
    expect(draft.customSections).toHaveLength(6);
  });

  it("PP02/03 rejects forged generated content and retains the mode/replacement pair", () => {
    const incoming = profile();
    incoming.settings.mode = "replace";
    incoming.settings.replacement = "WHOLE";
    const next = mergeSystemPromptProfile(createDefaultSystemPromptSettings(), incoming, catalog);
    expect(next.mode).toBe("replace");
    expect(next.replacement).toBe("WHOLE");
    expect(
      systemPromptProfileSchema.safeParse({
        ...incoming,
        settings: {
          ...incoming.settings,
          sections: { env_info: { mode: "replace", content: "fake" } },
        },
      }).success,
    ).toBe(false);
  });

  it("PP06 exports a portable copy without mutating the draft", () => {
    const draft = mergeSystemPromptProfile(createDefaultSystemPromptSettings(), profile(), catalog);
    const result = exportSystemPromptProfile(draft, { id: "copy", name: "Copy" });
    expect(JSON.stringify(result)).not.toContain("baseContent");
    expect(draft.sections.role?.baseContent).toBeDefined();
    const reimported = mergeSystemPromptProfile(
      createDefaultSystemPromptSettings(),
      result,
      catalog,
    );
    expect(exportSystemPromptProfile(reimported, { id: "copy", name: "Copy" })).toEqual(result);
  });

  it("PP03/04/05 rejects invalid untouched drafts and a thirteenth merged section without mutation", () => {
    const draft = createDefaultSystemPromptSettings();
    draft.customSections = [{ id: "invalid", title: "Draft", content: "  " }];
    const invalid = structuredClone(draft);
    expect(() => mergeSystemPromptProfile(draft, profile(), catalog)).toThrow();
    expect(draft).toEqual(invalid);
    draft.customSections = Array.from({ length: 12 }, (_, i) => ({
      id: `section${i}`,
      title: "Draft",
      content: "Text",
    }));
    const incoming = profile();
    incoming.settings.customSections = [{ id: "extra", title: "Extra", content: "Text" }];
    expect(() => mergeSystemPromptProfile(draft, incoming, catalog)).toThrow();
    expect(draft.customSections).toHaveLength(12);
    expect(
      systemPromptProfileSchema.safeParse({
        ...incoming,
        settings: {
          ...incoming.settings,
          sections: { role: { mode: "replace", content: "x".repeat(32_001) } },
        },
      }).success,
    ).toBe(false);
    expect(
      systemPromptProfileSchema.safeParse({
        ...incoming,
        settings: { ...incoming.settings, mode: "replace", replacement: "" },
      }).success,
    ).toBe(false);
  });

  it("PP14/15 accepts complete UTF-8 JSON beyond 256 KiB and enforces the file byte limit", () => {
    const incoming = profile();
    incoming.settings.customSections = Array.from({ length: 4 }, (_, i) => ({
      id: `chinese${i}`,
      title: "示例",
      content: "中文说明".repeat(8_000),
    }));
    const text = JSON.stringify(incoming);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(256 * 1024);
    expect(parseSystemPromptProfile(`\uFEFF${text}`)).toEqual(incoming);
    expect(() => parseSystemPromptProfile(" ".repeat(2 * 1024 * 1024) + text)).toThrow("2 MiB");
  });
});
