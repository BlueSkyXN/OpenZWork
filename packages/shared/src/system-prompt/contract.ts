import { z } from "zod";

export const SYSTEM_PROMPT_SECTION_IDS = [
  "cli_prefix",
  "role",
  "security",
  "harness",
  "desktop_context",
  "communication",
  "execution",
  "session_guidance",
  "memory",
  "env_info",
  "output_style",
  "context_management",
  "persistence",
  "system_context",
  "skills",
  "request_user_context",
  "current_date",
] as const;
export type SystemPromptSectionId = (typeof SYSTEM_PROMPT_SECTION_IDS)[number];
export const GENERATED_SYSTEM_PROMPT_SECTIONS: readonly SystemPromptSectionId[] = [
  "env_info",
  "system_context",
  "skills",
  "request_user_context",
  "current_date",
];
export const systemPromptSectionIdSchema = z.enum(SYSTEM_PROMPT_SECTION_IDS);
export const systemPromptSectionOverrideSchema = z
  .object({
    mode: z.enum(["default", "append", "replace", "disabled"]),
    content: z.string().max(32_000),
    baseContent: z.string().max(32_000).optional(),
  })
  .strict();
export type SystemPromptSectionOverride = z.infer<typeof systemPromptSectionOverrideSchema>;

export const systemPromptSettingsSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["sections", "replace"]),
    sections: z.partialRecord(systemPromptSectionIdSchema, systemPromptSectionOverrideSchema),
    replacement: z.string().max(64_000),
    customSections: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            title: z.string().trim().min(1).max(80),
            content: z.string().trim().min(1).max(32_000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (settings.mode === "replace" && !settings.replacement.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["replacement"],
        message: "Replacement cannot be empty",
      });
    }
    for (const id of SYSTEM_PROMPT_SECTION_IDS) {
      const override = settings.sections[id];
      if (!override) continue;
      if (
        GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id) &&
        override.mode !== "default" &&
        override.mode !== "disabled"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", id, "mode"],
          message: "Generated context supports default or disabled",
        });
      }
      if ((override.mode === "append" || override.mode === "replace") && !override.content.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", id, "content"],
          message: "Custom content cannot be empty",
        });
      }
    }
    if (
      new Set(settings.customSections.map((section) => section.id)).size !==
      settings.customSections.length
    ) {
      ctx.addIssue({ code: "custom", path: ["customSections"], message: "Duplicate section ID" });
    }
    if (JSON.stringify(settings).length > 256_000) {
      ctx.addIssue({ code: "custom", message: "Prompt settings exceed 256000 characters" });
    }
  });
export type SystemPromptSettings = z.infer<typeof systemPromptSettingsSchema>;

export function createDefaultSystemPromptSettings(): SystemPromptSettings {
  return { version: 1, mode: "sections", sections: {}, replacement: "", customSections: [] };
}

/** 运行时和编辑器共用本章解析；模板变量来自已解析的运行环境。 */
export function resolveSystemPromptSection(
  settings: SystemPromptSettings | undefined,
  id: SystemPromptSectionId,
  defaultContent: string,
  variables: Readonly<Record<string, string>> = {},
): string {
  const override =
    settings?.mode === "sections" || GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id)
      ? settings?.sections[id]
      : undefined;
  if (!override || override.mode === "default") return defaultContent;
  if (override.mode === "disabled") return "";
  const custom = override.content
    .trim()
    .replace(
      /\{\{(memoryRoot|genUiOutputDirectory)\}\}/g,
      (match, key: string) => variables[key] ?? match,
    );
  return override.mode === "replace"
    ? custom
    : [defaultContent, custom].filter(Boolean).join("\n\n");
}

/** 情景仅供预览；运行时使用同一形状承载本次构建的真实事实。 */
export const systemPromptRuntimeTemplateSchema = z
  .object({
    available: z.boolean(),
    defaultContent: z.string().max(32_000),
    runtimeBefore: z.string().max(32_000),
    runtimeAfter: z.string().max(32_000),
    variables: z
      .object({ memoryRoot: z.string().optional(), genUiOutputDirectory: z.string().optional() })
      .strict(),
  })
  .strict();
export type SystemPromptRuntimeTemplate = z.infer<typeof systemPromptRuntimeTemplateSchema>;

export const SYSTEM_PROMPT_PREVIEW_SCENARIOS = [
  "gen_ui_available",
  "gen_ui_unavailable",
  "terminal",
  "memory_enabled",
  "memory_disabled",
  "skills_available",
  "skills_unavailable",
  "style_active",
  "style_none",
] as const;

export function resolveSystemPromptRuntimeSection(
  settings: SystemPromptSettings | undefined,
  id: SystemPromptSectionId,
  template: SystemPromptRuntimeTemplate,
): string {
  if (!template.available) return "";
  const override = settings?.sections[id];
  if (settings?.mode !== "replace" && (!override || override.mode === "default")) {
    return template.defaultContent;
  }
  if (settings?.mode !== "replace" && override?.mode === "append") {
    return resolveSystemPromptSection(settings, id, template.defaultContent, template.variables);
  }
  // 能力与路径由 runtime 提供；替换/关闭规则不能把某次预览的条件固化为事实。
  const rules =
    settings?.mode === "replace"
      ? ""
      : resolveSystemPromptSection(settings, id, "", template.variables);
  return [template.runtimeBefore, rules, template.runtimeAfter].filter(Boolean).join("\n\n");
}

export const systemPromptCatalogSchema = z
  .object({
    version: z.literal(2),
    sections: z.array(
      z
        .object({
          id: systemPromptSectionIdSchema,
          content: z.string().max(32_000),
          generated: z.boolean(),
          injectionTarget: z.enum(["system", "meta_user"]),
          runtime: z.boolean(),
          scenarios: z.array(
            z
              .object({
                id: z.enum(SYSTEM_PROMPT_PREVIEW_SCENARIOS),
                template: systemPromptRuntimeTemplateSchema,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type SystemPromptCatalog = z.infer<typeof systemPromptCatalogSchema>;

export const systemPromptCatalogParamsSchema = z.object({}).strict();
