import { z } from "zod";
import {
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  SYSTEM_PROMPT_SECTION_IDS,
  resolveSystemPromptSection,
  systemPromptSettingsSchema,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "./contract.js";

export const SYSTEM_PROMPT_PROFILE_MAX_BYTES = 2 * 1024 * 1024;
export const systemPromptProfileSchema = z
  .object({
    schema: z.literal("openzwork.system-prompt-profile"),
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(1_000).optional(),
    settings: systemPromptSettingsSchema,
  })
  .strict();
export type SystemPromptProfile = z.infer<typeof systemPromptProfileSchema>;

export function parseSystemPromptProfile(text: string): SystemPromptProfile {
  if (new TextEncoder().encode(text).byteLength > SYSTEM_PROMPT_PROFILE_MAX_BYTES) {
    throw new Error("Profile exceeds 2 MiB");
  }
  return systemPromptProfileSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
}

/** Profile 只生成候选草稿；不归一化未点名的编辑内容，不改变保存基准。 */
export function mergeSystemPromptProfile(
  draft: SystemPromptSettings,
  profile: SystemPromptProfile,
  catalog: SystemPromptCatalog,
): SystemPromptSettings {
  const incoming = systemPromptProfileSchema.parse(profile).settings;
  const sections = { ...draft.sections };
  for (const id of SYSTEM_PROMPT_SECTION_IDS) {
    const value = incoming.sections[id];
    if (!value) continue;
    const entry = catalog.sections.find((item) => item.id === id);
    if (!entry) throw new Error(`Missing catalog section: ${id}`);
    sections[id] = { mode: value.mode, content: value.content, baseContent: entry.content };
  }
  const additions = new Map(incoming.customSections.map((item) => [item.id, item]));
  const customSections = draft.customSections.map((item) => {
    const replacement = additions.get(item.id);
    additions.delete(item.id);
    return replacement ?? item;
  });
  const candidate: SystemPromptSettings = {
    ...draft,
    mode: incoming.mode,
    replacement: incoming.replacement,
    sections,
    customSections: [...customSections, ...additions.values()],
  };
  // 校验整个合并结果才能发现总量超限；parse 的 trim 结果不能覆盖其他未保存章。
  systemPromptSettingsSchema.parse(candidate);
  return candidate;
}

export function exportSystemPromptProfile(
  draft: SystemPromptSettings,
  metadata: { id: string; name: string; description?: string },
): SystemPromptProfile {
  const settings = systemPromptSettingsSchema.parse(draft);
  for (const value of Object.values(settings.sections)) {
    if (value) delete value.baseContent;
  }
  return systemPromptProfileSchema.parse({
    schema: "openzwork.system-prompt-profile",
    schemaVersion: 1,
    ...metadata,
    settings,
  });
}

/** 只复制规则，不从运行预览复制路径、能力事实或用户文件。 */
export function createSystemPromptReplacement(
  settings: SystemPromptSettings,
  catalog: SystemPromptCatalog,
): SystemPromptSettings {
  const rules = catalog.sections
    .filter((entry) => !GENERATED_SYSTEM_PROMPT_SECTIONS.includes(entry.id))
    .map((entry) =>
      resolveSystemPromptSection({ ...settings, mode: "sections" }, entry.id, entry.content),
    )
    .filter((content) => content.trim());
  for (const section of settings.customSections)
    rules.push(`# ${section.title}\n\n${section.content}`);
  const candidate = { ...settings, mode: "replace" as const, replacement: rules.join("\n\n") };
  systemPromptSettingsSchema.parse(candidate);
  return candidate;
}
