// Modified for the private fork, 2026-09-21: account/OAuth wiring removed —
// this runtime now owns provider config only (no account overlay, no credential
// store, no Host-side sync entry).
import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
} from "@zcode/provider-node";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 的一次性旧版个人配置导入。 */
  readonly standalone?: {
    readonly legacyCliUserConfigFilePath?: string;
  };
}

export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 ZCode Built-in / Personal Config 路径");
  }

  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    ...(options.standalone?.legacyCliUserConfigFilePath
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig({
              filePath: options.standalone?.legacyCliUserConfigFilePath,
            }),
        }
      : {}),
  });
  await runtime.start();
  const snapshot = runtime.registryService.getSnapshot()!;
  const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
    personalRepository: runtime.personalRepository,
  });
  try {
    const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
    return Object.freeze({
      dispose() {
        modelSelectionConfigRepository.dispose();
        runtime.dispose();
      },
      runtime,
      snapshot,
      modelSelectionConfigRepository,
      configuredDefaultModelSelection,
    });
  } catch (error) {
    modelSelectionConfigRepository.dispose();
    throw error;
  }
}
