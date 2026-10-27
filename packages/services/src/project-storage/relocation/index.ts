import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRemoteWorkspaceIdentity, type AppSettings } from "@zcode/shared";
import { relocateDataPath, type DataRelocationPlan } from "@zcode/shared/data-directory";
import type { HostStorageRelocationContract } from "./contract.js";

export const hostStorageRelocation: HostStorageRelocationContract = {
  relocate: relocateHostStorage,
  settings: relocateWorkspaceSettings,
};

type Row = Record<string, string | number | bigint | null | Uint8Array>;
function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}
function updateRows(db: DatabaseSync, table: string, change: (row: Row) => void): void {
  if (!hasTable(db, table)) return;
  for (const row of db.prepare(`SELECT rowid AS __rowid,* FROM "${table}"`).iterate()) {
    const next = { ...row };
    change(next);
    const keys = Object.keys(row).filter((key) => key !== "__rowid" && next[key] !== row[key]);
    if (keys.length)
      db.prepare(
        `UPDATE "${table}" SET ${keys.map((key) => `"${key}"=?`).join(",")} WHERE rowid=?`,
      ).run(...keys.map((key) => next[key]!), row.__rowid!);
  }
}
function isLocal(row: Row): boolean {
  return (
    (!row.host_id || row.host_id === "local") &&
    row.location_kind !== "remote" &&
    !isRemoteWorkspaceIdentity(String(row.workspace_identity ?? ""))
  );
}
function mapPath(value: unknown, plan: DataRelocationPlan): unknown {
  return typeof value === "string" ? relocateDataPath(value, plan) : value;
}
function pathList(raw: Row[string], plan: DataRelocationPlan): Row[string] {
  if (typeof raw !== "string") return raw;
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) return raw;
  const next = data.map((value) => mapPath(value, plan));
  return JSON.stringify(next) === JSON.stringify(data) ? raw : JSON.stringify(next);
}
function metadata(raw: Row[string], plan: DataRelocationPlan): Row[string] {
  if (typeof raw !== "string") return raw;
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) return raw;
  const next = { ...data };
  for (const key of ["workspacePath", "workspaceIdentity", "cwd", "rootPath"])
    next[key] = mapPath(data[key], plan);
  return JSON.stringify(next) === JSON.stringify(data) ? raw : JSON.stringify(next);
}

/** Host 组织态只在副本中转换，session/project 的稳定业务 ID 不参与重建。 */
export async function relocateHostStorage(plan: DataRelocationPlan): Promise<void> {
  const keyMap = new Map<string, string>();
  for (const root of [plan.sourceRoot, ...(plan.sourceAliases ?? [])]) {
    const defaultWorkspace = join(root, "workspace", "default");
    keyMap.set(defaultWorkspace, relocateDataPath(defaultWorkspace, plan));
  }
  const v2 = join(plan.stageRoot, "v2");
  const entries = await readdir(v2).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const filename of entries.filter((name) => name.endsWith(".sqlite"))) {
    const db = new DatabaseSync(join(v2, filename));
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const table of ["tasks", "automations", "off_peak_tasks", "task_group_members"])
        updateRows(db, table, (row) => {
          if (!isLocal(row)) return;
          const previous = String(row.workspace_key);
          for (const key of [
            "workspace_path",
            "root_path",
            "workspace_identity",
            "workspace_key",
          ]) {
            if (typeof row[key] === "string") row[key] = relocateDataPath(row[key], plan);
          }
          if (typeof row.workspace_key === "string" && row.workspace_key !== previous)
            keyMap.set(previous, row.workspace_key);
          for (const key of ["execution_directories", "additional_directories"]) {
            if (key in row) row[key] = pathList(row[key]!, plan);
          }
          if ("meta_json" in row) row.meta_json = metadata(row.meta_json!, plan);
        });
      for (const table of [
        "automation_runs",
        "task_group_admissions",
        "task_group_workspace_bootstraps",
      ])
        updateRows(db, table, (row) => {
          const next = keyMap.get(String(row.workspace_key));
          if (next) row.workspace_key = next;
        });
      updateRows(db, "task_group_view_node_orders", (row) => {
        if (row.node_type !== "task" || typeof row.node_key !== "string") return;
        const key = JSON.parse(row.node_key) as unknown;
        if (Array.isArray(key) && key.length === 2 && keyMap.has(String(key[0])))
          row.node_key = JSON.stringify([keyMap.get(String(key[0])), key[1]]);
      });
      if (hasTable(db, "projects"))
        updateRows(db, "project_roots", (row) => {
          const owner = db
            .prepare("SELECT host_id FROM projects WHERE project_id=?")
            .get(row.project_id!);
          if (owner?.host_id === "local" && typeof row.root_path === "string")
            row.root_path = relocateDataPath(row.root_path, plan);
        });
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  for (const [previous, next] of keyMap) {
    const hash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);
    const oldDirectory = join(v2, "sessions", hash(previous));
    const newDirectory = join(v2, "sessions", hash(next));
    if (oldDirectory === newDirectory) continue;
    try {
      if ((await lstat(oldDirectory)).isSymbolicLink())
        throw new Error("Session index directory must not be a symbolic link during relocation");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // 不合并两个身份目录；碰撞必须阻止发布，不能丢掉已有历史文件。
    try {
      await lstat(newDirectory);
      throw new Error("Relocated session directory already exists");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const file of await readdir(oldDirectory)) {
      if (!file.endsWith(".json")) continue;
      const path = join(oldDirectory, file);
      if (!(await lstat(path)).isFile())
        throw new Error("Session snapshot must be a regular file during relocation");
      const raw = await readFile(path, "utf8");
      const snapshot = JSON.parse(raw) as { meta?: unknown };
      const updatedMeta = metadata(JSON.stringify(snapshot.meta), plan);
      if (typeof updatedMeta === "string") snapshot.meta = JSON.parse(updatedMeta);
      const updated = JSON.stringify(snapshot);
      if (updated !== raw) await writeFile(path, String(updated), { mode: 0o600 });
    }
    await rename(oldDirectory, newDirectory);
  }
}

export function relocateWorkspaceSettings(
  settings: AppSettings,
  plan: DataRelocationPlan,
): AppSettings {
  const entry = (value: NonNullable<AppSettings["lastActiveWorkspace"]>) =>
    value.kind === "local"
      ? { ...value, workspacePath: relocateDataPath(value.workspacePath, plan) }
      : value;
  return {
    ...settings,
    recentProjects: settings.recentProjects.map((path) => relocateDataPath(path, plan)),
    ...(settings.lastActiveWorkspace
      ? { lastActiveWorkspace: entry(settings.lastActiveWorkspace) }
      : {}),
    ...(settings.lastWorkspaceSession
      ? { lastWorkspaceSession: settings.lastWorkspaceSession.map(entry) }
      : {}),
  };
}
