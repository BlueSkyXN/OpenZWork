import { randomUUID } from "node:crypto";
import type {
  ConfigApplyResult,
  ConfigCategory,
  ConfigCounts,
  ConfigPackage,
  ConfigPreview,
  ConfigRow,
  ConfigSelection,
  DataSyncImportItem,
  DataSyncImportResult,
  DataSyncListResult,
} from "@zcode/shared";
import { CONFIG_PACKAGE_CATEGORIES } from "@zcode/shared";
import { readPackage } from "./file.js";
import {
  decodeSubagents,
  decodeCommands,
  decodeHooks,
  decodeMcp,
  decodeSkills,
  type SyncOwners,
} from "./categories.js";
import type { IConfigPackageService } from "./contract.js";

import {
  previewPersonal,
  applyProviders,
  applyPrompt,
  type PersonalPreview,
  type PersonalOwners,
} from "./personalImport.js";

type Owners = PersonalOwners & { owners: SyncOwners; home: string };
interface LocalState {
  hashes: Record<string, string>;
  list: DataSyncListResult;
}
export interface PreviewState {
  file: ConfigPackage;
  personal: PersonalPreview;
  rows: ConfigRow[];
  expected: Map<string, string>;
}
export function selectionId(item: ConfigSelection) {
  return JSON.stringify([item.category, item.key]);
}
export function countsOf(groups: ConfigPackage["categories"]): ConfigCounts {
  return Object.fromEntries(
    Object.entries(groups).map(([category, group]) => [category, group.entries.length]),
  );
}
function hasPath(value: unknown): boolean {
  if (typeof value === "string")
    return /(?:^|[\s"'=])(?:\/(?!\/)[^\s]|[A-Za-z]:[\\/]|\\\\[^\\])/u.test(value);
  if (Array.isArray(value)) return value.some(hasPath);
  return !!value && typeof value === "object" && Object.values(value).some(hasPath);
}

async function syncState(owner: SyncOwners[keyof SyncOwners], keys: string[]): Promise<LocalState> {
  const list = await owner.listSyncItems();
  const exists = new Set(list.items.map((item) => item.key));
  const { hashes } = await owner.getSyncContentHashes({
    keys: keys.filter((key) => exists.has(key)),
  });
  return { list, hashes };
}

async function buildPreview(
  file: ConfigPackage,
  options: Owners,
  platform: string,
): Promise<PreviewState> {
  const personal = await previewPersonal(file, options);
  const rows: ConfigRow[] = [],
    expected = new Map<string, string>();
  const pathWarnings = new Set<string>();
  if (file.sourcePlatform !== platform) {
    for (const item of file.categories.hooks?.payload.items ?? [])
      if (hasPath(item.definition))
        pathWarnings.add(selectionId({ category: "hooks", key: item.key }));
    for (const item of file.categories.mcp?.payload.items ?? [])
      if (hasPath(item.config)) pathWarnings.add(selectionId({ category: "mcp", key: item.key }));
  }
  for (const category of CONFIG_PACKAGE_CATEGORIES) {
    const group = file.categories[category];
    if (!group) continue;
    if (category === "providers" || category === "systemPrompt") {
      rows.push(...personal.rows.filter((row) => row.category === category));
      for (const [key, hash] of personal.hashes)
        if (category === "providers") expected.set(selectionId({ category, key }), hash);
      continue;
    }
    const state = await syncState(
      options.owners[category],
      group.entries.map((item) => item.key),
    ).catch(() => undefined);
    const existing = new Map(state?.list.items.map((item) => [item.key, item]));
    for (const { key, name, hash } of group.entries) {
      const id = selectionId({ category, key }),
        local = existing.get(key);
      const current = state && Object.hasOwn(state.hashes, key) ? state.hashes[key] : undefined;
      const reason = !state
        ? "target-read"
        : (state.list.importBlockedReason ??
          local?.overwriteBlockedReason ??
          (local && !current ? "target-read" : undefined));
      const status = reason ? "blocked" : !local ? "new" : current === hash ? "same" : "different";
      rows.push({
        category,
        key,
        name,
        status,
        ...(reason ? { reason } : {}),
        ...(pathWarnings.has(id) ? { absolutePath: true } : {}),
      });
      if (current) expected.set(id, current);
    }
  }
  return { file, rows, expected, personal };
}

function selectItems(state: PreviewState, selected: ConfigSelection[]) {
  if (!Array.isArray(selected)) throw new Error("config-package.selection");
  const allowed = new Map(
    state.rows
      .filter((r) => r.status === "new" || r.status === "different")
      .map((r) => [selectionId(r), r]),
  );
  const result = new Map<ConfigCategory, DataSyncImportItem[]>();
  for (const item of selected) {
    const id = item && selectionId(item),
      row = allowed.get(id);
    if (!row || !allowed.delete(id)) throw new Error("config-package.selection");
    const group = result.get(row.category) ?? [];
    group.push(
      row.status === "new"
        ? { key: row.key, mode: "createOnly" }
        : { key: row.key, mode: "overwrite", expectedTargetHash: state.expected.get(id)! },
    );
    result.set(row.category, group);
  }
  return result;
}

async function applySync(
  { owners, home }: Owners,
  category: keyof SyncOwners,
  file: ConfigPackage,
  items: DataSyncImportItem[],
): Promise<DataSyncImportResult> {
  if (!(await owners[category].checkSyncWriteAccess()).ok) throw new Error("target-access");
  const groups = file.categories;
  switch (category) {
    case "commands":
      return owners.commands.importSyncItems({ payload: decodeCommands(groups.commands!), items });
    case "subagents":
      return owners.subagents.importSyncItems({
        payload: decodeSubagents(groups.subagents!),
        items,
      });
    case "hooks":
      return owners.hooks.importSyncItems({ payload: decodeHooks(groups.hooks!), items });
    case "mcp":
      return owners.mcp.importSyncItems({ payload: decodeMcp(groups.mcp!, home), items });
    case "skills":
      return owners.skills.importSyncItems({ payload: decodeSkills(groups.skills!), items });
  }
}
async function apply(
  state: PreviewState,
  selections: ReturnType<typeof selectItems>,
  options: Owners,
): Promise<ConfigApplyResult> {
  const result: ConfigApplyResult = { items: [] };
  for (const category of CONFIG_PACKAGE_CATEGORIES) {
    const items = selections.get(category);
    if (category === "providers") {
      const group = state.file.categories.providers;
      if (group && (items?.length || group.payload.defaultModelSelection)) {
        try {
          const outcome = await applyProviders(options, state.personal, group, items ?? []);
          result.items.push(...outcome.items);
          if (outcome.defaultModelSkipped) result.defaultModelSkipped = true;
        } catch {
          result.items.push(
            ...(items ?? []).map(({ key }) => ({
              category,
              key,
              status: "failed" as const,
              reason: "target-write",
            })),
          );
          if (group.payload.defaultModelSelection) result.defaultModelSkipped = true;
        }
      }
      continue;
    }
    if (!items?.length) continue;
    if (category === "systemPrompt") {
      result.items.push(
        await applyPrompt(
          options,
          state.personal.prompt,
          state.file.categories.systemPrompt!.payload!,
        ),
      );
      continue;
    }
    try {
      const report = await applySync(options, category, state.file, items);
      const byKey = new Map(report.results.map((row) => [row.key, row]));
      for (const { key } of items) {
        const row = byKey.get(key),
          status = row?.status ?? "failed";
        result.items.push({
          category,
          key,
          status,
          ...(status === "failed"
            ? {
                reason:
                  row?.error === "nested-selection" || row?.error === "nested-target"
                    ? row.error
                    : "target-write",
              }
            : {}),
        });
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "target-access"
          ? "target-access"
          : "target-write";
      result.items.push(
        ...items.map(({ key }) => ({ category, key, status: "failed" as const, reason })),
      );
    }
  }
  return result;
}

export function createPreviewMethods(
  options: Owners,
  platform: string,
  appVersion: string,
): Pick<IConfigPackageService, "previewFile" | "applyPreview" | "releasePreview"> {
  const previews = new Map<string, PreviewState>(),
    completed = new Map<string, ConfigApplyResult>(),
    running = new Map<string, Promise<ConfigApplyResult>>();
  return {
    async previewFile(path) {
      const file = await readPackage(path);
      const state = await buildPreview(file, options, platform);
      const previewId = randomUUID();
      if (previews.size >= 4) previews.delete(previews.keys().next().value!);
      previews.set(previewId, state);
      return {
        previewId,
        counts: countsOf(file.categories),
        rows: state.rows,
        sourcePlatform: file.sourcePlatform,
        appVersion: file.appVersion,
        differentPlatform: file.sourcePlatform !== platform,
        differentVersion: file.appVersion !== appVersion,
      } satisfies ConfigPreview;
    },
    async applyPreview(previewId, selected) {
      const receipt = completed.get(previewId) ?? running.get(previewId);
      if (receipt) return receipt;
      const state = previews.get(previewId);
      if (!state) throw new Error("config-package.expired");
      const selections = selectItems(state, selected);
      previews.delete(previewId);
      const promise = apply(state, selections, options)
        .then((result) => {
          if (completed.size >= 32) completed.delete(completed.keys().next().value!);
          completed.set(previewId, result);
          return result;
        })
        .finally(() => running.delete(previewId));
      running.set(previewId, promise);
      return promise;
    },
    async releasePreview(previewId) {
      previews.delete(previewId);
      completed.delete(previewId);
    },
  };
}
