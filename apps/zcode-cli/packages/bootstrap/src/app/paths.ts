import { basename, join } from "node:path";
import { resolvePath } from "@zcode/adapters/config";
import { createProjectId, DefaultRuntimeConfig, type ProjectId } from "@zcode/contracts";
import { resolveProjectMemoryRoot } from "@zcode/core";

export function getCliStorageRoot(storageRoot: string): string {
  return basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
}

/**
 * WP-E1a 记忆数据迁移的调用点判定：解析后的 storage 根是否为默认根（~/.openzwork）。
 * 用户显式自定义 storage.dir（env ZCODE_STORAGE_DIR 或 config 覆盖）属于主动选址，
 * 与「数据根改名遗留」是两类意图，自动搬运可能违背预期，故跳过自动迁移（spec §2.4）。
 * 默认值以 contracts DefaultRuntimeConfig 为单一事实来源，不在 bootstrap 重复字面量。
 */
export function isDefaultCliStorageRoot(resolvedStorageRoot: string): boolean {
  return resolvedStorageRoot === resolvePath(DefaultRuntimeConfig.storage.dir);
}

export function getPluginStorageRoot(cliStorageRoot: string): string {
  return join(cliStorageRoot, "plugins");
}

export function getModelIoDir(cliStorageRoot: string, isDevelopment: boolean): string {
  return join(cliStorageRoot, isDevelopment ? "debug" : "rollout");
}

export function getProjectMemoryRoot(
  cliStorageRoot: string,
  workingDirectory: string,
  workspaceIdentity?: string,
): string {
  return resolveProjectMemoryRoot({
    cliStorageRoot,
    workspaceIdentity,
    workspacePath: workingDirectory,
  });
}

export function projectIdFromDirectory(directory: string): ProjectId {
  return createProjectId(
    directory
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "default",
  );
}
