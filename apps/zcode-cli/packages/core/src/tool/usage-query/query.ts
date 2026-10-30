import { z } from "zod";
import { appUsageToolParamsSchema, appUsageToolResultSchema } from "@zcode/shared";
import type { JsonSchema } from "@zcode/contracts";
import type { ToolEntry } from "../types.js";

export const queryUsageToolEntry: ToolEntry = {
  capability: "Read local token usage by project, model and session",
  metadata: {
    name: "QueryUsage",
    shouldDefer: true,
    description:
      "Read the local Host's recorded token usage for all projects or one project. Omit projectId to get totals and available project IDs; pass an ID from that result to filter, or null for unassigned sessions. The same data powers Settings > Usage. Includes model and session/subtask breakdowns, reported failed-request usage, query time and retention. Records are retained for 30 days; this is token consumption, not a monetary bill or provider balance. Never guess a project ID.",
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
    timeoutMs: 30_000,
    maxOutputBytes: 128_000,
  },
  inputSchema: z.toJSONSchema(appUsageToolParamsSchema) as JsonSchema,
  outputSchema: z.toJSONSchema(appUsageToolResultSchema) as JsonSchema,
  runtimeInputSchema: appUsageToolParamsSchema,
  runtimeOutputSchema: appUsageToolResultSchema,
  handler: async (input, context) => {
    if (!context.usageQueryPort)
      throw new Error("Local Host usage query is unavailable in this session");
    const params = appUsageToolParamsSchema.parse(input);
    const report = await context.usageQueryPort.query(params, context.abortSignal);
    return appUsageToolResultSchema.parse({ report });
  },
  formatModelContent: (output) => appUsageToolResultSchema.parse(output).report,
  permission: {
    permission: "usage.read",
    reason: "Read recorded local token usage",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: 128_000,
    maxModelBytes: 128_000,
    strategy: "truncate",
    preview: { maxBytes: 128_000, direction: "head" },
  },
  timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
  cancellation: { supported: true, cleanup: "none", userVisibleMessage: "Usage query cancelled" },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
