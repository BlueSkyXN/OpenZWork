import { memo, useEffect, useId, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { useAppUsageStats } from "@/hooks/useAppUsageStats.js";
import { useSessionSubagents } from "@/hooks/useSessionSubagents.js";
import { cn } from "@/components/lib/utils.js";
import {
  DEFAULT_METRICS_DISPLAY_PREFERENCES,
  latestMetricsTurn,
  todayTokens,
  type ConversationMetricsBarProps,
} from "./contract.js";
import { MetricsSummaryRow } from "./MetricsSummaryRow.js";
import { TurnMetricsDetails, formatMetricCount, metricTotal } from "./TurnMetricsDetails.js";

const EXPANDED_KEY = "openzwork.conversation-metrics.v1.expanded";
function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

function MetricsExpanded(props: ConversationMetricsBarProps) {
  const { snapshot } = props;
  const header = latestMetricsTurn(snapshot);
  const refreshKey = `${header?.turnId}:${header?.state}:${snapshot.subagents?.revision ?? 0}`;
  const app = useAppUsageStats("7d", { refreshKey });
  const children = useSessionSubagents({
    ...props,
    sessionId: snapshot.sessionId,
    refreshKey,
    includeMetrics: true,
  });
  const { intl, locale } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `metrics.${key}` });
  const cumulative = snapshot.usage.cumulative;
  const [showChildren, setShowChildren] = useState(false);
  const summary = children.usageSummary;
  const entries = [...children.running, ...children.ended.items];
  return (
    <div className="space-y-3 pb-1" data-testid="conversation-metrics-expanded">
      {header ? <TurnMetricsDetails header={header} /> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-ui-sm">
        <span>
          {t("session")}{" "}
          <strong
            data-testid="conversation-metrics-session-total"
            className="font-mono font-normal"
          >
            {formatMetricCount(cumulative.inputTokens + cumulative.outputTokens, locale)}
          </strong>
        </span>
        {app.available ? (
          <span>
            {t("today")}{" "}
            <strong className="font-mono font-normal">
              {app.error
                ? t("loadFailed")
                : app.loading
                  ? "…"
                  : app.data
                    ? formatMetricCount(todayTokens(app.data), locale)
                    : "—"}
            </strong>
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={app.loading || children.loading}
          onClick={() => {
            app.refresh();
            void children.refresh();
          }}
          aria-label={t("refresh")}
        >
          <RefreshCw className="size-3" />
          {t("refresh")}
        </Button>
      </div>
      <div className="text-ui-sm">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={showChildren}
          onClick={() => setShowChildren((value) => !value)}
        >
          {t("children")} · {summary?.totalCount ?? "—"} ·{" "}
          {formatMetricCount(metricTotal(summary?.metrics?.usage), locale)}{" "}
          <ChevronDown
            className={cn("size-3 transition-transform", showChildren && "rotate-180")}
          />
        </Button>
        {children.error ? <p role="status">{t("loadFailed")}</p> : null}
        {showChildren ? (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {entries.map((child) => (
              <div key={child.childSessionId} className="flex min-w-0 justify-between gap-3">
                <span className="truncate" title={child.title}>
                  {child.title}
                </span>
                <span className="shrink-0 font-mono">
                  {formatMetricCount(metricTotal(child.metrics?.usage), locale)}
                </span>
              </div>
            ))}
            {summary && summary.knownCount < summary.totalCount ? (
              <p className="text-foreground-subtle">{t("childrenPartial")}</p>
            ) : null}
            {children.ended.nextCursor ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={children.loading}
                onClick={() => void children.loadMore()}
              >
                {t("loadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ConversationMetricsBar = memo(function ConversationMetricsBar(
  props: ConversationMetricsBarProps,
) {
  const { snapshot } = props;
  const header = latestMetricsTurn(snapshot);
  const [expanded, setExpanded] = useState(readExpanded);
  const [now, setNow] = useState(Date.now);
  const id = useId();
  const preferences = props.displayPreferences ?? DEFAULT_METRICS_DISPLAY_PREFERENCES;
  const visible = preferences.enabled && preferences.visibleFields.length > 0;
  const running = header?.state === "running";
  const tick = visible && running && preferences.visibleFields.includes("statusDuration");
  useEffect(() => {
    if (!tick) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tick, header?.turnId]);
  if (!header || !visible) return null;
  const duration = running ? Math.max(0, now - header.startedAt) : header.activeMs;
  const scope = JSON.stringify([
    props.workspaceIdentity?.trim() || props.workspacePath,
    props.remoteSessionId,
    snapshot.sessionId,
    snapshot.logEpoch,
  ]);
  return (
    <div
      className="@container/metrics min-w-0 border-t border-border/60 pt-1 text-foreground-subtle"
      data-testid="conversation-metrics-bar"
      data-session-id={snapshot.sessionId}
    >
      <MetricsSummaryRow
        header={header}
        cumulative={snapshot.usage.cumulative}
        durationMs={duration}
        fields={preferences.visibleFields}
        controls={id}
        expanded={expanded}
        onToggle={() => {
          const next = !expanded;
          setExpanded(next);
          try {
            localStorage.setItem(EXPANDED_KEY, String(next));
          } catch {
            /* 存储不可用时保留本窗口偏好。 */
          }
        }}
      />
      {expanded ? (
        <div id={id} className="max-h-72 overflow-y-auto overscroll-contain pt-2">
          <MetricsExpanded key={scope} {...props} />
        </div>
      ) : null}
    </div>
  );
});
