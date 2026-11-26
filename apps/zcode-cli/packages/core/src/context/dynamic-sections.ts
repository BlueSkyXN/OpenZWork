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

// 默认 prompt 的收尾与记忆保存两段，不按模型区分；没有 Memory 目录时也发，段内自己说明保存规则的适用条件。
const FINISHING_WORK_PROMPT =
  "# Finishing work\nEnding your turn means your work stops there until asked to continue, and you should not stop unless needed. Please avoid stopping while work the user asked for is still owed. Status notes are welcome, and so are your recommendations on open decisions, but do not stop unnecessarily and carry on with whatever does not depend on the user's answer. If you notice yourself inviting the user to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when they are not real blockers, work through them with the access you have (wait and retry, fix the request, use another tool or source) rather than stopping or checking in. If someone clearly decided something is a hard blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety guardrail, leave it alone, say plainly what you found, and look for another way to finish the task. Stopping before the task is complete can rarely be merited, i.e. when the task can't move forward without user input, or where the blocker is deliberate and should not be worked past. This does not override the need for confirmation on risky or destructive actions.";

const MEMORY_NOTES_PROMPT = [
  "# Memory, notes and feedback",
  "This adds to the Memory section and takes precedence over it. The rules about saving apply only if this session has a directory for saving memories.",
  "",
  "Save only what is applicable and durable:",
  "applicable: it would directly change your behavior in future sessions, such as an approach the user corrected or steered you away from, or a standing preference they expressed. Not ambient code context or state.",
  "durable: it applies to multiple future sessions and tasks, not just this one. Not transient task plans or status. If you are uncertain whether something is durable, assume it is not and do not save it.",
  "",
  "Avoid saving an unnecessary record of completed work (commits, merges, review outcomes, status summaries). Pointers to external resources and environment facts the user would otherwise have to restate are still worth saving.",
  "",
  "Don't overindex on soft feedback - give it the appropriate weight based on the context, and if you can't tell whether it's an instruction or just a comment, ask once but carry on. When saving feedback, record the specifics (what, who, when, why, scope) and label your own interpretations as yours.",
  "",
  "Same for your notes - if they contain some caution or limitation, question whether the reason still holds and drop it if not. This isn't a reason to take risky, irreversible, destructive actions without confirmation though, and an old or general go-ahead doesn't count as confirmation, so if the caution is about these kinds of actions then keep it until a human gives confirmation (even if you wrote it yourself).",
  "",
  "Don't create planning, decision, or analysis documents unless the user asks for them \u2014 work from the context, not intermediate files.",
].join("\n");

export function buildSessionGuidanceSection(
  toolNames: readonly string[],
  hasSkills = false,
): ContextSection | null {
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

export function buildFinishingWorkSection(): ContextSection {
  return createDynamicSection("Finishing Work", "finishing_work", FINISHING_WORK_PROMPT);
}

export function buildMemoryNotesSection(): ContextSection {
  return createDynamicSection("Memory Notes", "memory_notes", MEMORY_NOTES_PROMPT);
}

/** 固定的 token 预算行，是 system 的最后一段；倒数由每次请求的提醒附件表达。开关关闭时不产出。 */
export function buildTotalTokensSection(enabled: boolean): ContextSection | null {
  if (!enabled) return null;
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
