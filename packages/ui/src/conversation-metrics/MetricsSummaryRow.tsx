import { ChevronDown } from "lucide-react";
import { tokensPerSecond } from "@zcode/shared/conversation-metrics";
import type { TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";
import { Button, buttonVariants } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { type MetricsFieldId } from "./contract.js";
import {
  cachePercent,
  formatMetricCount,
  metricSeconds,
  metricTotal,
} from "./TurnMetricsDetails.js";
import { useMetricsOverflow } from "./useMetricsOverflow.js";

const TRIGGER_CLASS =
  "shrink-0 gap-0.5 px-1 text-ui-xs font-normal text-foreground-subtle aria-expanded:bg-transparent focus-visible:ring-2 focus-visible:ring-input-border-focused/30";
type SummaryHeader = Pick<TurnHeaderRow, "state" | "activeMs" | "metrics" | "toolCallCount">;

export function MetricsSummaryRow({
  header,
  cumulative,
  durationMs,
  fields,
  expanded = false,
  controls,
  onToggle,
}: {
  header: SummaryHeader;
  cumulative: { inputTokens: number; outputTokens: number };
  durationMs?: number;
  fields: readonly MetricsFieldId[];
  expanded?: boolean;
  controls?: string;
  onToggle?: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `metrics.${key}` });
  const speed = tokensPerSecond(header.metrics?.latest);
  const state =
    header.state === "running"
      ? "running"
      : header.state === "failed"
        ? "failed"
        : header.state === "completedInterrupted"
          ? "stopped"
          : "completed";
  const values: Record<MetricsFieldId, string> = {
    statusDuration: `${t(state)} ${metricSeconds(durationMs ?? header.activeMs)}`,
    speed: `${speed === null ? "—" : Math.round(speed)} tok/s`,
    firstText: `${t("firstText")} ${metricSeconds(header.metrics?.latest?.timeToFirstTextMs)}`,
    turnTokens: `${t("turn")} ${formatMetricCount(metricTotal(header.metrics?.usage), locale)}`,
    cache: `${t("cache")} ${cachePercent(header.metrics?.usage)}`,
    sessionTokens: `${t("sessionShort")} ${formatMetricCount(cumulative.inputTokens + cumulative.outputTokens, locale)}`,
    toolCalls: `${t("toolsShort")} ${formatMetricCount(header.toolCallCount, locale)}`,
  };
  const { containerRef, measurementRef, visible } = useMetricsOverflow(fields);
  const triggerContent = (
    <>
      {t(expanded ? "less" : "more")}
      <ChevronDown className={cn("size-3", expanded && "rotate-180")} />
    </>
  );
  return (
    <div
      ref={containerRef}
      className="relative min-w-0 text-ui-xs text-foreground-subtle tabular-nums"
    >
      <div className="flex min-w-0 items-center gap-2" data-testid="metrics-summary-row">
        {fields
          .filter((id) => visible.includes(id))
          .map((id) => (
            <span
              key={id}
              className="shrink-0 whitespace-nowrap"
              data-testid={`metrics-value-${id}`}
              title={t(`display.field.${id}`)}
            >
              {values[id]}
            </span>
          ))}
        {onToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={TRIGGER_CLASS}
            aria-controls={controls}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {triggerContent}
          </Button>
        ) : (
          <span className={cn(buttonVariants({ variant: "ghost", size: "xs" }), TRIGGER_CLASS)}>
            {triggerContent}
          </span>
        )}
      </div>
      <div
        className="pointer-events-none invisible absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div ref={measurementRef} className="flex w-max items-center gap-2">
          {fields.map((id) => (
            <span key={id} data-measure-metric={id} className="shrink-0 whitespace-nowrap">
              {values[id]}
            </span>
          ))}
          <span
            data-metric-trigger
            className={cn(buttonVariants({ variant: "ghost", size: "xs" }), TRIGGER_CLASS)}
          >
            {triggerContent}
          </span>
        </div>
      </div>
    </div>
  );
}
