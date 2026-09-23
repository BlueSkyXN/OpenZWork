import type { AppUsageHeatmapCell, AppUsageSnapshot } from "@zcode/shared";
import { Card } from "@/components/ui/card.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getAppUsageModelChartColor } from "./appUsageChartPalette.js";

function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}

function UsageCard({ title, children }: { title: string; children: import("react").ReactNode }) {
  return (
    <Card className="min-w-0 gap-3 p-4 shadow-none">
      <h3 className="text-ui-base font-medium text-foreground">{title}</h3>
      {children}
    </Card>
  );
}

export function UsageHeatmap({ snapshot, locale }: { snapshot: AppUsageSnapshot; locale: string }) {
  const { intl } = useZCodeIntl();
  const cells = snapshot.heatmap.weeks
    .flatMap((week) => week.days)
    .filter((cell): cell is AppUsageHeatmapCell => cell !== null);
  const weekdays = [
    intl.formatMessage({ id: "settings.usage.dayLabel.mon" }),
    intl.formatMessage({ id: "settings.usage.dayLabel.wed" }),
    intl.formatMessage({ id: "settings.usage.dayLabel.fri" }),
  ];
  return (
    <UsageCard title={intl.formatMessage({ id: "settings.usage.heatmapTitle" })}>
      {cells.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.toolCallsEmpty" })}
        </p>
      ) : (
        <>
          <div className="flex gap-3 text-ui-xs text-foreground-subtle" aria-hidden="true">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            className="overflow-x-auto pb-1"
            tabIndex={0}
            role="region"
            aria-label={intl.formatMessage({ id: "settings.usage.heatmapTitle" })}
          >
            <div className="flex min-w-max gap-1">
              {snapshot.heatmap.weeks.map((week) => (
                <div className="grid grid-rows-7 gap-1" key={week.weekIndex}>
                  {week.days.map((cell, dayIndex) => (
                    <div
                      key={`${week.weekIndex}-${dayIndex}`}
                      className="size-3 rounded-sm border border-border"
                      style={{
                        backgroundColor: cell
                          ? `color-mix(in oklab, var(--color-usage-chart-1) ${20 + cell.level * 18}%, var(--color-card))`
                          : "var(--color-card)",
                      }}
                      title={
                        cell
                          ? intl.formatMessage(
                              { id: "settings.usage.heatmapCell" },
                              {
                                date: cell.date,
                                tokens: formatInteger(cell.totalTokens, locale),
                                turns: formatInteger(cell.turnCount, locale),
                                tools: formatInteger(cell.toolCallCount, locale),
                              },
                            )
                          : undefined
                      }
                      aria-label={
                        cell
                          ? intl.formatMessage(
                              { id: "settings.usage.heatmapCell" },
                              {
                                date: cell.date,
                                tokens: formatInteger(cell.totalTokens, locale),
                                turns: formatInteger(cell.turnCount, locale),
                                tools: formatInteger(cell.toolCallCount, locale),
                              },
                            )
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </UsageCard>
  );
}

export function DailyModelTrend({
  snapshot,
  locale,
}: {
  snapshot: AppUsageSnapshot;
  locale: string;
}) {
  const { intl } = useZCodeIntl();
  const modelIds = [
    ...new Set(snapshot.dailyModelUsage.flatMap((day) => day.models.map((model) => model.modelId))),
  ];
  const modelLabel = (modelId: string | null) =>
    modelId ?? intl.formatMessage({ id: "settings.usage.unknownModel" });
  const max = Math.max(
    1,
    ...snapshot.dailyModelUsage.map((item) =>
      item.models.reduce((sum, model) => sum + model.totalTokens, 0),
    ),
  );
  return (
    <UsageCard title={intl.formatMessage({ id: "settings.usage.dailyChartTitle" })}>
      {snapshot.dailyModelUsage.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.emptyDescription" })}
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div
            className="flex min-w-max items-end gap-1"
            role="img"
            aria-label={intl.formatMessage({ id: "settings.usage.dailyChartTitle" })}
          >
            {snapshot.dailyModelUsage.map((day) => {
              const total = day.models.reduce((sum, model) => sum + model.totalTokens, 0);
              return (
                <div
                  className="flex w-8 flex-col items-center gap-1"
                  key={day.date}
                  title={`${day.date}: ${formatInteger(total, locale)} tokens`}
                >
                  <div
                    className="flex h-28 w-full flex-col-reverse items-end overflow-hidden rounded-sm bg-surface"
                    aria-hidden="true"
                  >
                    {day.models.map((model, index) => (
                      <div
                        key={`${model.modelId ?? "unknown"}-${index}`}
                        className="w-full"
                        style={{
                          height: `${Math.max(1, (model.totalTokens / max) * 100)}%`,
                          backgroundColor: getAppUsageModelChartColor(
                            modelIds.indexOf(model.modelId),
                          ),
                        }}
                      />
                    ))}
                  </div>
                  <span className="max-w-full truncate text-ui-xs text-foreground-subtle">
                    {day.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {modelIds.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ui-xs text-foreground-subtle">
          {modelIds.map((id, index) => (
            <li className="flex items-center gap-1" key={`${id ?? "unknown"}-${index}`}>
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: getAppUsageModelChartColor(index) }}
                aria-hidden="true"
              />
              <span>{modelLabel(id)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </UsageCard>
  );
}

export function ModelRanking({ snapshot, locale }: { snapshot: AppUsageSnapshot; locale: string }) {
  const { intl } = useZCodeIntl();
  return (
    <UsageCard title={intl.formatMessage({ id: "settings.usage.modelUsageTitle" })}>
      {snapshot.models.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.emptyDescription" })}
        </p>
      ) : (
        <ol className="space-y-3">
          {snapshot.models.map((model, index) => (
            <li className="min-w-0" key={`${model.modelId ?? "unknown"}-${index}`}>
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate text-ui-base font-medium text-foreground">
                  {model.modelId ?? intl.formatMessage({ id: "settings.usage.unknownModel" })}
                </span>
                <span className="shrink-0 text-ui-sm text-foreground-subtle">
                  {formatInteger(model.totalTokens, locale)} · {formatPercent(model.share, locale)}
                </span>
              </div>
              <div
                className="mt-1 flex h-2 overflow-hidden rounded-sm bg-surface"
                aria-hidden="true"
              >
                <span
                  style={{
                    width: `${Math.max(0, Math.min(1, model.share)) * 100}%`,
                    backgroundColor: getAppUsageModelChartColor(index),
                  }}
                />
              </div>
              <div className="mt-1 text-ui-xs text-foreground-subtle">
                {formatInteger(model.requestCount, locale)}{" "}
                {intl.formatMessage({ id: "settings.usage.calls" })}
              </div>
            </li>
          ))}
        </ol>
      )}
    </UsageCard>
  );
}

export function ToolRanking({ snapshot, locale }: { snapshot: AppUsageSnapshot; locale: string }) {
  const { intl } = useZCodeIntl();
  return (
    <UsageCard title={intl.formatMessage({ id: "settings.usage.toolUsageTitle" })}>
      {snapshot.tools.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.toolCallsEmpty" })}
        </p>
      ) : (
        <ol className="space-y-3">
          {snapshot.tools.map((tool, index) => (
            <li
              className="flex min-w-0 items-center justify-between gap-3"
              key={`${tool.toolName}-${index}`}
            >
              <span className="truncate text-ui-base text-foreground">{tool.toolName}</span>
              <span className="shrink-0 text-ui-sm text-foreground-subtle">
                {formatInteger(tool.callCount, locale)} · {formatPercent(tool.errorRate, locale)}{" "}
                {intl.formatMessage({ id: "settings.usage.errorRate" })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </UsageCard>
  );
}
