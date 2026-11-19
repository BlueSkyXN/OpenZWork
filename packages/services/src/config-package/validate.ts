import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  CONFIG_PACKAGE_LIMITS,
  SKILL_DATA_SYNC_MAX_ITEM_BYTES,
  configPackageSchema,
  type ConfigEntry,
  type ConfigPackage,
} from "@zcode/shared";
import {
  extractSkillSyncArchive,
  hashDirectoryContent,
  parseSkillMetadata,
  parseSubagentMarkdown,
  walkSkillMarkdownPaths,
} from "../data-sync/node.js";
import { decodeHooks, decodeSkills } from "./categories.js";
import { contentHash, personalData, providerEntries, stableJson } from "./personal.js";

const SKILL_PATHS_ERROR = "config-package.skill-paths";
function check(value: unknown): asserts value {
  if (!value) throw new Error("config-package.invalid");
}
function match(entries: ConfigEntry[], expected: ConfigEntry[]) {
  const byKey = new Map(expected.map((item) => [item.key, item]));
  check(entries.length === expected.length && byKey.size === expected.length);
  for (const entry of entries) {
    const item = byKey.get(entry.key);
    check(item && item.hash === entry.hash && item.name === entry.name);
  }
}
async function validateSkills(
  group: NonNullable<ConfigPackage["categories"]["skills"]>,
  comparison?: Map<string, string>,
) {
  const { items, archive } = decodeSkills(group);
  check(archive.byteLength <= SKILL_DATA_SYNC_MAX_ITEM_BYTES);
  // 同步包内层也是 gzip。先约束含 tar 头和填充的展开量，再交给原解包器检查路径与实际文件总量。
  await promisify(gunzip)(archive, { maxOutputLength: CONFIG_PACKAGE_LIMITS.json });
  const scratch = await mkdtemp(join(tmpdir(), "openzwork-config-"));
  try {
    await extractSkillSyncArchive(archive, scratch, {
      maxExtractedBytes: SKILL_DATA_SYNC_MAX_ITEM_BYTES,
    });
    const expected: ConfigEntry[] = [];
    // 按物理路径核对，按 name 去重的来源列表可能漏掉父目录中夹带的同名安装。
    const declared = new Map(items.map((item) => [item.directoryName, item]));
    for await (const markdown of walkSkillMarkdownPaths(scratch, {
      onError: (_path, error) => {
        throw error;
      },
    })) {
      const dir = dirname(markdown);
      const directoryName = relative(scratch, dir).split(sep).join("/");
      const item = declared.get(directoryName);
      if (!item) throw new Error(SKILL_PATHS_ERROR);
      declared.delete(directoryName);
      const metadata = parseSkillMetadata(await readFile(markdown, "utf8"), basename(dir));
      check(item.name === metadata.name && item.key === metadata.name.trim().toLowerCase());
      const hash = await hashDirectoryContent(dir, { includeExecutableBits: !!comparison });
      comparison?.set(item.key, hash);
      expected.push({ key: item.key, name: item.name, hash: hash.split(":")[0]! });
    }
    if (declared.size) throw new Error(SKILL_PATHS_ERROR);
    match(group.entries, expected);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function validatePackage(
  value: unknown,
  skillComparison?: Map<string, string>,
): Promise<ConfigPackage> {
  if (
    value &&
    typeof value === "object" &&
    "formatVersion" in value &&
    typeof value.formatVersion === "number" &&
    value.formatVersion > 1
  )
    throw new Error("config-package.future-version");
  try {
    const file = configPackageSchema.parse(value);
    const { commands, subagents, hooks, mcp, skills, providers, systemPrompt } = file.categories;
    if (commands)
      match(
        commands.entries,
        commands.payload.items.map((item) => {
          const name = "/" + item.relativePath.replace(/\.md$/iu, "");
          check(item.name === name && item.key === name.toLowerCase());
          return { key: item.key, name, hash: contentHash(Buffer.from(item.content, "base64")) };
        }),
      );
    if (subagents)
      match(
        subagents.entries,
        subagents.payload.items.map((item) => {
          const content = Buffer.from(item.content, "base64");
          const parsed = parseSubagentMarkdown({
            content: content.toString("utf8"),
            path: item.fileName,
            scope: "user",
          }).agent;
          check(
            parsed && parsed.name === item.name && item.key === parsed.name.trim().toLowerCase(),
          );
          return { key: item.key, name: item.name, hash: contentHash(content) };
        }),
      );
    if (hooks)
      match(
        hooks.entries,
        decodeHooks(hooks).items.map(({ key, event, matcher, definition }) => {
          const { enabled: _, ...comparable } = definition;
          const variant = definition.type === "process" ? definition.args : definition.shell;
          check(
            key ===
              contentHash(
                JSON.stringify([
                  event,
                  matcher ?? null,
                  definition.type,
                  definition.command,
                  variant ?? null,
                ]),
              ),
          );
          return { key, name: event, hash: contentHash(stableJson(comparable)) };
        }),
      );
    if (mcp)
      match(
        mcp.entries,
        mcp.payload.items.map(({ key, name, config }) => {
          check(
            key === name.trim().toLowerCase() &&
              !["__proto__", "constructor", "prototype"].includes(key),
          );
          const comparable = Object.fromEntries(
            Object.entries(config).filter(([k]) => k !== "enabled" && k !== "enable"),
          );
          return { key, name, hash: contentHash(stableJson(comparable)) };
        }),
      );
    if (skills)
      await validateSkills(skills, file.sourcePlatform === "win32" ? undefined : skillComparison);
    if (providers) match(providers.entries, providerEntries(personalData(providers.payload)));
    if (systemPrompt)
      match(
        systemPrompt.entries,
        systemPrompt.payload
          ? [
              {
                key: "systemPrompt",
                name: "systemPrompt",
                hash: contentHash(stableJson(systemPrompt.payload)),
              },
            ]
          : [],
      );
    return file;
  } catch (error) {
    if (error instanceof Error && error.message === SKILL_PATHS_ERROR) throw error;
    throw new Error("config-package.invalid");
  }
}
