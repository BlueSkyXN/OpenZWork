// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

// OpenZWork v3.18.0：吸收上游文案刷新（coding agent → interactive agent）。
const CLI_PREFIX_PROMPT = "You are ZCode, an interactive agent";

export function buildCliPrefixSection(): ContextSection {
  const content = CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
