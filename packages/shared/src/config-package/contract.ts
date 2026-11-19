import { z } from "zod";
import { providerProvisioningPersonalConfigSchema } from "../provider-provisioning.js";
import { systemPromptSettingsSchema } from "../system-prompt/index.js";

export const CONFIG_PACKAGE_CATEGORIES = [
  "subagents",
  "commands",
  "hooks",
  "mcp",
  "skills",
  "providers",
  "systemPrompt",
] as const;
export type ConfigCategory = (typeof CONFIG_PACKAGE_CATEGORIES)[number];
export const CONFIG_PACKAGE_LIMITS = { compressed: 50 * 1024 ** 2, json: 200 * 1024 ** 2 } as const;
export const configCategoriesSchema = z
  .array(z.enum(CONFIG_PACKAGE_CATEGORIES))
  .nonempty()
  .refine((keys) => new Set(keys).size === keys.length);
const name = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z.strictObject({ key: name, name, hash });
export type ConfigEntry = z.infer<typeof entry>;
const entries = z.array(entry);
const base64 = z.string().refine((s) => {
  if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(s)) return false;
  const pad = s.indexOf("=");
  if (pad < 0) return true;
  const tail = s.slice(pad);
  if (tail !== "=" && tail !== "==") return false;
  const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
    s[pad - 1] ?? "",
  );
  return value >= 0 && (value & (tail === "=" ? 3 : 15)) === 0;
});
const segmentPath = name.refine((s) =>
  s.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\:]/u.test(part)),
);
const fileItem = { key: name, name, enabled: z.boolean(), content: base64 };
const keyed = { key: name, name, enabled: z.boolean() };
const sourceHomeDir = name;
const subagents = z.strictObject({
  entries,
  payload: z.strictObject({
    sourceHomeDir,
    items: z.array(
      z.strictObject({ ...fileItem, fileName: name.regex(/^[^/\\:]+\.(?:md|markdown)$/iu) }),
    ),
  }),
});
const commands = z.strictObject({
  entries,
  payload: z.strictObject({
    sourceHomeDir,
    items: z.array(
      z.strictObject({
        ...fileItem,
        relativePath: segmentPath.refine(
          (s) => /\.md$/iu.test(s) && s.split("/").every((p) => !p.startsWith(".")),
        ),
      }),
    ),
  }),
});
const hooks = z.strictObject({
  entries,
  payload: z.strictObject({
    sourceHomeDir,
    rootEnabled: z.boolean(),
    items: z.array(
      z.strictObject({
        key: name,
        event: z.enum([
          "SessionStart",
          "UserPromptSubmit",
          "PreToolUse",
          "PermissionRequest",
          "PostToolUse",
          "PostToolUseFailure",
          "Stop",
        ]),
        matcher: name.optional(),
        definition: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
});
const strings = z.record(z.string(), z.string());
const mcpConfig = z.looseObject({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: strings.optional(),
  environment: strings.optional(),
  headers: strings.optional(),
  http_headers: strings.optional(),
});
const mcp = z.strictObject({
  entries,
  payload: z.strictObject({
    sourceHomeDir,
    items: z.array(z.strictObject({ ...keyed, config: mcpConfig })),
  }),
});
const skills = z.strictObject({
  entries,
  payload: z.strictObject({
    sourceHomeDir,
    archive: base64,
    items: z.array(z.strictObject({ ...keyed, directoryName: segmentPath })),
  }),
});
const providers = z.strictObject({ entries, payload: providerProvisioningPersonalConfigSchema });
const systemPrompt = z.strictObject({ entries, payload: systemPromptSettingsSchema.nullable() });

export const configPackageSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    appVersion: name,
    sourcePlatform: z.enum(["darwin", "win32", "linux"]),
    sourceHomeDir,
    exportedAt: z.iso.datetime(),
    categories: z
      .strictObject({ subagents, commands, hooks, mcp, skills, providers, systemPrompt })
      .partial(),
  })
  .superRefine((file, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "Invalid configuration package manifest" });
    if (Object.keys(file.categories).length === 0) fail();
    for (const group of Object.values(file.categories)) {
      const keys = new Set(group.entries.map((e) => e.key));
      if (keys.size !== group.entries.length) fail();
      if (group.payload && "sourceHomeDir" in group.payload) {
        const items = group.payload.items;
        if (
          group.payload.sourceHomeDir !== file.sourceHomeDir ||
          items.length !== keys.size ||
          new Set(items.map((i) => i.key)).size !== keys.size ||
          items.some((i) => !keys.has(i.key))
        )
          fail();
      }
    }
  });
export type ConfigPackage = z.infer<typeof configPackageSchema>;
export type ConfigGroups = ConfigPackage["categories"];
export type ConfigCounts = Partial<Record<ConfigCategory, number>>;
export type ConfigExportResult = { counts: ConfigCounts; bytes: number };
export type ConfigRow = {
  category: ConfigCategory;
  key: string;
  name: string;
  status: "new" | "same" | "different" | "blocked";
  reason?: string;
  absolutePath?: boolean;
};
export type ConfigPreview = {
  previewId: string;
  counts: ConfigCounts;
  rows: ConfigRow[];
  sourcePlatform: string;
  appVersion: string;
  differentVersion: boolean;
  differentPlatform: boolean;
  defaultModelCandidate?: ConfigDefaultModel;
};
export type ConfigDefaultModel = { providerId: string; modelId: string };
export type ConfigSelection = Pick<ConfigRow, "category" | "key">;
export type ConfigResultItem = ConfigSelection & {
  status: "created" | "updated" | "failed" | "conflict" | "skipped";
  reason?: string;
};
export type ConfigApplyResult = {
  items: ConfigResultItem[];
  defaultModelSkipped?: boolean;
  defaultModelApplied?: ConfigDefaultModel;
};
