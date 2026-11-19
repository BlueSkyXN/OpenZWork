import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import {
  configCategoriesSchema,
  providerProvisioningPersonalConfigSchema,
  ZCODE_VERSION,
  type ConfigCategory,
  type ConfigCounts,
  type ConfigGroups,
  type ConfigPackage,
  type ProviderProvisioningEnvelope,
  type AppSettings,
} from "@zcode/shared";
import type { IConfigPackageService } from "./contract.js";
import { exportSyncCategory, type SyncOwners } from "./categories.js";
import { writePackage } from "./file.js";
import { contentHash, personalData, providerEntries, stableJson } from "./personal.js";

export { userCategory } from "./categories.js";
export { readPackage } from "./file.js";
export interface ConfigPackageOptions {
  owners: SyncOwners;
  source: { read(syncId: string): Promise<ProviderProvisioningEnvelope> };
  settings: { get(): Promise<AppSettings> };
  platform?: ConfigPackage["sourcePlatform"];
  home?: string;
  appVersion?: string;
}
export function countsOf(groups: ConfigGroups): ConfigCounts {
  return Object.fromEntries(
    Object.entries(groups).map(([category, group]) => [category, group.entries.length]),
  );
}
export function createConfigPackageService(options: ConfigPackageOptions): IConfigPackageService {
  const home =
    options.home ?? (process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir());
  const platform = options.platform ?? process.platform;
  const appVersion = options.appVersion ?? ZCODE_VERSION;
  return {
    async exportToFile(path: string, requested: ConfigCategory[]) {
      const categories = configCategoriesSchema.safeParse(requested);
      if (!categories.success) throw new Error("config-package.categories");
      if (platform !== "darwin" && platform !== "linux" && platform !== "win32")
        throw new Error("config-package.platform");
      const groups: ConfigGroups = {};
      for (const category of categories.data) {
        try {
          if (category === "providers") {
            const read = async () =>
              personalData((await options.source.read(randomUUID())).personalConfig);
            const before = await read(),
              payload = await read();
            if (!isDeepStrictEqual(before, payload) || !isDeepStrictEqual(payload, await read()))
              throw new Error("config-package.source-changed");
            groups.providers = {
              payload: providerProvisioningPersonalConfigSchema.parse(payload),
              entries: providerEntries(payload),
            };
          } else if (category === "systemPrompt") {
            const read = async () => (await options.settings.get()).systemPromptSettings ?? null;
            const before = await read(),
              payload = await read();
            if (!isDeepStrictEqual(before, payload) || !isDeepStrictEqual(payload, await read()))
              throw new Error("config-package.source-changed");
            groups.systemPrompt = {
              payload,
              entries: payload
                ? [
                    {
                      key: "systemPrompt",
                      name: "systemPrompt",
                      hash: contentHash(stableJson(payload)),
                    },
                  ]
                : [],
            };
          } else {
            await exportSyncCategory(groups, category, options.owners);
          }
        } catch (error) {
          if (error instanceof Error && error.message === "config-package.source-changed")
            throw error;
          throw new Error("config-package.export-blocked");
        }
      }
      const bytes = await writePackage(path, {
        formatVersion: 1,
        appVersion,
        sourcePlatform: platform,
        sourceHomeDir: home,
        exportedAt: new Date().toISOString(),
        categories: groups,
      });
      return { counts: countsOf(groups), bytes };
    },
  };
}
