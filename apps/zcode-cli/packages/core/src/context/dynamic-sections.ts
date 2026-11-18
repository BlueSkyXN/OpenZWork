import { resolveSystemPromptSection, type SystemPromptSettings } from "@zcode/shared";
import type { ContextBuilderConfig, ContextSection } from "./types.js";
import { TOTAL_TOKENS_SYSTEM_LINE } from "./total-tokens.js";
import { estimateTokens } from "./utils.js";

const COMMUNICATION_PROMPTS = {
  default:
    "Write code that reads like the surrounding code: match its comment density, naming, and idiom.",
  additional: {
    beforeDefault: [
      "# Communicating with the user",
      "",
      "Your text output is what the user reads; they usually can't see your thinking or the raw tool results. Write it for a teammate who stepped away and is catching up, not for a log file: they don't know the codenames or shorthand you created along the way, and they didn't watch your process unfold. Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.",
      "",
      "Text you write between tool calls may not be shown to the user. Everything the user needs from this turn \u2014 answers, summaries, findings, conclusions, deliverables \u2014 must be in the final text message of your turn, with no tool calls after it. Keep text between tool calls to brief status notes. If something important appeared only mid-turn or in your thinking, restate it in that final message.",
      "",
      'Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find" \u2014 the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after, for readers who want them.',
      "",
      "Being readable and being concise are different things, and readable matters more. If the user has to reread your summary or ask you to explain, any time saved by brevity is gone. The way to keep output short is to be selective about what you include (drop details that don't change what the reader would do next), not to compress the writing into fragments, abbreviations, arrow chains like `A \u2192 B \u2192 fails`, or jargon. What you do include, write in complete sentences with the technical terms spelled out. Don't make the reader cross-reference labels or numbering you invented earlier; say what you mean in place.",
      "",
      "Match the response to the question: a simple question gets a direct answer in prose, not headers and sections. Use tables only for short enumerable facts, with explanations in the surrounding prose rather than the cells. Calibrate to the user \u2014 a bit tighter for an expert, more explanatory for someone newer.",
    ].join("\n"),
    afterDefault:
      "Only write a code comment to state a constraint the code itself can't show \u2014 never to say where it came from, what the next line does, or why your change is correct; that's you talking to the reviewer, not the next reader, and it's noise the moment the PR merges.",
  },
} as const;

const CONTEXT_MANAGEMENT_PROMPTS = {
  default: [
  "# Context management",
  "When the conversation grows long, some or all of the current context is summarized; the summary, along with any remaining unsummarized context, is provided in the next context window so work can continue — you don't need to wrap up early or hand off mid-task.",
  ].join("\n"),
  // OpenZWork v3.18.0 同步裁定：persistence 段只保留 act-dont-rederive 一行；
  // 原 autonomy 四段（自主运行/例外/收尾检查/系统状态命令）随本裁定移除。
  additional: [
    "When you have enough information to act, act. Do not re-derive facts already established in the conversation, re-litigate a decision the user has already made, or narrate options you will not pursue. If you are weighing a choice, give a recommendation, not an exhaustive survey",
  ].join("\n"),
} as const;

export function buildSessionGuidanceSection(toolNames: readonly string[], hasSkills = false): ContextSection | null {
  const tools = new Set(toolNames);
  const lines = ["# Session-specific guidance"];
  // 插件发现工具已改为 deferred，暂不注入插件推荐指导段。
  // if (tools.has("SearchPlugins") && tools.has("SuggestPluginInstall")) {
  //   lines.push(
  //     "- Check existing capabilities first. When an official plugin would materially help the user's task, proactively use SearchPlugins, then SuggestPluginInstall with a concrete reason. Do not invent plugins or repeat skipped suggestions. The confirmation card owns installation approval. Installed plugins are usable only after activation is ready.",
  //   );
  // }

  // 当前不输出 Agent 指导段。
  // if (tools.has("Agent")) {
  //   lines.push("- Use the Agent tool with specialized agents when the task at hand matches the agent's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but they should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing - if you delegate research to a subagent, do not also perform the same searches yourself.");

  //   let exploreGuide = "- For broad codebase exploration or research that'll take more than 3 queries, spawn Agent with subagent_type=Explore.";
  //   const fallbackSearch = getDirectSearchGuidance(tools);
  //   if (fallbackSearch) {
  //     exploreGuide += ` Otherwise use ${fallbackSearch} directly.`;
  //   }
  //   lines.push(exploreGuide);
  // }

  if (tools.has("Skill") && hasSkills) {
    lines.push("- When the user types `/<skill-name>`, invoke it via Skill. Only use skills listed in the user-invocable skills section \u2014 don't guess.");
  }

  // if (tools.has("AskUserQuestion")) {
  //   lines.push("- Use AskUserQuestion when you need a bounded clarification before proceeding.");
  // }

  if (lines.length <= 1) {
    return null;
  }

  // 只有存在实际 session guidance 时才输出本段，避免向 simple branch 注入空标题。
  return createDynamicSection("Session-specific guidance", "session_guidance", lines.join("\n"));
}

export function getCommunicationPrompt(): string {
  return [
    COMMUNICATION_PROMPTS.additional.beforeDefault,
    "",
    COMMUNICATION_PROMPTS.default,
    COMMUNICATION_PROMPTS.additional.afterDefault,
  ].join("\n");
}
export function getExecutionPrompt(): string {
  // OpenZWork v3.18.0 同步裁定：回到上游短版（删除前查看目标即止），
  // 官方闭源版的“发现与描述不符即上报”扩写不并入。
  return "For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next. Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.";
}
export function getContextManagementPrompt(): string {
  return CONTEXT_MANAGEMENT_PROMPTS.default;
}
export function getPersistencePrompt(): string {
  return CONTEXT_MANAGEMENT_PROMPTS.additional;
}

export function buildDynamicBehaviorSection(settings?: SystemPromptSettings): ContextSection {
  return createDynamicSection("Dynamic Behavior", "dynamic_behavior", [
    resolveSystemPromptSection(settings, "communication", getCommunicationPrompt()),
    "",
    resolveSystemPromptSection(settings, "execution", getExecutionPrompt()),
  ].join("\n"));
}

export function buildOutputStyleSection(
  style: ContextBuilderConfig["outputStyle"],
): ContextSection | null {
  if (!style || style.prompt.trim().length === 0) return null;
  return createDynamicSection(
    "Output Style",
    "output_style",
    [`# Output Style: ${style.name}`, style.prompt.trim()].join("\n"),
  );
}

export function buildContextManagementSection(settings?: SystemPromptSettings): ContextSection {
  return createDynamicSection(
    "Context Management",
    "context_management",
    [
      resolveSystemPromptSection(settings, "context_management", getContextManagementPrompt()),
      "",
      resolveSystemPromptSection(settings, "persistence", getPersistencePrompt()),
    ].join("\n"),
  );
}

/** 固定的 token 预算行，是 system 的最后一段；倒数由每次请求的提醒附件表达。 */
export function buildTotalTokensSection(): ContextSection {
  return createDynamicSection("Total Tokens", "total_tokens", TOTAL_TOKENS_SYSTEM_LINE);
}

function createDynamicSection(
  name: string,
  source: ContextSection["source"],
  content: string,
): ContextSection {
  return {
    name,
    source,
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
