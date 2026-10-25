import { describe, expect, it } from "vitest";
import {
  createDefaultSystemPromptSettings,
  resolveSystemPromptRuntimeSection,
  systemPromptCatalogSchema,
} from "@zcode/shared";
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
  it("replaces behavior rules while retaining runtime facts, user instructions and date", () => {
    const settings = {
      ...createDefaultSystemPromptSettings(),
      mode: "replace" as const,
      replacement: "ONLY_CUSTOM_SYSTEM",
    };
    const result = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
    expect(system(result)).toContain("ONLY_CUSTOM_SYSTEM");
    expect(system(result)).toContain("# Environment");
    expect(system(result)).toContain("Gen UI is unavailable");
    expect(system(result)).not.toContain("# Harness");
    expect(system(result)).not.toContain("# Communicating with the user");
    expect(result.metaUserAttachments).toEqual(
      createContextBuilder(base).build().metaUserAttachments,
    );
  });
  it.each(["default", "append", "replace", "disabled"] as const)(
    "keeps desktop capability live in %s mode",
    (mode) => {
      const settings = createDefaultSystemPromptSettings();
      const content = getSystemPromptCatalog().sections.find(
        (entry) => entry.id === "desktop_context",
      )!.content;
      settings.sections.desktop_context = { mode, content };
      const without = system(
        createContextBuilder({ ...base, systemPromptSettings: settings }).build(),
      );
      expect(without).toContain("Gen UI is unavailable");
      expect(without).not.toContain("This Desktop host supports Gen UI");
      expect(without).not.toContain('directory for this session: ""');
      const withDirectory = system(
        createContextBuilder({
          ...base,
          genUiOutputDirectory: "/example/second-views",
          systemPromptSettings: settings,
        }).build(),
      );
      expect(withDirectory).toContain("This Desktop host supports Gen UI");
      expect(withDirectory).toContain('"/example/second-views"');
      expect(withDirectory).not.toContain("Gen UI is unavailable");
      expect(
        system(
          createContextBuilder({
            ...base,
            presentationSurface: "terminal",
            systemPromptSettings: settings,
          }).build(),
        ),
      ).not.toContain("# ZCode Desktop Context");
    },
  );
  it.each(["replace", "disabled"] as const)(
    "keeps memory location and retrieval rules when rules are %s",
    (mode) => {
      const settings = createDefaultSystemPromptSettings();
      settings.sections.memory = { mode, content: "MY_MEMORY_RULE" };
      const result = system(
        createContextBuilder({
          ...base,
          memoryRoot: "/example/current-memory",
          systemPromptSettings: settings,
        }).build(),
      );
      expect(result).toContain("/example/current-memory/");
      expect(result).toContain("MEMORY.md");
      expect(result.includes("MY_MEMORY_RULE")).toBe(mode === "replace");
      expect(
        system(createContextBuilder({ ...base, systemPromptSettings: settings }).build()),
      ).not.toContain("MY_MEMORY_RULE");
    },
  );
  it("keeps the active output style live when its extra rules are replaced", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections.output_style = { mode: "replace", content: "EXTRA_STYLE_RULE" };
    const result = system(
      createContextBuilder({
        ...base,
        outputStyle: { name: "Current style", prompt: "CURRENT_STYLE_RULE" },
        systemPromptSettings: settings,
      }).build(),
    );
    expect(result).toContain("EXTRA_STYLE_RULE");
    expect(result).toContain("CURRENT_STYLE_RULE");
  });
  it("honors generated switches in whole replacement mode", () => {
    const settings = {
      ...createDefaultSystemPromptSettings(),
      mode: "replace" as const,
      replacement: "CUSTOM",
    };
    settings.sections.env_info = { mode: "disabled", content: "" };
    settings.sections.request_user_context = { mode: "disabled", content: "" };
    const result = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
    expect(system(result)).not.toContain("# Environment");
    expect(JSON.stringify(result.metaUserAttachments)).not.toContain("PROJECT_RULE");
    expect(JSON.stringify(result.metaUserAttachments)).toContain("2026-10-24");
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
    const catalog = systemPromptCatalogSchema.parse(getSystemPromptCatalog());
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
  it.each(["default", "append", "replace", "disabled"] as const)(
    "uses the same desktop preview and runtime result in %s mode",
    (mode) => {
      const entry = getSystemPromptCatalog().sections.find(
        (item) => item.id === "desktop_context",
      )!;
      const settings = createDefaultSystemPromptSettings();
      settings.sections.desktop_context = { mode, content: "CUSTOM_DESKTOP_RULE" };
      for (const scenario of entry.scenarios) {
        const context = {
          ...base,
          presentationSurface:
            scenario.id === "terminal" ? ("terminal" as const) : ("zcode_desktop" as const),
          genUiOutputDirectory: scenario.id === "gen_ui_available" ? "/example/views" : undefined,
          systemPromptSettings: settings,
        };
        const actual =
          createContextBuilder(context)
            .build()
            .sections.find((item) => item.source === "desktop_context")?.content ?? "";
        expect(actual).toBe(
          resolveSystemPromptRuntimeSection(settings, entry.id, scenario.template),
        );
        expect(actual.includes("/example/views")).toBe(scenario.id === "gen_ui_available");
      }
    },
  );
  it("keeps current memory and style in whole replacement without carrying editable chapters", () => {
    const settings = {
      ...createDefaultSystemPromptSettings(),
      mode: "replace" as const,
      replacement: "CUSTOM_MAIN",
    };
    settings.customSections = [{ id: "ignored", title: "Notes", content: "CHAPTER_ONLY" }];
    settings.sections.memory = { mode: "replace", content: "CHAPTER_MEMORY_RULE" };
    const result = system(
      createContextBuilder({
        ...base,
        memoryRoot: "C:\\example\\memory",
        genUiOutputDirectory: "C:\\example\\views",
        outputStyle: { name: "Current", prompt: "CURRENT_STYLE" },
        systemPromptSettings: settings,
      }).build(),
    );
    expect(result).toContain("C:\\example\\memory/");
    expect(result).toContain(JSON.stringify("C:\\example\\views"));
    expect(result).toContain("CURRENT_STYLE");
    expect(result).not.toContain("CHAPTER_ONLY");
    expect(result).not.toContain("CHAPTER_MEMORY_RULE");
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
