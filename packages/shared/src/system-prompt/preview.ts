import { z } from "zod";
import { systemPromptSettingsSchema } from "./contract.js";

export const SYSTEM_PROMPT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const SYSTEM_PROMPT_PREVIEW_MAX_BLOCKS = 1024;

export const systemPromptPreviewScenarioSchema = z
  .object({
    surface: z.enum(["desktop", "terminal"]),
    memory: z.boolean(),
    skills: z.boolean(),
    outputStyle: z.boolean(),
    git: z.boolean(),
    visualization: z.boolean(),
  })
  .strict();
export type SystemPromptPreviewScenario = z.infer<typeof systemPromptPreviewScenarioSchema>;
export const DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO: SystemPromptPreviewScenario = {
  surface: "desktop",
  memory: true,
  skills: true,
  outputStyle: false,
  git: true,
  visualization: true,
};

export const systemPromptPreviewBlockSchema = z
  .object({
    id: z.string().min(1).max(160),
    source: z.string().min(1).max(160),
    title: z.string().max(200),
    target: z.enum(["system", "meta_user"]),
    content: z.string().max(SYSTEM_PROMPT_PREVIEW_MAX_BYTES),
  })
  .strict();
export type SystemPromptPreviewBlock = z.infer<typeof systemPromptPreviewBlockSchema>;
export const systemPromptPreviewDocumentSchema = z
  .object({
    blocks: z.array(systemPromptPreviewBlockSchema).max(SYSTEM_PROMPT_PREVIEW_MAX_BLOCKS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength > SYSTEM_PROMPT_PREVIEW_MAX_BYTES
    ) {
      ctx.addIssue({ code: "custom", message: "Prompt preview exceeds 1 MiB" });
    }
  });
export type SystemPromptPreviewDocument = z.infer<typeof systemPromptPreviewDocumentSchema>;

export const systemPromptPreviewParamsSchema = z
  .object({
    settings: systemPromptSettingsSchema,
    baseline: systemPromptSettingsSchema.optional(),
    scenario: systemPromptPreviewScenarioSchema,
  })
  .strict();
export type SystemPromptPreviewParams = z.infer<typeof systemPromptPreviewParamsSchema>;
export const systemPromptPreviewResultSchema = z
  .object({
    after: systemPromptPreviewDocumentSchema,
    before: systemPromptPreviewDocumentSchema.optional(),
  })
  .strict();
export type SystemPromptPreviewResult = z.infer<typeof systemPromptPreviewResultSchema>;

export const systemPromptObservationParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    snapshotId: z.string().min(1).max(160).optional(),
    settings: systemPromptSettingsSchema.optional(),
  })
  .strict();
export type SystemPromptObservationParams = z.infer<typeof systemPromptObservationParamsSchema>;
export const systemPromptObservationResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum(["no_request", "expired", "incomplete", "unsupported"]),
    })
    .strict(),
  z
    .object({
      status: z.literal("available"),
      snapshotId: z.string().min(1).max(160),
      sessionId: z.string().min(1),
      capturedAt: z.string().datetime(),
      model: z.string().max(500),
      boundary: z.literal("application-request"),
      actual: systemPromptPreviewDocumentSchema,
      comparison: systemPromptPreviewDocumentSchema.optional(),
      comparisonUnavailable: z.enum(["context_unavailable", "incomplete"]).optional(),
    })
    .strict(),
]);
export type SystemPromptObservationResult = z.infer<typeof systemPromptObservationResultSchema>;

export function systemPromptDocumentText(document: SystemPromptPreviewDocument): string {
  return document.blocks.map((block) => block.content).join("\n\n");
}
