import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

/** 与 CLI 新建/恢复共用算法，搬迁不另造项目身份。 */
export function localProjectId(directory: string): string {
  return (
    directory
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "default"
  );
}

export function projectMemoryDirectoryName(
  workspacePath: string,
  workspaceIdentity?: string,
): string {
  const identity = workspaceIdentity?.trim();
  const path = resolve(workspacePath);
  const key = identity || (process.platform === "win32" ? path.toLowerCase() : path);
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const slug = identity
    ? "project"
    : (basename(path) || "project")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "project";
  return `${slug}-${hash}`;
}
