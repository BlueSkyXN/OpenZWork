import { posix, win32 } from "node:path";
import type {
  CommandDataSyncPayload,
  ConfigEntry,
  ConfigGroups,
  DataSyncListItem,
  HookDataSyncPayload,
  McpDataSyncPayload,
  SkillDataSyncPayload,
  SubagentDataSyncPayload,
  UserConfigSyncCategory,
  UserConfigSyncPayloadMap,
} from "@zcode/shared";
import type { IDataSyncCategoryService, IUserConfigSyncService } from "../data-sync/index.js";
import { workspaceHookMatcherConfigSchema } from "@zcode/shared/workspace-hook-discovery";

export function userCategory<C extends UserConfigSyncCategory>(
  owner: IUserConfigSyncService,
  category: C,
): IDataSyncCategoryService<UserConfigSyncPayloadMap[C]> {
  return {
    listSyncItems: () => owner.listSyncItems({ category }),
    getSyncContentHashes: ({ keys }) => owner.getSyncContentHashes({ category, keys }),
    checkSyncWriteAccess: () => owner.checkSyncWriteAccess({ category }),
    exportSyncItems: ({ keys }) => owner.exportSyncItems({ category, keys }),
    importSyncItems: ({ payload, items }) => owner.importSyncItems({ category, payload, items }),
  };
}

export type SyncOwners = {
  subagents: IDataSyncCategoryService<SubagentDataSyncPayload>;
  commands: IDataSyncCategoryService<CommandDataSyncPayload>;
  hooks: IDataSyncCategoryService<HookDataSyncPayload>;
  mcp: IDataSyncCategoryService<McpDataSyncPayload>;
  skills: IDataSyncCategoryService<SkillDataSyncPayload>;
};

function requireUnchanged(value: unknown): asserts value {
  if (!value) throw new Error("config-package.source-changed");
}

export async function collectCategory<T>(
  owner: IDataSyncCategoryService<T>,
  category: keyof SyncOwners,
) {
  const listed = await owner.listSyncItems();
  const items =
    category === "subagents"
      ? listed.items.filter((item) => !item.builtInModelOverride)
      : listed.items;
  if (items.some((item) => item.exportBlockedReason))
    throw new Error("config-package.export-blocked");
  const keys = items.map((item) => item.key);
  const before = (await owner.getSyncContentHashes({ keys })).hashes;
  requireUnchanged(
    keys.every((key) => Object.hasOwn(before, key) && typeof before[key] === "string"),
  );
  let payload: T;
  try {
    payload = await owner.exportSyncItems({ keys });
  } catch {
    const after = (await owner.getSyncContentHashes({ keys })).hashes;
    requireUnchanged(keys.every((key) => before[key] === after[key]));
    throw new Error("config-package.export-blocked");
  }
  const after = (await owner.getSyncContentHashes({ keys })).hashes;
  const current = new Map((await owner.listSyncItems()).items.map((item) => [item.key, item]));
  const entries: ConfigEntry[] = items.map((item: DataSyncListItem) => {
    const latest = current.get(item.key);
    requireUnchanged(
      latest &&
        !latest.exportBlockedReason &&
        latest.enabled === item.enabled &&
        before[item.key] === after[item.key],
    );
    return {
      key: item.key,
      name: category === "hooks" ? item.name.split(" · ")[0]! : item.name,
      hash: before[item.key]!,
    };
  });
  return { entries, payload };
}

function encodeFiles<T extends { content: Uint8Array }>(items: T[]) {
  return items.map(({ content, ...rest }) => ({
    ...rest,
    content: Buffer.from(content).toString("base64"),
  }));
}
function decodeFiles<T extends { content: string }>(items: T[]) {
  return items.map(({ content, ...rest }) => ({
    ...rest,
    content: Buffer.from(content, "base64"),
  }));
}
export function decodeSubagents(
  group: NonNullable<ConfigGroups["subagents"]>,
): SubagentDataSyncPayload {
  return { ...group.payload, builtInModelOverrides: [], items: decodeFiles(group.payload.items) };
}
export function decodeCommands(
  group: NonNullable<ConfigGroups["commands"]>,
): CommandDataSyncPayload {
  return { ...group.payload, items: decodeFiles(group.payload.items) };
}
export function decodeHooks(group: NonNullable<ConfigGroups["hooks"]>): HookDataSyncPayload {
  return {
    ...group.payload,
    items: group.payload.items.map((item) => ({
      ...item,
      definition: workspaceHookMatcherConfigSchema.parse({
        matcher: item.matcher,
        hooks: [item.definition],
      }).hooks[0]!,
    })),
  };
}
export function decodeSkills(group: NonNullable<ConfigGroups["skills"]>): SkillDataSyncPayload {
  return { ...group.payload, archive: Buffer.from(group.payload.archive, "base64") };
}

export function decodeMcp(
  group: NonNullable<ConfigGroups["mcp"]>,
  targetHome: string,
): McpDataSyncPayload {
  const { sourceHomeDir, items } = group.payload;
  const sourcePath =
    posix.isAbsolute(sourceHomeDir) && !sourceHomeDir.startsWith("//") ? posix : win32;
  const targetPath = posix.isAbsolute(targetHome) && !targetHome.startsWith("//") ? posix : win32;
  function rewrite(value: string) {
    if (
      !sourcePath.isAbsolute(sourceHomeDir) ||
      !sourcePath.isAbsolute(value) ||
      value.split(sourcePath === win32 ? /[\\/]/u : "/").includes("..")
    )
      return value;
    const relative = sourcePath.relative(sourceHomeDir, value);
    if (
      relative === ".." ||
      relative.startsWith(".." + sourcePath.sep) ||
      sourcePath.isAbsolute(relative)
    )
      return value;
    return targetPath.join(targetHome, ...relative.split(sourcePath.sep));
  }
  const variables = (env: Record<string, string>) =>
    Object.fromEntries(Object.entries(env).map(([key, value]) => [key, rewrite(value)]));
  // 在原分类写入者之前完成 v1 的字段投影。载荷上的 home 随之更新，嵌套目标 home 也只改写一次。
  return {
    sourceHomeDir: targetHome,
    items: items.map((item) => {
      const c = item.config;
      const transport = typeof c.type === "string" ? c.type.trim().toLowerCase() : "";
      const stdio = transport ? transport === "stdio" : Boolean(c.command && !c.url);
      if (!stdio) return item;
      return {
        ...item,
        config: {
          ...c,
          ...(c.args && { args: c.args.map(rewrite) }),
          ...(typeof c.cwd === "string" && { cwd: rewrite(c.cwd) }),
          ...(c.env && { env: variables(c.env) }),
          ...(c.environment && { environment: variables(c.environment) }),
        },
      };
    }),
  };
}

export async function exportSyncCategory(
  groups: ConfigGroups,
  category: keyof SyncOwners,
  owners: SyncOwners,
) {
  switch (category) {
    case "commands": {
      const { entries, payload } = await collectCategory(owners.commands, category);
      groups.commands = { entries, payload: { ...payload, items: encodeFiles(payload.items) } };
      break;
    }
    case "subagents": {
      const { entries, payload } = await collectCategory(owners.subagents, category);
      groups.subagents = {
        entries,
        payload: { sourceHomeDir: payload.sourceHomeDir, items: encodeFiles(payload.items) },
      };
      break;
    }
    case "skills": {
      const { entries, payload } = await collectCategory(owners.skills, category);
      groups.skills = {
        entries,
        payload: { ...payload, archive: Buffer.from(payload.archive).toString("base64") },
      };
      break;
    }
    case "hooks":
      groups.hooks = await collectCategory(owners.hooks, category);
      break;
    case "mcp":
      groups.mcp = await collectCategory(owners.mcp, category);
      break;
  }
}
