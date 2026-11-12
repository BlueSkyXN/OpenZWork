import { describe, expect, it } from "vitest";
import {
  createDefaultSystemPromptSettings,
  resolveSystemPromptRuntimeSection,
  systemPromptCatalogSchema,
} from "@zcode/shared";
import { createContextBuilder } from "../src/context/builder.js";
import { resolveAnnouncedOutputStyleInstructions } from "../src/runtime/methods/context-refresh.js";
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
    // OpenZWork v3.18.0：环境随运行时公告发送，不进 system。
    expect(system(result)).not.toContain("# Environment");
    expect(result.sections.some((section) => section.source === "env_info")).toBe(true);
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
    expect(system(result)).not.toContain("# Environment");
    expect(system(result)).not.toContain("# ZCode Desktop Context");
    expect(system(result)).not.toContain("# Harness");
    expect(system(result)).not.toContain("# Communicating with the user");
    // 运行时事实（环境/桌面能力/日期）是公告段，整段替换不丢。
    expect(result.sections.map((section) => section.source)).toEqual(
      expect.arrayContaining(["env_info", "desktop_context", "current_date"]),
    );
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
      const without = createContextBuilder({ ...base, systemPromptSettings: settings }).build();
      const withoutDesktop = without.sections.find(
        (section) => section.source === "desktop_context",
      );
      // 无目录时整段 Gen UI 上下文省略（上游 v3.18 语义），但能力段本身保留。
      expect(withoutDesktop?.injectionTarget).toBe("meta_user");
      expect(withoutDesktop?.content).not.toContain("This Desktop host supports Gen UI");
      expect(system(without)).not.toContain("# ZCode Desktop Context");
      const withDirectory = createContextBuilder({
        ...base,
        genUiOutputDirectory: "/example/second-views",
        systemPromptSettings: settings,
      }).build();
      const withDirectoryDesktop = withDirectory.sections.find(
        (section) => section.source === "desktop_context",
      );
      expect(withDirectoryDesktop?.content).toContain("This Desktop host supports Gen UI");
      // 目录本身随环境公告行发送（公告链注入），不进 Desktop 段，也不在 builder 的 env 段里。
      expect(withDirectoryDesktop?.content).not.toContain("/example/second-views");
      expect(
        createContextBuilder({
          ...base,
          presentationSurface: "terminal",
          systemPromptSettings: settings,
        })
          .build()
          .sections.some((section) => section.source === "desktop_context"),
      ).toBe(false);
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
    const style = { name: "Current style", prompt: "CURRENT_STYLE_RULE" };
    // v3.18.0 起输出样式正文随 output_style_instructions 公告送达；
    // 章节定制在公告侧消费，替换规则不挤掉当次活跃风格（运行时事实）。
    const announced = resolveAnnouncedOutputStyleInstructions(settings, style);
    expect(announced).toContain("EXTRA_STYLE_RULE");
    expect(announced).toContain("CURRENT_STYLE_RULE");
    const plain = resolveAnnouncedOutputStyleInstructions(undefined, style);
    expect(plain).toBe("# Output Style: Current style\nCURRENT_STYLE_RULE");
    expect(resolveAnnouncedOutputStyleInstructions(settings, undefined)).toBeNull();
    expect(
      createContextBuilder({ ...base, outputStyle: style, systemPromptSettings: settings })
        .build()
        .sections.some((section) => section.source === "output_style"),
    ).toBe(false);
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
    // 日期是独立公告段（current_date），不在指令 carrier 里。
    expect(result.sections.find((section) => section.source === "current_date")?.content).toBe(
      "Today's date is 2026-10-24.",
    );
    expect(JSON.stringify(result.metaUserAttachments)).not.toContain("2026-10-24");
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
        // v3.18.0 起目录不内嵌本段（随环境公告行发送），按 Gen UI 能力块判定。
        expect(actual.includes("This Desktop host supports Gen UI")).toBe(
          scenario.id === "gen_ui_available",
        );
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
    // Gen UI 目录随环境公告行发送，输出风格随 output_style_instructions 公告发送。
    const built = createContextBuilder({
      ...base,
      memoryRoot: "C:\\example\\memory",
      genUiOutputDirectory: "C:\\example\\views",
      outputStyle: { name: "Current", prompt: "CURRENT_STYLE" },
      systemPromptSettings: settings,
    }).build();
    expect(
      resolveAnnouncedOutputStyleInstructions(settings, {
        name: "Current",
        prompt: "CURRENT_STYLE",
      }),
    ).toContain("CURRENT_STYLE");
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
