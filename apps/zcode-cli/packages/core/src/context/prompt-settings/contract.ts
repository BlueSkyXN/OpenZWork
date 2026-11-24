import {
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  SYSTEM_PROMPT_SECTION_IDS,
  resolveSystemPromptSection,
  resolveSystemPromptRuntimeSection,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "@zcode/shared";
import type { ContextBuilderConfig, ContextSection } from "../types.js";
import type { AgentRuntimeConfig } from "../../runtime/types.js";
import { estimateTokens } from "../utils.js";
import { buildCliPrefixSection } from "../sections/cli-prefix.js";
import { buildRolePrompt, buildSecurityNotice, buildHarnessBlock } from "../sections/identity.js";
import { buildDesktopRules } from "../sections/desktop.js";
import { buildMemoryRules } from "../sections/memory.js";
import { getRuntimePromptTemplate, getPromptPreviewScenarios } from "./runtime-template.js";
import {
  getCommunicationPrompt,
  getExecutionPrompt,
  getContextManagementPrompt,
  getPersistencePrompt,
  buildFinishingWorkSection,
  buildMemoryNotesSection,
  buildSessionGuidanceSection,
} from "../dynamic-sections.js";

// OpenZWork(OZ-F002)：会话的规则、技能公告和快照复用共用同一设置作用域。
type PromptPreferenceConfig = Pick<
  AgentRuntimeConfig,
  "subagentContext" | "taskType" | "workflowActor" | "systemPrompt" | "systemPromptSettings"
>;

function usesMainSessionSettings(config: PromptPreferenceConfig): boolean {
  return (
    !config.subagentContext &&
    (config.taskType ?? "interactive") === "interactive" &&
    config.workflowActor === undefined &&
    !config.systemPrompt?.trim()
  );
}

export function mainSessionPromptSettings(
  config: PromptPreferenceConfig,
): SystemPromptSettings | undefined {
  return usesMainSessionSettings(config) ? config.systemPromptSettings : undefined;
}

export function mainSessionIncludesSkillsListing(config: PromptPreferenceConfig): boolean {
  return Boolean(resolveSystemPromptSection(mainSessionPromptSettings(config), "skills", "skills"));
}

export function promptSettingsCacheInput(config: PromptPreferenceConfig): string | undefined {
  if (!usesMainSessionSettings(config)) return undefined;
  const settings = config.systemPromptSettings;
  const whole = settings?.mode === "replace";
  const ids = whole ? GENERATED_SYSTEM_PROMPT_SECTIONS : SYSTEM_PROMPT_SECTION_IDS;
  const overrides = ids.flatMap((id) => {
    const rule = settings?.sections[id];
    if (!rule || rule.mode === "default") return [];
    return [[id, rule.mode, rule.mode === "disabled" ? "" : rule.content.trim()]];
  });
  // 编辑器的默认原文快照与对象键序都不影响请求；附加章节则按用户配置的顺序发送。
  return JSON.stringify([
    whole ? settings.replacement.trim() : null,
    overrides,
    whole ? [] : (settings?.customSections ?? []).map(({ title, content }) => [title, content]),
  ]);
}

export function getSystemPromptCatalog(): SystemPromptCatalog {
  const defaults: Partial<Record<(typeof SYSTEM_PROMPT_SECTION_IDS)[number], string>> = {
    cli_prefix: buildCliPrefixSection().content,
    role: buildRolePrompt(),
    security: buildSecurityNotice(),
    harness: buildHarnessBlock(),
    desktop_context: buildDesktopRules(),
    communication: getCommunicationPrompt(),
    execution: getExecutionPrompt(),
    session_guidance: buildSessionGuidanceSection(["Skill"], true)?.content ?? "",
    memory: buildMemoryRules(),
    context_management: getContextManagementPrompt(),
    persistence: getPersistencePrompt(),
    finishing_work: buildFinishingWorkSection().content,
    memory_notes: buildMemoryNotesSection().content,
  };
  return {
    version: 2,
    sections: SYSTEM_PROMPT_SECTION_IDS.map((id) => ({
      id,
      content: defaults[id] ?? "",
      generated: GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id),
      runtime: ["desktop_context", "memory", "output_style"].includes(id),
      scenarios: getPromptPreviewScenarios(id),
      injectionTarget: ["skills", "request_user_context", "current_date"].includes(id)
        ? "meta_user"
        : "system",
    })),
  };
}

function withContent(section: ContextSection, content: string): ContextSection {
  return {
    ...section,
    content,
    chars: content.length,
    tokens: estimateTokens(content),
    preview: content.slice(0, 100),
  };
}

/** 仅消费本次会话的设置快照；不修改调用方的 sections，也不读取持久化。 */
export function applySystemPromptSettings(
  sections: ContextSection[],
  settings: SystemPromptSettings | undefined,
  context: ContextBuilderConfig,
): ContextSection[] {
  if (!settings) return sections;
  const result = sections
    .map((section) => {
      const id = SYSTEM_PROMPT_SECTION_IDS.find((id) => id === section.source);
      const template = getRuntimePromptTemplate(section.source, context);
      if (id && template) {
        return withContent(section, resolveSystemPromptRuntimeSection(settings, id, template));
      }
      if (settings.mode === "replace") {
        if (id && GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id)) {
          return withContent(section, resolveSystemPromptSection(settings, id, section.content));
        }
        return withContent(section, section.injectionTarget === "meta_user" ? section.content : "");
      }
      // identity/dynamic_behavior/context_management 的子章在各自 builder 中解析。
      if (!id || id === "context_management") return section;
      return withContent(section, resolveSystemPromptSection(settings, id, section.content));
    })
    .filter((section) => section.content.trim().length > 0);
  if (settings.mode === "replace") {
    return [
      withContent(
        {
          name: "Custom System Prompt",
          source: "custom_system_prompt",
          injectionTarget: "system",
          cacheHint: "stable",
          chars: 0,
          tokens: 0,
          content: "",
          preview: "",
        },
        settings.replacement.trim(),
      ),
      ...result,
    ];
  }
  for (const custom of settings.customSections) {
    result.push(
      withContent(
        {
          name: custom.title,
          source: "user_prompt_section",
          injectionTarget: "system",
          cacheHint: "dynamic",
          chars: 0,
          tokens: 0,
          content: "",
          preview: "",
        },
        ["# " + custom.title, custom.content].join("\n\n"),
      ),
    );
  }
  return result;
}
