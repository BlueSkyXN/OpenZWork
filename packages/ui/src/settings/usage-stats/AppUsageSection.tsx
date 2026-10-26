import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { AppUsageRange } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useAppUsageStats } from "@/hooks/useAppUsageStats.js";
import { DailyModelTrend, ModelRanking, ToolRanking, UsageHeatmap } from "./UsageVisualizations.js";

const RANGE_OPTIONS: AppUsageRange[] = ["all", "7d", "30d"];

function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatElapsed(value: number | null, locale: string): string {
  if (value === null) return "—";
  if (value < 1_000) return `${formatInteger(value, locale)} ms`;
  const seconds = value / 1_000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds)} s`;
}

function formatDuration(value: number, intl: ReturnType<typeof useZCodeIntl>["intl"]): string {
  const totalMinutes = Math.max(0, Math.floor(value / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}${intl.formatMessage({ id: "settings.usage.duration.day" })}`);
  if (hours) parts.push(`${hours}${intl.formatMessage({ id: "settings.usage.duration.hour" })}`);
  if (minutes || parts.length === 0) {
    parts.push(`${minutes}${intl.formatMessage({ id: "settings.usage.duration.minute" })}`);
  }
  return parts.join(" ");
}

function SummaryMetric({
  label,
  value,
  detail,
  prominent = false,
}: {
  label: string;
  value: string;
  detail?: string;
  prominent?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="min-w-0 space-y-2 p-4">
      <div className="text-ui-sm text-foreground-subtle">{label}</div>
      <div
        className={
          prominent
            ? "break-words text-ui-xl font-semibold tabular-nums text-foreground"
            : "break-words text-ui-lg font-medium tabular-nums text-foreground"
        }
      >
        {value}
      </div>
      {detail ? <div className="text-ui-sm text-foreground-subtle">{detail}</div> : null}
    </div>
  );
}

export function AppUsageSection() {
  const { intl, locale } = useZCodeIntl();
  const [range, setRange] = useState<AppUsageRange>("30d");
  const { available, loading, data, error, refresh } = useAppUsageStats(range);
  const numberLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  const summary = data?.summary;
  const modelRequestCount =
    data?.models.reduce((count, model) => count + model.requestCount, 0) ?? 0;
  // 无样本时比率没有定义；仅有失败请求的零 Token 快照仍包含真实用量事实。
  const empty =
    summary?.totalTokens === 0 &&
    summary.totalSessions === 0 &&
    summary.toolCallCount === 0 &&
    modelRequestCount === 0;
  const metrics = summary
    ? [
        {
          label: intl.formatMessage({ id: "settings.usage.totalTokens" }),
          value: formatInteger(summary.totalTokens, numberLocale),
          detail: `${intl.formatMessage({ id: "settings.usage.modelChart.input" })} ${formatInteger(summary.inputTokens, numberLocale)} · ${intl.formatMessage({ id: "settings.usage.modelChart.output" })} ${formatInteger(summary.outputTokens, numberLocale)}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.sessions" }),
          value: formatInteger(summary.totalSessions, numberLocale),
          detail: `${formatInteger(summary.totalTurns, numberLocale)} ${intl.formatMessage({ id: "settings.usage.turns" })}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.activeDays" }),
          value: formatInteger(summary.activeDays, numberLocale),
          detail: `${intl.formatMessage({ id: "settings.usage.currentStreak" })} ${formatInteger(summary.currentStreakDays, numberLocale)} · ${intl.formatMessage({ id: "settings.usage.longestStreak" })} ${formatInteger(summary.longestStreakDays, numberLocale)}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.favoriteModel" }),
          value: summary.favoriteModel
            ? summary.favoriteModel.modelId?.trim() ||
              intl.formatMessage({ id: "settings.usage.unknownModel" })
            : intl.formatMessage({ id: "settings.usage.noData" }),
          detail: summary.favoriteModel
            ? intl.formatMessage(
                { id: "settings.usage.favoriteModelShare" },
                { share: formatPercent(summary.favoriteModel.share, numberLocale) },
              )
            : undefined,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.cacheHitRate" }),
          value: summary.inputTokens > 0 ? formatPercent(summary.cacheHitRate, numberLocale) : "—",
          detail: `${intl.formatMessage({ id: "settings.usage.modelChart.cachedInput" })} ${formatInteger(summary.cacheReadTokens, numberLocale)} · ${intl.formatMessage({ id: "settings.usage.modelChart.uncachedInput" })} ${formatInteger(Math.max(0, summary.inputTokens - summary.cacheReadTokens), numberLocale)}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.toolCallsTotal" }),
          value: formatInteger(summary.toolCallCount, numberLocale),
          detail: `${intl.formatMessage({ id: "settings.usage.errorRate" })} ${summary.toolCallCount > 0 ? formatPercent(summary.toolErrorRate, numberLocale) : "—"}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.modelErrorRate" }),
          value: modelRequestCount > 0 ? formatPercent(summary.modelErrorRate, numberLocale) : "—",
          detail: `${formatInteger(
            modelRequestCount,
            numberLocale,
          )} ${intl.formatMessage({ id: "settings.usage.calls" })}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.avgTimeToFirstToken" }),
          value: formatElapsed(summary.avgTimeToFirstTokenMs, numberLocale),
          detail: `${intl.formatMessage({ id: "settings.usage.avgTurnDuration" })} ${formatElapsed(summary.avgTurnDurationMs, numberLocale)}`,
        },
        {
          label: intl.formatMessage({ id: "settings.usage.longestSession" }),
          value: empty ? "—" : formatDuration(summary.longestSessionMs, intl),
          detail: intl.formatMessage(
            { id: "settings.usage.peakDayTokens" },
            { tokens: formatInteger(summary.peakDayTokens, numberLocale) },
          ),
        },
      ]
    : [];

  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={intl.formatMessage({ id: "settings.usage.tab.appUsage" })}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-ui-lg font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.tab.appUsage" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usage.sectionDescription" })}{" "}
            {intl.formatMessage({ id: "settings.usage.localOnlyHint" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          </span>
          <div
            className="flex rounded-lg border border-border p-0.5"
            role="group"
            aria-label={intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                aria-pressed={range === option}
                className={`${
                  range === option
                    ? "rounded-md bg-selected px-2 py-1 text-ui-sm text-foreground"
                    : "rounded-md px-2 py-1 text-ui-sm text-foreground-subtle hover:bg-hover hover:text-foreground"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused`}
                key={option}
                onClick={() => setRange(option)}
                type="button"
              >
                {intl.formatMessage({ id: `settings.usage.range.${option}` })}
              </button>
            ))}
          </div>
          <Button disabled={!available || loading} onClick={refresh} size="sm" variant="outline">
            <RefreshCw className={loading ? "size-3 animate-spin" : "size-3"} aria-hidden="true" />
            {intl.formatMessage({ id: "settings.usage.refresh" })}
          </Button>
        </div>
      </div>

      {!available ? (
        <div
          className="rounded-xl border border-border bg-surface p-4 text-ui-base text-foreground-subtle"
          role="status"
        >
          {intl.formatMessage({ id: "settings.usage.localUnavailable" })}
        </div>
      ) : null}
      {available && loading ? (
        <div className="rounded-xl border border-border bg-surface p-4" role="status">
          <div className="font-medium text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.usage.loadingTitle" })}
          </div>
          <div className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usage.appUsageLoadingDescription" })}
          </div>
        </div>
      ) : null}
      {available && error ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-surface p-4"
          role="alert"
        >
          <div className="min-w-0 text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.usage.error" })}
          </div>
          <Button disabled={loading} onClick={refresh} size="sm" variant="outline">
            {intl.formatMessage({ id: "settings.usage.retry" })}
          </Button>
        </div>
      ) : null}
      {available && data && !loading && !error ? (
        <>
          <Card className="grid min-w-0 grid-cols-1 gap-0 divide-y divide-border py-0 shadow-none sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {metrics.slice(0, 3).map((metric) => (
              <SummaryMetric {...metric} prominent key={metric.label} />
            ))}
          </Card>
          {empty ? (
            <div className="rounded-xl border border-border bg-surface p-4" role="status">
              <div className="font-medium text-ui-base text-foreground">
                {intl.formatMessage({ id: "settings.usage.emptyTitle" })}
              </div>
              <p className="mt-1 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "settings.usage.emptyDescription" })}
              </p>
            </div>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.slice(3).map((metric) => (
              <div key={metric.label} className="min-w-0 border-b border-border">
                <SummaryMetric {...metric} />
              </div>
            ))}
          </div>
          {!empty ? (
            <div data-testid="app-usage-charts" className="space-y-4">
              <UsageHeatmap locale={numberLocale} snapshot={data} />
              <DailyModelTrend locale={numberLocale} snapshot={data} />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ModelRanking locale={numberLocale} snapshot={data} />
                <ToolRanking locale={numberLocale} snapshot={data} />
              </div>
            </div>
          ) : null}
          <p className="text-right text-ui-xs text-foreground-subtle">
            {intl.formatMessage(
              { id: "settings.usage.lastRefreshTime" },
              {
                time: new Intl.DateTimeFormat(numberLocale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(data.generatedAt)),
              },
            )}{" "}
            · {data.timeZone}
          </p>
        </>
      ) : null}
    </section>
  );
}
