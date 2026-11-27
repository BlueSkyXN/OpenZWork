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
  // OZ-C003：start 读取内置配置之前已注册监听，失败时调用方尚未持有释放句柄。
  let modelSelectionConfigRepository: NodeModelSelectionConfigRepository | undefined;
  function dispose() {
    modelSelectionConfigRepository?.dispose();
    runtime.dispose();
  }
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
    return Object.freeze({
      dispose,
      runtime,
      snapshot,
      modelSelectionConfigRepository,
      configuredDefaultModelSelection,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
