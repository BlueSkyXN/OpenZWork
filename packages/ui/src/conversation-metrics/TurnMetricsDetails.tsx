import { tokensPerSecond, type MetricsUsage } from "@zcode/shared/conversation-metrics";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import type { TurnMetricsDetailsProps } from "./contract.js";

export function formatMetricCount(value: number | undefined, locale: string): string {
  return value === undefined
    ? "—"
    : new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      );
}
export function metricTotal(usage: MetricsUsage | undefined): number | undefined {
  return usage ? usage.inputTokens + usage.outputTokens : undefined;
}
export function metricSeconds(value: number | undefined): string {
  return value === undefined ? "—" : `${(value / 1000).toFixed(1)}s`;
}
export function cachePercent(usage: MetricsUsage | undefined): string {
  return usage && usage.inputTokens > 0 && usage.cacheReadTokens !== undefined
    ? `${Math.round((usage.cacheReadTokens / usage.inputTokens) * 100)}%`
    : "—";
}

export function TurnMetricsDetails({ header }: TurnMetricsDetailsProps) {
  const { intl, locale } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `metrics.${key}` });
  const metrics = header.metrics;
  const speed = tokensPerSecond(metrics?.latest);
  const fields = [
    ["turn", formatMetricCount(metricTotal(metrics?.usage), locale)],
    ["input", formatMetricCount(metrics?.usage?.inputTokens, locale)],
    ["output", formatMetricCount(metrics?.usage?.outputTokens, locale)],
    ["cache", cachePercent(metrics?.usage)],
    ["speed", speed === null ? "—" : `${Math.round(speed)} tok/s`],
    ["firstText", metricSeconds(metrics?.latest?.timeToFirstTextMs)],
    ["requests", formatMetricCount(metrics?.requestCount, locale)],
    ["failures", formatMetricCount(metrics?.failureCount, locale)],
    [
      "failedTokens",
      formatMetricCount(
        metrics?.failedUsage
          ? metricTotal(metrics.failedUsage)
          : metrics?.failureCount === 0
            ? 0
            : undefined,
        locale,
      ),
    ],
    ["tools", formatMetricCount(header.toolCallCount, locale)],
    ["toolErrors", formatMetricCount(header.toolErrorCount, locale)],
  ];
  return (
    <div data-testid="conversation-metrics-details" className="space-y-2 text-ui-sm">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 @min-[24rem]/metrics:grid-cols-2">
        {fields.map(([key, value]) => (
          <div key={key} className="flex min-w-0 items-baseline justify-between gap-2">
            <dt className="text-foreground-subtle">{t(key!)}</dt>
            <dd className="shrink-0 whitespace-nowrap font-mono tabular-nums text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {metrics?.unknownUsageCount ? (
        <p className="text-foreground-subtle">
          {intl.formatMessage({ id: "metrics.partial" }, { count: metrics.unknownUsageCount })}
        </p>
      ) : null}
      <p className="text-foreground-subtle">{t("requestScope")}</p>
    </div>
  );
}

export function TurnMetricsAction({ header }: TurnMetricsDetailsProps) {
  const { intl } = useZCodeIntl();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="ghost" data-testid="conversation-turn-metrics">
          {intl.formatMessage({ id: "metrics.turnDetails" })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-full">
        <TurnMetricsDetails header={header} />
      </PopoverContent>
    </Popover>
  );
}
