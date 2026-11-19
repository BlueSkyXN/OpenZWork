import { createHash } from "node:crypto";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@zcode/provider-node";
import type { ConfigEntry, ProviderProvisioningPersonalConfig } from "@zcode/shared";

export function contentHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const object = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
}

export function personalData(input: ProviderProvisioningPersonalConfig) {
  return encodeProviderConfigFile(decodeProviderConfigFile({ schemaVersion: 1, config: input }))
    .config;
}
export type PersonalData = ReturnType<typeof personalData>;

export function providerGroups(data: PersonalData) {
  const providers = new Map(
    data.providerConfigRules.providerRules.map((rule) => [rule.providerId, rule]),
  );
  const ordinary = Map.groupBy(data.modelConfigRules.providerModelRules, (rule) => rule.providerId);
  const manual = Map.groupBy(
    data.modelConfigRules.manualProviderModelRules,
    (rule) => rule.providerId,
  );
  // 内置供应商也可以只有个人模型规则或排序位置。
  const ids = new Set([
    ...(data.providerOrder ?? []),
    ...providers.keys(),
    ...ordinary.keys(),
    ...manual.keys(),
  ]);
  return new Map(
    [...ids].map(
      (id) =>
        [
          id,
          {
            provider: providers.get(id),
            ordinary: ordinary.get(id) ?? [],
            manual: manual.get(id) ?? [],
          },
        ] as const,
    ),
  );
}
export function providerEntries(data: PersonalData): ConfigEntry[] {
  return [...providerGroups(data)].map(([key, group]) => ({
    key,
    name: group.provider?.providerName || key,
    hash: contentHash(stableJson(group)),
  }));
}
