import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyConversationDeltas,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { buildSessionUsageSummary } from "../src/chat-input-toolbar/sessionUsageModel.js";
import { SessionUsageSummary } from "../src/chat-input-toolbar/SessionUsageSummary.js";
import { ChatContextUsage } from "../src/chat-input-toolbar/contextUsage.js";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import type { IntlInstance } from "../src/i18n/IntlProvider.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

const cumulative = {
  inputTokens: 1_000,
  outputTokens: 200,
  cacheReadTokens: 600,
  cacheWriteTokens: 100,
};

function intlFor(messages: Record<string, string>): IntlInstance {
  return {
    formatMessage: ({ id }) => messages[id] ?? id,
  };
}

test("session token total includes input and output without counting cache twice", () => {
  assert.deepEqual(buildSessionUsageSummary(cumulative), {
    ...cumulative,
    totalTokens: 1_200,
  });
});

test("reported zero is distinct from missing or invalid cumulative usage", () => {
  assert.equal(buildSessionUsageSummary(undefined), null);
  assert.equal(buildSessionUsageSummary(null), null);
  assert.deepEqual(
    buildSessionUsageSummary({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    },
  );
  for (const key of Object.keys(cumulative)) {
    for (const value of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(
        buildSessionUsageSummary({ ...cumulative, [key]: value }),
        null,
        `${key}: ${value}`,
      );
    }
  }
  assert.equal(
    buildSessionUsageSummary({ ...cumulative, inputTokens: Number.MAX_SAFE_INTEGER }),
    null,
  );
});

test("full usage patches replace cumulative values without adding replayed totals", () => {
  // 用量更新只依赖 snapshot.usage；其余投影字段不参与本测试。
  const initial = { usage: { contextWindow: null, cumulative } } as ConversationSnapshot;
  const nextUsage = {
    contextWindow: null,
    cumulative: { ...cumulative, inputTokens: 1_500, outputTokens: 300 },
  };
  const next = applyConversationDeltas(initial, [
    { op: "state.updated", patch: { usage: nextUsage } },
    { op: "state.updated", patch: { usage: nextUsage } },
  ]);
  assert.equal(buildSessionUsageSummary(next.usage.cumulative)?.totalTokens, 1_800);
  assert.equal(initial.usage.cumulative.inputTokens, 1_000);
  const reset = applyConversationDeltas(next, [
    { op: "state.updated", patch: { usage: { contextWindow: null, cumulative } } },
  ]);
  assert.equal(buildSessionUsageSummary(reset.usage.cumulative)?.totalTokens, 1_200);
});

test("usage trigger survives unknown context only when cumulative data is present", () => {
  const props = {
    selectedProvider: ZCODE_AGENT_PROVIDER,
    intl: intlFor(enUS),
    locale: "en-US",
    taskUsage: null,
  };
  const render = (usage: typeof cumulative | null) =>
    renderToStaticMarkup(createElement(ChatContextUsage, { ...props, cumulativeUsage: usage }));
  assert.equal(render(null), "");
  assert.equal(
    render({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    "",
  );
  assert.equal(render({ ...cumulative, inputTokens: Number.NaN }), "");
  assert.match(render(cumulative), /aria-label="Session token usage"/);
  assert.doesNotMatch(render(cumulative), /Context usage|progressbar/);
  const withContext = renderToStaticMarkup(
    createElement(ChatContextUsage, {
      ...props,
      taskUsage: { used: 100, size: 1_000 },
      cumulativeUsage: null,
    }),
  );
  assert.match(withContext, /chat-context-usage-trigger/);
});

test("session usage renders localized full counts and explains the cache and balance boundaries", () => {
  const summary = buildSessionUsageSummary(cumulative)!;
  for (const [locale, messages] of [
    ["en-US", enUS],
    ["zh-CN", zhCN],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(SessionUsageSummary, {
        summary,
        intl: intlFor(messages),
        locale,
      }),
    );
    assert.ok(html.includes(messages["chat.sessionUsage.title"]));
    assert.ok(html.includes(messages["chat.sessionUsage.description"]));
    assert.match(html, /1,200/);
    assert.match(html, /1,000/);
    assert.match(html, />200</);
    assert.match(html, />600</);
    assert.match(html, />100</);
    assert.doesNotMatch(html, /1,900|\$|NaN|undefined/);
  }
});
