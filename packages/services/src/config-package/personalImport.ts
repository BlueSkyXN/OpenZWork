import { randomUUID } from "node:crypto";
import {
  ProviderConfigResolver,
  ProviderRegistry,
  type ModelSelection,
  type PersonalProviderConfigRepository,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
  type ProviderRegistryService,
} from "@zcode/provider";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@zcode/provider-node";
import {
  type AppSettings,
  type ConfigApplyResult,
  type ConfigDefaultModel,
  type ConfigResultItem,
  type ConfigPackage,
  type ConfigRow,
  type DataSyncImportItem,
  type ProviderProvisioningEnvelope,
  type SystemPromptSettings,
} from "@zcode/shared";
import {
  contentHash,
  personalData,
  providerEntries,
  providerGroups,
  stableJson,
  type PersonalData,
} from "./personal.js";

export interface PersonalOwners {
  settings: {
    get(): Promise<AppSettings>;
    update(
      patch: Partial<AppSettings>,
      options: { expectedSystemPromptSettings: SystemPromptSettings | null },
    ): Promise<void>;
  };
  source: { read(syncId: string): Promise<ProviderProvisioningEnvelope> };
  repo: PersonalProviderConfigRepository;
  registry: Pick<ProviderRegistryService, "start" | "getSnapshot" | "refresh">;
}
export interface PersonalPreview {
  rows: ConfigRow[];
  prompt: SystemPromptSettings | null;
  hashes: Map<string, string>;
  defaultModelCandidate?: ConfigDefaultModel;
}
export async function previewPersonal(
  file: ConfigPackage,
  owners: PersonalOwners,
): Promise<PersonalPreview> {
  const state: PersonalPreview = { rows: [], prompt: null, hashes: new Map() };
  for (const category of ["providers", "systemPrompt"] as const) {
    const group = file.categories[category];
    if (!group) continue;
    try {
      if (category === "providers") {
        const local = personalData((await owners.source.read(randomUUID())).personalConfig);
        state.hashes = new Map(providerEntries(local).map((item) => [item.key, item.hash]));
        const desired = file.categories.providers?.payload.defaultModelSelection;
        if (
          !local.defaultModelSelection &&
          desired &&
          group.entries.some((row) => row.key === desired.providerId)
        ) {
          state.defaultModelCandidate = {
            providerId: desired.providerId,
            modelId: desired.modelId,
          };
        }
      } else {
        state.prompt = (await owners.settings.get()).systemPromptSettings ?? null;
      }
      for (const { key, name, hash } of group.entries) {
        const current =
          category === "providers"
            ? state.hashes.get(key)
            : state.prompt
              ? contentHash(stableJson(state.prompt))
              : undefined;
        state.rows.push({
          category,
          key,
          name,
          status: current === undefined ? "new" : current === hash ? "same" : "different",
        });
      }
    } catch {
      state.rows.push(
        ...group.entries.map(({ key, name }) => ({
          category,
          key,
          name,
          status: "blocked" as const,
          reason: "target-read",
        })),
      );
    }
  }
  return state;
}
export async function applyPrompt(
  owners: PersonalOwners,
  expected: SystemPromptSettings | null,
  incoming: SystemPromptSettings,
): Promise<ConfigResultItem> {
  try {
    await owners.settings.update(
      { systemPromptSettings: incoming },
      { expectedSystemPromptSettings: expected },
    );
    return {
      category: "systemPrompt",
      key: "systemPrompt",
      status: expected === null ? "created" : "updated",
    };
  } catch (error) {
    return error instanceof Error && error.message === "settings.systemPrompt.conflict"
      ? { category: "systemPrompt", key: "systemPrompt", status: "conflict" }
      : { category: "systemPrompt", key: "systemPrompt", status: "failed", reason: "target-write" };
  }
}

function canResolve(
  registry: PersonalOwners["registry"],
  candidate: ProviderConfigLayerUpdate,
  selection: ModelSelection,
) {
  const config = registry.getSnapshot()?.config;
  if (!config) return false;
  const resolution = new ProviderConfigResolver().resolve({
    ...config,
    personalProviders: candidate.providers,
    personalModels: candidate.models,
    personalProviderOrder: candidate.providerOrder,
  });
  const view = new ProviderRegistry(resolution.registryProviders);
  const model = view.getModel(selection.providerId, selection.modelId);
  return !!model && (!selection.options?.reasoningLevel || view.validateSelection(selection).ok);
}

// 合并只操作正式 codec 的规范化数据；目标已有顺序、两组精确规则和默认模型均在同一锁内读取。
function merge(
  current: PersonalData,
  incoming: PersonalData,
  items: DataSyncImportItem[],
  expected: PersonalPreview,
  canAdopt: (config: ProviderConfigLayerUpdate, selection: ModelSelection) => boolean,
) {
  const kept = providerGroups(current),
    source = providerGroups(incoming);
  const localHashes = new Map(providerEntries(current).map((item) => [item.key, item.hash]));
  const requested = new Set(items.map((item) => item.key)),
    added: string[] = [];
  const report: ConfigApplyResult = { items: [] };
  const imported = new Set<string>();
  for (const [id, group] of source) {
    if (!requested.has(id)) continue;
    const existed = kept.has(id);
    if (localHashes.get(id) !== expected.hashes.get(id)) {
      report.items.push({ category: "providers", key: id, status: "conflict" });
      continue;
    }
    if (!existed) added.push(id);
    kept.set(id, group);
    imported.add(id);
    report.items.push({ category: "providers", key: id, status: existed ? "updated" : "created" });
  }
  const groups = [...kept.values()];
  const next = decodeProviderConfigFile({
    schemaVersion: 1,
    config: {
      ...current,
      providerConfigRules: {
        providerRules: groups.flatMap((group) => (group.provider ? [group.provider] : [])),
      },
      modelConfigRules: {
        providerModelRules: groups.flatMap((group) => group.ordinary),
        manualProviderModelRules: groups.flatMap((group) => group.manual),
      },
      ...(added.length ? { providerOrder: [...providerGroups(current).keys(), ...added] } : {}),
    },
  });
  const desired = incoming.defaultModelSelection;
  if (desired && !current.defaultModelSelection) {
    const wasSame =
      expected.rows.some(
        (row) =>
          row.category === "providers" && row.key === desired.providerId && row.status === "same",
      ) && localHashes.get(desired.providerId) === expected.hashes.get(desired.providerId);
    if (
      expected.defaultModelCandidate &&
      (imported.has(desired.providerId) || wasSame) &&
      canAdopt(next, desired)
    )
      return { next: { ...next, defaultModelSelection: desired }, report, changed: true };
    report.defaultModelSkipped = true;
  } else if (expected.defaultModelCandidate) {
    // 预览后的另一个窗口已设置默认模型。即使只确认了模型，也要回报这次跳过。
    report.defaultModelSkipped = true;
  }
  return { next, report, changed: imported.size > 0 };
}

export async function applyProviders(
  owners: PersonalOwners,
  expected: PersonalPreview,
  group: NonNullable<ConfigPackage["categories"]["providers"]>,
  items: DataSyncImportItem[],
): Promise<ConfigApplyResult> {
  const incoming = personalData(group.payload);
  const unchanged = new Error("no changes");
  let before: ProviderConfigLayerSnapshot | undefined;
  let committed: ProviderConfigLayerSnapshot;
  let report: ConfigApplyResult = { items: [] };
  try {
    await owners.registry.start();
    committed = await owners.repo.update((current) => {
      before = current;
      const merged = merge(
        encodeProviderConfigFile(current).config,
        incoming,
        items,
        expected,
        (next, desired) => canResolve(owners.registry, next, desired),
      );
      report = merged.report;
      if (!merged.changed) throw unchanged;
      return merged.next;
    });
  } catch (error) {
    if (error === unchanged) return report;
    throw new Error("target-write");
  }
  try {
    await owners.registry.refresh("config-package");
    // 默认值可以是唯一改动。刷新成功后才把实际提交的模型写进回执。
    if (!before?.defaultModelSelection && committed.defaultModelSelection) {
      const { providerId, modelId } = committed.defaultModelSelection;
      report.defaultModelApplied = { providerId, modelId };
    }
    return report;
  } catch {
    let reason = "refresh-rolled-back";
    try {
      await owners.repo.update((current) => {
        if (current.revision !== committed.revision || !before) throw new Error("changed");
        return before;
      });
      await owners.registry.refresh("config-package-rollback");
    } catch {
      reason = "rollback-incomplete";
    }
    for (const row of report.items)
      if (row.status !== "conflict") {
        row.status = "failed";
        row.reason = reason;
      }
    if (!report.items.some((row) => row.reason === reason) && incoming.defaultModelSelection) {
      report.items.push({
        category: "providers",
        key: incoming.defaultModelSelection.providerId,
        status: "failed",
        reason,
      });
    }
    return report;
  }
}
