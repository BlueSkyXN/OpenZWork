import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  conversationMetricsPreferences,
  useConversationMetricsPreferences,
} from "@/store/conversationMetricsPreferencesStore.js";
import { METRICS_DISPLAY_FIELDS } from "./contract.js";
import { MetricsSummaryRow } from "./MetricsSummaryRow.js";

const PREVIEW_HEADER = {
  state: "completedSuccess" as const,
  activeMs: 42000,
  toolCallCount: 3,
  metrics: {
    requestCount: 2,
    failureCount: 0,
    unknownUsageCount: 0,
    usage: { inputTokens: 62500, outputTokens: 2100, cacheReadTokens: 56250 },
    latest: {
      status: "completed" as const,
      outputTokens: 172,
      durationMs: 3400,
      timeToFirstContentMs: 1400,
      timeToFirstTextMs: 1600,
    },
  },
};
const PREVIEW_CUMULATIVE = { inputTokens: 100000, outputTokens: 2000 };

export function MetricsDisplaySettings() {
  const preferences = useConversationMetricsPreferences();
  const { update, reset } = conversationMetricsPreferences.store.getState();
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `metrics.display.${key}` });
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label={t("title")}
      data-testid="metrics-display-settings"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ui-lg font-semibold text-foreground">{t("title")}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          data-testid="metrics-display-reset"
        >
          {t("reset")}
        </Button>
      </div>
      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ui-base">{t("enabled")}</span>
            <Switch
              checked={preferences.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              aria-label={t("enabled")}
              data-testid="metrics-display-enabled"
            />
          </div>
          <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-3 text-ui-sm text-foreground-subtle">{t("fields")}</legend>
            {METRICS_DISPLAY_FIELDS.map((field) => (
              <label key={field.id} className="flex cursor-pointer items-center gap-2 text-ui-base">
                <Checkbox
                  checked={preferences.visibleFields.includes(field.id)}
                  aria-label={t(`field.${field.id}`)}
                  data-testid={`metrics-display-field-${field.id}`}
                  onCheckedChange={(checked) =>
                    update({
                      visibleFields:
                        checked === true
                          ? [...preferences.visibleFields, field.id]
                          : preferences.visibleFields.filter((id) => id !== field.id),
                    })
                  }
                />
                {t(`field.${field.id}`)}
              </label>
            ))}
          </fieldset>
          <div
            className="space-y-2 border-t border-border pt-3"
            data-testid="metrics-display-preview"
          >
            <p className="text-ui-sm text-foreground-subtle">{t("preview")}</p>
            {preferences.enabled && preferences.visibleFields.length > 0 ? (
              <MetricsSummaryRow
                header={PREVIEW_HEADER}
                cumulative={PREVIEW_CUMULATIVE}
                fields={preferences.visibleFields}
              />
            ) : (
              <p className="text-ui-sm text-foreground-subtle">
                {t(preferences.enabled ? "empty" : "hidden")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
