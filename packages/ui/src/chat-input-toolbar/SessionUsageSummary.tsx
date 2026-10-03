import { TID_CHAT_SESSION_USAGE_SUMMARY } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { SessionUsageSummaryModel } from "./sessionUsageModel.js";

const USAGE_ROWS = [
  ["totalTokens", "chat.sessionUsage.total"],
  ["inputTokens", "chat.sessionUsage.input"],
  ["outputTokens", "chat.sessionUsage.output"],
  ["cacheReadTokens", "chat.sessionUsage.cacheRead"],
  ["cacheWriteTokens", "chat.sessionUsage.cacheWrite"],
] as const;

export function SessionUsageSummary({
  summary,
  intl,
  locale,
}: {
  summary: SessionUsageSummaryModel;
  intl: IntlInstance;
  locale: string;
}) {
  const numberFormatter = new Intl.NumberFormat(locale);
  return (
    <section
      aria-label={intl.formatMessage({ id: "chat.sessionUsage.title" })}
      className="min-w-0 space-y-2"
      data-testid={TID_CHAT_SESSION_USAGE_SUMMARY}
    >
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "chat.sessionUsage.title" })}
      </h3>
      <dl className="space-y-1.5 text-ui-sm">
        {USAGE_ROWS.map(([key, label]) => (
          <div className="flex min-w-0 items-baseline justify-between gap-3" key={key}>
            <dt className="min-w-0 text-foreground-subtle">{intl.formatMessage({ id: label })}</dt>
            <dd className="min-w-0 break-all text-right font-mono tabular-nums text-foreground">
              {numberFormatter.format(summary[key])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "chat.sessionUsage.description" })}
      </p>
    </section>
  );
}
