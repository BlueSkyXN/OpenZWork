import type { AppUsageSnapshot } from "@zcode/shared";
import type { ConversationSnapshot, TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";

export interface ConversationMetricsBarProps {
  snapshot: ConversationSnapshot;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  displayPreferences?: MetricsDisplayPreferences;
}
export interface TurnMetricsDetailsProps {
  header: TurnHeaderRow;
}

export const METRICS_DISPLAY_FIELDS = [
  { id: "statusDuration", priority: 0, defaultVisible: true },
  { id: "speed", priority: 2, defaultVisible: true },
  { id: "firstText", priority: 3, defaultVisible: true },
  { id: "turnTokens", priority: 1, defaultVisible: true },
  { id: "cache", priority: 4, defaultVisible: true },
  { id: "sessionTokens", priority: 5, defaultVisible: false },
  { id: "toolCalls", priority: 6, defaultVisible: false },
] as const;
export type MetricsFieldId = (typeof METRICS_DISPLAY_FIELDS)[number]["id"];
export interface MetricsDisplayPreferences {
  version: 1;
  enabled: boolean;
  visibleFields: readonly MetricsFieldId[];
}
export const METRICS_PREFERENCES_STORAGE_KEY = "openzwork.conversation-metrics.preferences.v1";
export const DEFAULT_METRICS_DISPLAY_PREFERENCES: MetricsDisplayPreferences = {
  version: 1,
  enabled: true,
  visibleFields: METRICS_DISPLAY_FIELDS.filter((field) => field.defaultVisible).map(
    (field) => field.id,
  ),
};

export function normalizeMetricsDisplayPreferences(value: unknown): MetricsDisplayPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return DEFAULT_METRICS_DISPLAY_PREFERENCES;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return DEFAULT_METRICS_DISPLAY_PREFERENCES;
  const selected = Array.isArray(raw.visibleFields) ? new Set(raw.visibleFields) : null;
  return {
    version: 1,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    visibleFields: selected
      ? METRICS_DISPLAY_FIELDS.filter((field) => selected.has(field.id)).map((field) => field.id)
      : DEFAULT_METRICS_DISPLAY_PREFERENCES.visibleFields,
  };
}

export function metricsPreferencesEqual(
  a: MetricsDisplayPreferences,
  b: MetricsDisplayPreferences,
): boolean {
  return (
    a.enabled === b.enabled &&
    a.visibleFields.length === b.visibleFields.length &&
    a.visibleFields.every((id, index) => id === b.visibleFields[index])
  );
}

/** 折叠优先级独立于显示顺序；仅从用户已选字段中减项。 */
export function fitMetricsFields(
  items: readonly { id: MetricsFieldId; width: number }[],
  availableWidth: number,
  triggerWidth: number,
  gap: number,
): MetricsFieldId[] {
  const visible = new Set(items.map((item) => item.id));
  let width = items.reduce((sum, item) => sum + item.width + gap, triggerWidth);
  for (const field of [...METRICS_DISPLAY_FIELDS].sort((a, b) => b.priority - a.priority)) {
    if (width <= availableWidth) break;
    const item = items.find((item) => item.id === field.id);
    if (!item) continue;
    visible.delete(item.id);
    width -= item.width + gap;
  }
  return items.filter((item) => visible.has(item.id)).map((item) => item.id);
}

export function latestMetricsTurn(snapshot: ConversationSnapshot): TurnHeaderRow | undefined {
  return snapshot.rows.window.findLast(
    (row): row is TurnHeaderRow => row.kind === "turnHeader" && row.executionKind !== "controlOnly",
  );
}

/** 快照时区和生成日期共同决定本机今日；不将浏览器时区混入后端日桶。 */
export function todayTokens(snapshot: AppUsageSnapshot): number {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: snapshot.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(snapshot.generatedAt));
  const read = (type: string) => parts.find((part) => part.type === type)?.value;
  const date = `${read("year")}-${read("month")}-${read("day")}`;
  return (
    snapshot.dailyModelUsage
      .find((day) => day.date === date)
      ?.models.reduce((total, model) => total + model.totalTokens, 0) ?? 0
  );
}
