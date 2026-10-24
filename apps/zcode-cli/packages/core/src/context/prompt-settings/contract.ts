import {
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  SYSTEM_PROMPT_SECTION_IDS,
  resolveSystemPromptSection,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "@zcode/shared";
import type { ContextBuilderConfig, ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import { buildCliPrefixSection } from "../sections/cli-prefix.js";
import { buildRolePrompt, buildSecurityNotice, buildHarnessBlock } from "../sections/identity.js";
import { buildDesktopContextSection } from "../sections/desktop.js";
import { buildMemorySection } from "../sections/memory.js";
import { ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH } from "../../memory/project-memory-retrieval-branch.js";
import {
  getCommunicationPrompt,
  getExecutionPrompt,
  getContextManagementPrompt,
  getPersistencePrompt,
  buildSessionGuidanceSection,
} from "../dynamic-sections.js";

export function getSystemPromptCatalog(): SystemPromptCatalog {
  const defaults: Partial<Record<(typeof SYSTEM_PROMPT_SECTION_IDS)[number], string>> = {
    cli_prefix: buildCliPrefixSection().content,
    role: buildRolePrompt(),
    security: buildSecurityNotice(),
    harness: buildHarnessBlock(),
    desktop_context: buildDesktopContextSection("{{genUiOutputDirectory}}").content.replace(
      '"{{genUiOutputDirectory}}"',
      "{{genUiOutputDirectory}}",
    ),
    communication: getCommunicationPrompt(),
    execution: getExecutionPrompt(),
    session_guidance: buildSessionGuidanceSection(["Skill"], true)?.content ?? "",
    memory:
      buildMemorySection("{{memoryRoot}}", ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH)?.content ?? "",
    context_management: getContextManagementPrompt(),
    persistence: getPersistencePrompt(),
  };
  return {
    version: 1,
    sections: SYSTEM_PROMPT_SECTION_IDS.map((id) => ({
      id,
      content: defaults[id] ?? "",
      generated: GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id),
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
  context: Pick<ContextBuilderConfig, "memoryRoot" | "genUiOutputDirectory">,
): ContextSection[] {
  if (!settings) return sections;
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
      ...sections.filter((section) => section.injectionTarget === "meta_user"),
    ];
  }
  const variables = {
    memoryRoot: context.memoryRoot ?? "",
    genUiOutputDirectory: JSON.stringify(context.genUiOutputDirectory ?? ""),
  };
  const result = sections
    .map((section) => {
      const id = SYSTEM_PROMPT_SECTION_IDS.find((id) => id === section.source);
      // identity/dynamic_behavior/context_management 的子章在各自 builder 中解析。
      if (!id || id === "context_management") return section;
      return withContent(
        section,
        resolveSystemPromptSection(settings, id, section.content, variables),
      );
    })
    .filter((section) => section.content.trim().length > 0);
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
