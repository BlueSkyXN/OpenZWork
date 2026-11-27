import { normalizeUnknownError } from "./errors.js";

export const DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE =
  "DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR";

export function isDataBaseDirForbiddenWindowsInstallDirError(error: unknown): boolean {
  const normalized = normalizeUnknownError(error);
  return (
    normalized.code === DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE ||
    normalized.message.includes(DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE)
  );
}

export const DATA_DIRECTORY_MANAGED_WORKTREES = "DATA_DIRECTORY_MANAGED_WORKTREES";

export function getBlockingManagedWorktrees(error: unknown): string[] | undefined {
  if (!error || typeof error !== "object" || !("code" in error) ||
      error.code !== DATA_DIRECTORY_MANAGED_WORKTREES || !("details" in error)) return undefined;
  const paths = error.details;
  return Array.isArray(paths) && paths.every((path) => typeof path === "string") ? paths : undefined;
}
