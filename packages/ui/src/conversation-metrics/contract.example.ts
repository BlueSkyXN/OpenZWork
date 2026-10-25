import { normalizeMetricsDisplayPreferences, type TurnMetricsDetailsProps } from "./contract.js";
export function turnDetailProps(
  header: TurnMetricsDetailsProps["header"],
): TurnMetricsDetailsProps {
  return { header };
}

export const compactMetricsPreference = normalizeMetricsDisplayPreferences({
  version: 1,
  enabled: true,
  visibleFields: ["speed", "turnTokens"],
});
