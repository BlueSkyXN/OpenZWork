import { describe, expect, it } from "vitest";
import { createDefaultSystemPromptSettings } from "@zcode/shared";
import { createContextBuilder } from "../src/context/builder.js";
import { getSystemPromptCatalog } from "../src/context/prompt-settings/contract.js";

const base = {
  workingDirectory: "/fixture",
  envInfo: {
    cwd: "/fixture",
    platform: "linux",
    shell: "bash",
    osVersion: "test",
    nodeVersion: "24",
    isGitRepository: false,
  },
  currentDate: "2026-10-24",
  presentationSurface: "zcode_desktop" as const,
  userInstructions: {
    filePath: "/fixture/AGENTS.md",
    fileName: "AGENTS.md",
    content: "PROJECT_RULE",
    bytesRead: 12,
    sizeBytes: 12,
    truncated: false,
  },
};
const system = (result: ReturnType<ReturnType<typeof createContextBuilder>["build"]>) =>
  result.systemMessages.map((message) => message.content).join("\n");

describe("main session prompt customization", () => {
  it("leaves the entire default result byte-identical", () => {
    expect(
      createContextBuilder({
        ...base,
        systemPromptSettings: createDefaultSystemPromptSettings(),
      }).build(),
    ).toEqual(createContextBuilder(base).build());
  });
  it("replaces a role, appends communication and independently disables persistent-work guidance", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections = {
      role: { mode: "replace", content: "CUSTOM_ROLE" },
      communication: { mode: "append", content: "CUSTOM_COMMUNICATION" },
      persistence: { mode: "disabled", content: "" },
    };
    const result = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
    expect(system(result)).toContain("CUSTOM_ROLE");
    expect(system(result)).not.toContain("You are an interactive ZCode agent");
    expect(system(result)).toContain("CUSTOM_COMMUNICATION");
    expect(system(result)).toContain("# Harness");
    expect(system(result)).toContain("# Environment");
    expect(system(result)).not.toContain("You are operating autonomously");
    expect(result.metaUserAttachments).toEqual(
      createContextBuilder(base).build().metaUserAttachments,
    );
  });
  it("replaces all system content while retaining user instructions and date", () => {
    const settings = {
      ...createDefaultSystemPromptSettings(),
      mode: "replace" as const,
      replacement: "ONLY_CUSTOM_SYSTEM",
    };
    const result = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
    expect(system(result)).toBe("ONLY_CUSTOM_SYSTEM");
    expect(result.metaUserAttachments).toEqual(
      createContextBuilder(base).build().metaUserAttachments,
    );
  });
  it("honors generated-section switches and preserves conditions for absent features", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections = {
      memory: { mode: "replace", content: "MEMORY_CUSTOM" },
      session_guidance: { mode: "append", content: "SKILL_CUSTOM" },
      env_info: { mode: "disabled", content: "" },
    };
    const result = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
    expect(system(result)).not.toContain("MEMORY_CUSTOM");
    expect(system(result)).not.toContain("SKILL_CUSTOM");
    expect(system(result)).not.toContain("# Environment");
    const enabled = createContextBuilder({
      ...base,
      systemPromptSettings: settings,
      memoryRoot: "/fixture/memory",
    }).build();
    expect(system(enabled)).toContain("MEMORY_CUSTOM");
  });
  it("does not apply main-session settings to workflow actors or legacy custom prompts", () => {
    const settings = {
      ...createDefaultSystemPromptSettings(),
      mode: "replace" as const,
      replacement: "MAIN_ONLY",
    };
    for (const context of [
      { workflowActor: { name: "reviewer" } },
      { customSystemPrompt: "LEGACY" },
    ]) {
      expect(
        createContextBuilder({ ...base, ...context, systemPromptSettings: settings }).build(),
      ).toEqual(createContextBuilder({ ...base, ...context }).build());
    }
  });
  it("exports actual defaults and marks generated context without exposing user data", () => {
    const catalog = getSystemPromptCatalog();
    expect(new Set(catalog.sections.map((entry) => entry.id)).size).toBe(17);
    const defaults = system(createContextBuilder(base).build());
    for (const id of [
      "role",
      "security",
      "harness",
      "communication",
      "execution",
      "context_management",
      "persistence",
    ]) {
      expect(defaults).toContain(catalog.sections.find((entry) => entry.id === id)?.content);
    }
    expect(catalog.sections.find((entry) => entry.id === "env_info")?.generated).toBe(true);
  });
  it("resolves template paths and appends custom chapters exactly once", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections.memory = { mode: "replace", content: "Memory directory: {{memoryRoot}}" };
    settings.customSections = [{ id: "notes", title: "Notes", content: "EXTRA_RULE" }];
    const result = createContextBuilder({
      ...base,
      memoryRoot: "/fixture/memory",
      systemPromptSettings: settings,
    }).build();
    expect(system(result)).toContain("Memory directory: /fixture/memory");
    expect(system(result).match(/EXTRA_RULE/g)).toHaveLength(1);
    expect(system(result).endsWith("EXTRA_RULE")).toBe(true);
    for (const section of result.sections) expect(section.chars).toBe(section.content.length);
  });
});
