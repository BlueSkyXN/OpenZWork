// ============================================================
// Identity Section Builder
// ============================================================

import { resolveSystemPromptSection, type SystemPromptSettings } from "@zcode/shared";
import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

const SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

/** 安全 IMPORTANT 行：交互式身份与工作流子代理身份共用，逐字同一份。 */
export function buildSecurityNotice(): string {
  return SECURITY_NOTICE;
}

/**
 * `# Harness` 块：稳定运行时约束，不属于 output style 可替换的 coding instructions，
 * 也是工作流子代理身份（sections/workflow-actor.ts）逐字复用的那一段。
 */
export function buildHarnessBlock(midConversationSystem = true): string {
  return [
    "# Harness",
    "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
    "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
    "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
    "- Reference code as `file_path:line_number` \u2014 it's clickable.",
  ].join("\n");
}

export function buildRolePrompt(outputStyle?: OutputStylePromptConfig): string {
  return outputStyle
    ? "You respond to the user according to the active Output Style below while using ZCode's tools and instructions."
    : "You are an interactive ZCode agent that helps users with software engineering tasks.";
}

function buildIdentityPrompt(
  outputStyle?: OutputStylePromptConfig,
  settings?: SystemPromptSettings,
): string {
  const intro = resolveSystemPromptSection(settings, "role", buildRolePrompt(outputStyle));
  const security = resolveSystemPromptSection(settings, "security", SECURITY_NOTICE);
  const identityLines = ["", intro, "", security].join("\n");
  return [
    identityLines,
    "",
    resolveSystemPromptSection(settings, "harness", buildHarnessBlock()),
  ].join("\n");
}

export function buildIdentitySection(
  outputStyle?: OutputStylePromptConfig,
  settings?: SystemPromptSettings,
): ContextSection {
  const content = buildIdentityPrompt(outputStyle, settings);

  return {
    name: "Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
