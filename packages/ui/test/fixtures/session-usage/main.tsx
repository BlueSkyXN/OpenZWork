import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";
import { ChatContextUsage } from "../../../src/chat-input-toolbar/contextUsage.js";
import type { IntlInstance } from "../../../src/i18n/IntlProvider.js";
import zhCN from "../../../src/i18n/locales/zh-CN.js";
import enUS from "../../../src/i18n/locales/en-US.js";
import "../../../src/styles.css";

const initial: SessionUsageState = {
  contextWindow: {
    usedTokens: 12_000,
    maxTokens: 128_000,
    autoCompactThresholdTokens: null,
  },
  cumulative: {
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 600,
    cacheWriteTokens: 100,
  },
};

function Fixture() {
  const [usage, setUsage] = useState<SessionUsageState | null>(initial);
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [dark, setDark] = useState(false);
  const messages = locale === "zh-CN" ? zhCN : enUS;
  const intl: IntlInstance = {
    formatMessage: ({ id }, values) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        messages[id] ?? id,
      ),
  };
  const context = usage?.contextWindow;
  return (
    <main className="flex h-full flex-col gap-4 bg-background p-4 text-foreground">
      <h1 className="text-ui-base font-medium">Session usage interaction fixture</h1>
      <p className="text-ui-sm">
        Synthetic projection data; real production usage component. No model or account requests.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setUsage(initial)}>
          Reset
        </button>
        <button type="button" onClick={() => setUsage({ ...initial, contextWindow: null })}>
          Unknown context
        </button>
        <button type="button" onClick={() => setUsage(null)}>
          New session
        </button>
        <button
          type="button"
          onClick={() =>
            setUsage({
              ...initial,
              cumulative: {
                ...initial.cumulative,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            })
          }
        >
          Zero usage
        </button>
        <button
          type="button"
          onClick={() =>
            setUsage({
              ...initial,
              cumulative: { ...initial.cumulative, inputTokens: 1_500, outputTokens: 300 },
            })
          }
        >
          Usage update
        </button>
        <button
          type="button"
          onClick={() =>
            setUsage({
              ...initial,
              cumulative: {
                inputTokens: 9_000_000_000_000,
                outputTokens: 800_000_000_000,
                cacheReadTokens: 6_000_000_000_000,
                cacheWriteTokens: 1_000_000_000_000,
              },
            })
          }
        >
          Large counts
        </button>
        <button
          type="button"
          onClick={() => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"))}
        >
          Switch language
        </button>
        <button
          type="button"
          onClick={() => {
            setDark(!dark);
            document.documentElement.classList.toggle("theme-zai-dark", !dark);
            document.documentElement.classList.toggle("theme-zai-light", dark);
          }}
        >
          Switch theme
        </button>
      </div>
      <div className="mt-auto flex justify-end rounded-xl border border-border p-3">
        <ChatContextUsage
          taskUsage={context ? { used: context.usedTokens, size: context.maxTokens } : null}
          cumulativeUsage={usage?.cumulative}
          selectedProvider={ZCODE_AGENT_PROVIDER}
          intl={intl}
          locale={locale}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
