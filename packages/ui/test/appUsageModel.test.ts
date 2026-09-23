import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_USAGE_MODEL_CHART_COLORS,
  getAppUsageModelChartColor,
} from "../src/settings/usage-stats/appUsageChartPalette.js";

test("App Usage model colors reuse the shared chart palette and wrap", () => {
  assert.equal(getAppUsageModelChartColor(0), APP_USAGE_MODEL_CHART_COLORS[0]);
  assert.equal(
    getAppUsageModelChartColor(APP_USAGE_MODEL_CHART_COLORS.length),
    APP_USAGE_MODEL_CHART_COLORS[0],
  );
  assert.equal(getAppUsageModelChartColor(-1), APP_USAGE_MODEL_CHART_COLORS[0]);
});
