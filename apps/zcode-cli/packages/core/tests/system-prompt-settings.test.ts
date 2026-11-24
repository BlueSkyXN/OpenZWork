import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "../../adapters/src/storage/session-store/sqlite-session-store.js";
import {
  createPartId,
  createSessionId,
  SESSION_ENTRY_PROMPT_SNAPSHOT,
  modelMessageContentToText,
  type ModelRequest,
  type SkillMetadata,
  type SkillPort,
} from "@zcode/contracts";
import {
  createDefaultSystemPromptSettings,
  createSystemPromptReplacement,
  DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
  mergeSystemPromptProfile,
  parseSystemPromptProfile,
  resolveSystemPromptRuntimeSection,
  systemPromptCatalogSchema,
  systemPromptDocumentText,
  systemPromptSettingsSchema,
} from "@zcode/shared";
import { createContextBuilder } from "../src/context/builder.js";
import { buildSystemPromptPreview } from "../src/context/prompt-settings/index.js";
import {
  buildRuntimeContextAnnouncements,
  resolveAnnouncedOutputStyleInstructions,
} from "../src/runtime/methods/context-refresh.js";
import { getSystemPromptCatalog } from "../src/context/prompt-settings/contract.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory, createTestRuntimeModel } from "./test-runtime-model.js";

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

const skillPath = "/example/skills/example-review/SKILL.md";
const skill: SkillMetadata = {
  name: "example-review",
  description: "Review an example change and report evidence.",
  path: skillPath,
  directory: "/example/skills/example-review",
  rootPath: "/example/skills",
  scope: "project",
  source: "agents",
  safeToAutoLoad: false,
  frontmatterKeys: ["name", "description"],
};
const skillPort: SkillPort = {
  async discoverSkills() {
    return { skills: [skill], diagnostics: [], totalDiscovered: 1 };
  },
  async loadSkill() {
    return { metadata: skill, content: "body" };
  },
};

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
    expect(new Set(catalog.sections.map((entry) => entry.id)).size).toBe(19);
    const defaults = system(createContextBuilder(base).build());
    for (const id of [
      "role",
      "security",
      "harness",
      "communication",
      "execution",
      "context_management",
      "persistence",
      "finishing_work",
      "memory_notes",
    ]) {
      expect(defaults).toContain(catalog.sections.find((entry) => entry.id === id)?.content);
    }
    expect(catalog.sections.find((entry) => entry.id === "env_info")?.generated).toBe(true);
    expect(catalog.sections.find((entry) => entry.id === "finishing_work")?.generated).toBe(false);
    expect(catalog.sections.find((entry) => entry.id === "memory_notes")?.generated).toBe(false);
    expect(catalog.sections.find((entry) => entry.id === "finishing_work")?.runtime).toBe(false);
    expect(catalog.sections.find((entry) => entry.id === "memory_notes")?.runtime).toBe(false);
  });
  it("customizes finishing_work and memory_notes independently, keeps memory_notes memoryRoot-independent, and covers whole-rule conversion and legacy configs", () => {
    const catalog = getSystemPromptCatalog();
    // Without memoryRoot: memory chapter stays absent, while memory_notes & finishing_work inject and customize.
    const withoutMemoryRoot = createDefaultSystemPromptSettings();
    withoutMemoryRoot.sections = {
      memory: { mode: "replace", content: "GATED_MEMORY_RULE" },
      finishing_work: { mode: "append", content: "APPENDED_FINISHING_RULE" },
      memory_notes: { mode: "replace", content: "REPLACED_MEMORY_NOTES_RULE" },
    };
    const noRootBuilt = system(
      createContextBuilder({ ...base, systemPromptSettings: withoutMemoryRoot }).build(),
    );
    expect(noRootBuilt).not.toContain("GATED_MEMORY_RULE");
    expect(noRootBuilt).toContain("# Finishing work");
    expect(noRootBuilt).toContain("APPENDED_FINISHING_RULE");
    expect(noRootBuilt).toContain("REPLACED_MEMORY_NOTES_RULE");
    expect(noRootBuilt).not.toContain("# Memory, notes and feedback");

    // Disabling finishing_work and memory_notes omits only those two chapters, even when memoryRoot is enabled.
    const disabled = createDefaultSystemPromptSettings();
    disabled.sections = {
      finishing_work: { mode: "disabled", content: "" },
      memory_notes: { mode: "disabled", content: "" },
    };
    const withMemoryRoot = system(
      createContextBuilder({
        ...base,
        memoryRoot: "/fixture/memory",
        systemPromptSettings: disabled,
      }).build(),
    );
    expect(withMemoryRoot).toContain("/fixture/memory/");
    expect(withMemoryRoot).not.toContain("# Finishing work");
    expect(withMemoryRoot).not.toContain("# Memory, notes and feedback");

    // Preview with scenario.memory=false still includes default memory_notes unless disabled/replaced.
    const previewWithoutMemory = systemPromptDocumentText(
      buildSystemPromptPreview({
        settings: createDefaultSystemPromptSettings(),
        scenario: { ...DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO, memory: false },
      }).after,
    );
    expect(previewWithoutMemory).toContain("# Finishing work");
    expect(previewWithoutMemory).toContain("# Memory, notes and feedback");
    expect(previewWithoutMemory).not.toContain("/example/memory");

    // createSystemPromptReplacement covers both chapters in catalog order, and whole replacement excludes section defaults.
    const convertedFromDefault = createSystemPromptReplacement(
      createDefaultSystemPromptSettings(),
      catalog,
    );
    expect(convertedFromDefault.replacement).toContain("# Finishing work");
    expect(convertedFromDefault.replacement).toContain("# Memory, notes and feedback");
    const convertedFromCustom = createSystemPromptReplacement(withoutMemoryRoot, catalog);
    expect(convertedFromCustom.replacement).toContain("APPENDED_FINISHING_RULE");
    expect(convertedFromCustom.replacement).toContain("REPLACED_MEMORY_NOTES_RULE");

    const wholeReplaced = system(
      createContextBuilder({
        ...base,
        systemPromptSettings: {
          ...createDefaultSystemPromptSettings(),
          mode: "replace",
          replacement: "WHOLE_ONLY_PROMPT",
        },
      }).build(),
    );
    expect(wholeReplaced).toContain("WHOLE_ONLY_PROMPT");
    expect(wholeReplaced).not.toContain("# Finishing work");
    expect(wholeReplaced).not.toContain("# Memory, notes and feedback");

    // Backward compatibility: legacy sparse setting.json and Profile JSON keep default finishing_work & memory_notes.
    const legacyParsed = systemPromptSettingsSchema.parse({
      version: 1,
      mode: "sections",
      sections: { communication: { mode: "append", content: "LEGACY_COMM" } },
      replacement: "",
      customSections: [],
    });
    const legacyMerged = mergeSystemPromptProfile(
      createDefaultSystemPromptSettings(),
      parseSystemPromptProfile(
        JSON.stringify({
          schema: "openzwork.system-prompt-profile",
          schemaVersion: 1,
          id: "legacy-profile",
          name: "Legacy",
          settings: legacyParsed,
        }),
      ),
      catalog,
    );
    const legacyBuilt = system(
      createContextBuilder({ ...base, systemPromptSettings: legacyMerged }).build(),
    );
    expect(legacyBuilt).toContain("LEGACY_COMM");
    expect(legacyBuilt).toContain("# Finishing work");
    expect(legacyBuilt).toContain("# Memory, notes and feedback");
  });
  it("scopes announced output_style overrides to interactive main sessions via mainSessionPromptSettings", () => {
    const settings = createDefaultSystemPromptSettings();
    settings.sections.output_style = { mode: "replace", content: "MAIN_ONLY_STYLE_RULE" };
    const style = { name: "Concise", prompt: "BASE_STYLE_PROMPT" };
    const model = createTestRuntimeModel({
      async generateText() {
        throw new Error("unused");
      },
    });
    const contextResult = createContextBuilder(base).build();

    const announceFor = (extraConfig: Record<string, unknown>) => {
      const runtime = createTestAgentRuntime(
        createSessionId(),
        {
          workingDirectory: base.workingDirectory,
          envInfo: base.envInfo,
          systemPromptSettings: settings,
          ...extraConfig,
        },
        {
          eventStore: createTestSessionEventStore(),
          modelFactory: createTestModelFactory({}),
        },
      );
      const attachments = buildRuntimeContextAnnouncements(runtime as never, [], {
        contextResult,
        environment: undefined,
        model,
        outputStyle: style,
      });
      return attachments.find((entry) => entry.metadata.source === "output_style_instructions")
        ?.content;
    };

    const mainAnnouncement = announceFor({});
    expect(mainAnnouncement).toContain("MAIN_ONLY_STYLE_RULE");
    expect(mainAnnouncement).toContain("BASE_STYLE_PROMPT");

    for (const nonMainConfig of [
      { systemPrompt: "LEGACY_CUSTOM_SYSTEM_PROMPT" },
      { workflowActor: { name: "reviewer" } },
      { subagentContext: { agentName: "Explore", agentPrompt: "Explore" } },
    ]) {
      const nonMainAnnouncement = announceFor(nonMainConfig);
      expect(nonMainAnnouncement).toBe("# Output Style: Concise\nBASE_STYLE_PROMPT");
      expect(nonMainAnnouncement).not.toContain("MAIN_ONLY_STYLE_RULE");
    }
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
  it.each([
    { mode: "sections" as const, skillsDisabled: true, expectSkills: false },
    { mode: "replace" as const, skillsDisabled: true, expectSkills: false },
    { mode: "sections" as const, skillsDisabled: false, expectSkills: true },
    { mode: "replace" as const, skillsDisabled: false, expectSkills: true },
  ])(
    "enforces skills announcement switch on real AgentRuntime requests in $mode mode (disabled=$skillsDisabled) while keeping Skill tool registered",
    async ({ mode, skillsDisabled, expectSkills }) => {
      const settings = {
        ...createDefaultSystemPromptSettings(),
        mode,
        ...(mode === "replace" ? { replacement: "CUSTOM_WHOLE_PROMPT" } : {}),
        sections: skillsDisabled
          ? { skills: { mode: "disabled" as const, content: "" } }
          : {},
      };
      const requests: ModelRequest[] = [];
      const runtime = createTestAgentRuntime(
        createSessionId(),
        {
          workingDirectory: base.workingDirectory,
          envInfo: base.envInfo,
          mode: "yolo",
          modelStreaming: "off",
          compact: { enabled: false },
          titleGeneration: { enabled: false },
          systemPromptSettings: settings,
        },
        {
          eventStore: createTestSessionEventStore(),
          skillPort,
          modelFactory: createTestModelFactory({
            async generateText(request) {
              requests.push(request);
              return {
                finishReason: "stop",
                text: "DONE",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            },
          }),
        },
      );
      await runtime.executeTurn("Check available skills");
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.tools?.map((tool) => tool.name)).toContain("Skill");
      const sentText = request.messages
        .map((message) => modelMessageContentToText(message.content))
        .join("\n");
      const previewText = systemPromptDocumentText(
        buildSystemPromptPreview({
          settings,
          scenario: DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
        }).after,
      );
      expect(previewText.includes("The following skills are available")).toBe(expectSkills);
      expect(sentText.includes("The following skills are available")).toBe(expectSkills);
      expect(sentText.includes(skillPath)).toBe(expectSkills);
      expect(sentText.includes("example-review")).toBe(expectSkills);
    },
  );
  it.each(["sections", "replace"] as const)(
    "reloads saved %s rules and projects historical skill announcements from SQLite",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "openzwork-prompt-reload-"));
      const dbPath = join(directory, "session.sqlite");
      const sessionId = createSessionId();
      async function runTurn(rule: string, listing: boolean, resume: boolean) {
        const settings = createDefaultSystemPromptSettings();
        settings.mode = mode;
        if (mode === "replace") settings.replacement = rule;
        else settings.sections.role = { mode: "replace", content: rule };
        if (!listing) settings.sections.skills = { mode: "disabled", content: "" };
        const store = await createSqliteSessionStore({ dbPath });
        const requests: ModelRequest[] = [];
        try {
          const runtime = createTestAgentRuntime(
            sessionId,
            {
              workingDirectory: directory,
              envInfo: base.envInfo,
              systemPromptSettings: settings,
              modelStreaming: "off",
              titleGeneration: { enabled: false },
              compact: { enabled: false },
            },
            {
              sessionStore: store,
              eventStore: createTestSessionEventStore(),
              skillPort,
              modelFactory: createTestModelFactory({
                async generateText(request) {
                  requests.push(request);
                  return {
                    finishReason: "stop",
                    text: "DONE",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  };
                },
              }),
            },
          );
          if (resume) await runtime.resumeFromStore();
          await runtime.executeTurn(resume ? "continue" : "original user message");
          expect(requests).toHaveLength(1);
          const request = requests[0]!;
          const messages = request.messages.map((m) => modelMessageContentToText(m.content));
          expect(messages.join("\n")).toContain("original user message");
          expect(request.tools?.some((tool) => tool.name === "Skill")).toBe(true);
          const transcript = await store.messages({ sessionID: sessionId });
          const listings = transcript
            .flatMap((row) => row.parts)
            .filter(
              (part) => part.type === "text" && part.synthetic && part.text.includes(skillPath),
            );
          expect(listings).toHaveLength(1);
          if (!listing) expect(messages.join("\n")).not.toContain("LEGACY_SKILL_ANNOUNCEMENT");
          return {
            system: request.messages
              .filter((m) => m.role === "system")
              .map((m) => modelMessageContentToText(m.content))
              .join("\n"),
            announcements: messages.filter((text) => text.includes(skillPath)).length,
          };
        } finally {
          await store.close();
        }
      }
      try {
        expect((await runTurn("ROLE_BEFORE_SAVE", true, false)).announcements).toBe(1);
        const firstStore = await createSqliteSessionStore({ dbPath });
        try {
          const original = (await firstStore.messages({ sessionID: sessionId })).find((row) =>
            row.parts.some((part) => part.type === "text" && part.text === "original user message"),
          );
          await firstStore.savePart({
            id: createPartId(),
            messageID: original!.info.id,
            sessionID: sessionId,
            type: "text",
            synthetic: true,
            text: "<system-reminder>LEGACY_SKILL_ANNOUNCEMENT</system-reminder>",
            metadata: { runtimeMessage: { source: "skills_listing" } },
          });
        } finally {
          await firstStore.close();
        }
        const restarted = await runTurn("ROLE_AFTER_SAVE", false, true);
        expect(restarted.announcements).toBe(0);
        expect(restarted.system).toContain("ROLE_AFTER_SAVE");
        expect(restarted.system).not.toContain("ROLE_BEFORE_SAVE");
        expect((await runTurn("ROLE_AFTER_SAVE", true, true)).announcements).toBe(1);

        // 模拟旧程序渲染过的 system：设置相同应复用字节，缺失设置标识的旧记录应按当前规则重建。
        async function seedSnapshot(systemText: string, legacy: boolean) {
          const store = await createSqliteSessionStore({ dbPath });
          try {
            const [entry] = await store.sessionEntries({
              sessionID: sessionId,
              type: SESSION_ENTRY_PROMPT_SNAPSHOT,
            });
            const saved = entry!.data as { model: unknown; settingsHash?: string };
            expect(saved.settingsHash).toEqual(expect.any(String));
            await store.saveSessionEntry({
              ...entry!,
              data: {
                model: saved.model,
                system: [{ role: "system", content: systemText }],
                ...(legacy ? {} : { settingsHash: saved.settingsHash }),
              },
            });
          } finally {
            await store.close();
          }
        }
        await seedSnapshot("CACHED_RULE_FROM_PRIOR_BUILD", false);
        expect((await runTurn("ROLE_AFTER_SAVE", true, true)).system).toContain(
          "CACHED_RULE_FROM_PRIOR_BUILD",
        );
        await seedSnapshot("LEGACY_RULE_WITHOUT_SETTINGS", true);
        expect((await runTurn("ROLE_AFTER_SAVE", true, true)).system).toContain("ROLE_AFTER_SAVE");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
