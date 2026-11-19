import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, vi } from "vitest";
import { NodeProviderRegistryRuntime, decodeProviderConfigFile } from "@zcode/provider-node";
import { createDefaultSystemPromptSettings } from "@zcode/shared";
import {
  createUserConfigSyncService,
  createMcpDataSyncMethods,
  createSubagentDataSyncMethods,
  createCommandDataSyncMethods,
} from "../src/data-sync/node.js";
import { createSkillSyncService } from "../src/skill-sync/skillSyncService.js";
import { createSettingService } from "../src/setting/settingService.js";
import { createProviderProvisioningSource } from "../src/model-provider/providerProvisioningSource.js";
import {
  createConfigPackageService,
  userCategory,
  type ConfigPackageOptions,
} from "../src/config-package/node.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});
export async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "oz-config-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
export async function put(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
export const privateValues = {
  key: "fixture-api-key-only",
  env: "fixture-environment-value",
  header: "fixture-request-header",
  command: "/fixture/bin/never-run",
  body: "fixture-markdown-body",
  prompt: "fixture-system-prompt",
};
export function ownerAt(home: string, platform: ConfigPackageOptions["platform"] = "darwin") {
  for (const key of ["HOME", "USERPROFILE", "ZCODE_DATA_BASE_DIR", "ZCODE_DESKTOP_HOME_DIR"])
    vi.stubEnv(key, home);
  const filePath = join(home, ".openzwork", "v2", "provider_config.json");
  const runtime = new NodeProviderRegistryRuntime({
    personalFilePath: filePath,
    personalPollingIntervalMs: false,
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    zcodeBuiltinActiveFilePath: join(home, "active-builtin.json"),
    watch: false,
  });
  const repo = runtime.personalRepository;
  cleanups.push(() => runtime.dispose());
  const user = createUserConfigSyncService();
  const options: ConfigPackageOptions = {
    home,
    platform,
    appVersion: "3.17.2",
    owners: {
      subagents: createSubagentDataSyncMethods("original-bytes"),
      commands: createCommandDataSyncMethods({ requireComplete: true }),
      hooks: userCategory(user, "hooks"),
      mcp: createMcpDataSyncMethods(),
      skills: createSkillSyncService(),
    },
    source: createProviderProvisioningSource({
      personalRepository: repo,
      personalConfigFilePath: filePath,
      credentialFilePath: join(home, "unused"),
    }),
    settings: createSettingService(),
  };
  return {
    options,
    repo,
    runtime,
    service: createConfigPackageService(options),
  };
}
export function providerData(id: string, key: string) {
  return {
    providerId: id,
    providerName: id,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: key },
      api: { type: "openai-responses", baseUrl: "https://example.invalid/v1" },
      personalModelIds: ["sample"],
      modelOrder: ["sample"],
    },
  };
}
export async function seed(home: string) {
  const root = join(home, ".openzwork");
  await put(
    join(root, "agents", "Reader.md"),
    "---\nname: Reader\ndescription: Read files\n---\n" + privateValues.body,
  );
  await put(join(root, "commands", "Git", "sample.md"), privateValues.body);
  await put(
    join(root, "skills", "sample", "SKILL.md"),
    "---\nname: Sample\ndescription: fixture\n---\n" + privateValues.body,
  );
  await put(
    join(root, "cli", "config.json"),
    JSON.stringify({
      mcp: {
        servers: {
          filesystem: {
            command: "fixture-mcp",
            args: [home + "/folder", "/opt/fixed"],
            env: { EXAMPLE: privateValues.env },
            headers: { Example: privateValues.header },
            enabled: false,
          },
        },
      },
      hooks: {
        enabled: true,
        events: {
          Stop: [
            {
              hooks: [
                {
                  type: "process",
                  command: privateValues.command,
                  args: ["--example"],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  const host = ownerAt(home);
  await host.repo.update(() =>
    decodeProviderConfigFile({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [providerData("personal:fixture", privateValues.key)],
        },
        modelConfigRules: {
          providerModelRules: [],
          manualProviderModelRules: [],
        },
        providerOrder: ["personal:fixture"],
        defaultModelSelection: {
          providerId: "personal:fixture",
          modelId: "sample",
          options: { reasoningLevel: "disabled" },
        },
      },
    }),
  );
  const settings = createSettingService();
  await settings.update({
    systemPromptSettings: {
      ...createDefaultSystemPromptSettings(),
      mode: "replace",
      replacement: privateValues.prompt,
    },
  });
  return host;
}
