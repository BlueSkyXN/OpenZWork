import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import { workspaceCheckpointArtifactSchema } from "@zcode/contracts";
import {
  RELOCATABLE_TRUST_FILES,
  dataRelocationPlanSchema,
  localProjectId,
  projectMemoryDirectoryName,
  relocateDataPath,
  type DataRelocationPlan,
} from "@zcode/shared/data-directory";
import type { CliStorageRelocationContract } from "./contract.js";
import { mapAttachments, mapFields, mapPart, mapPendingInput, record } from "./references.js";
export type { CliStorageRelocationContract } from "./contract.js";

type Row = Record<string, string | number | bigint | null | Uint8Array>;

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((row) => String(row.name)),
  );
}

function rewriteRows(db: DatabaseSync, table: string, change: (row: Row) => void): void {
  if (!columns(db, table).size) return;
  for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM "${table}"`).iterate()) {
    const updated = { ...row };
    change(updated);
    const keys = Object.keys(row).filter((key) => key !== "__rowid" && updated[key] !== row[key]);
    if (!keys.length) continue;
    db.prepare(
      `UPDATE "${table}" SET ${keys.map((key) => `"${key}"=?`).join(",")} WHERE rowid=?`,
    ).run(...keys.map((key) => updated[key]!), row.__rowid!);
  }
}

function jsonField(row: Row, key: string, change: (value: unknown) => void): void {
  if (typeof row[key] !== "string") return;
  const value: unknown = JSON.parse(row[key]);
  const before = JSON.stringify(value);
  change(value);
  if (JSON.stringify(value) !== before) row[key] = JSON.stringify(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export const cliStorageRelocation: CliStorageRelocationContract = {
  async relocate(input, readArtifact) {
    const plan = dataRelocationPlanSchema.parse(input);
    if (
      [plan.sourceRoot, plan.targetRoot].some((root) => resolve(root) === resolve(plan.stageRoot))
    )
      throw new Error("Relocation requires an unpublished staging directory");
    const workspaces = new Map<string, string>();
    for (const root of [plan.sourceRoot, ...(plan.sourceAliases ?? [])]) {
      const workspace = join(root, "workspace", "default");
      workspaces.set(
        projectMemoryDirectoryName(workspace),
        projectMemoryDirectoryName(relocateDataPath(workspace, plan)),
      );
    }
    const dbPath = join(plan.stageRoot, "cli", "db", "db.sqlite");
    const checkpointRefs = new Set<string>();
    if (await exists(dbPath)) relocateDatabase(dbPath, plan, workspaces, checkpointRefs);
    await relocateWorkspaceSettings(plan);
    for (const uri of checkpointRefs) {
      if (!readArtifact)
        throw new Error("Checkpoint relocation requires the artifact store reader");
      const artifact = await readArtifact(uri);
      const checkpoint = workspaceCheckpointArtifactSchema.parse(JSON.parse(artifact.content));
      let changed = false;
      for (const file of checkpoint.files) {
        const path = relocateDataPath(file.path, plan);
        if (path !== file.path) {
          file.path = path;
          changed = true;
        }
      }
      if (!changed) continue;
      if (!artifact.path || !(await lstat(artifact.path)).isFile())
        throw new Error("Checkpoint artifact must be a regular staging file");
      const rel = relative(await realpath(plan.stageRoot), await realpath(artifact.path));
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
        throw new Error("Checkpoint artifact is outside staging");
      await writeFile(artifact.path, JSON.stringify(checkpoint), { mode: 0o600 });
    }
    const memoryRoot = join(plan.stageRoot, "cli", "memories", "projects");
    for (const [previous, next] of workspaces) {
      const source = join(memoryRoot, previous);
      const target = join(memoryRoot, next);
      if (source === target || !(await exists(source))) continue;
      if (await exists(target))
        throw new Error("The relocated workspace already has a different memory directory");
      await rename(source, target);
    }
  },
};

/** 只在未发布副本中重写定义为工作区位置的键。声明摘要和私有值原样保留。 */
async function relocateWorkspaceSettings(plan: DataRelocationPlan): Promise<void> {
  if (!(await exists(plan.stageRoot))) return;
  const root = await realpath(plan.stageRoot);
  const files = ["cli/plugin-secrets.json", ...RELOCATABLE_TRUST_FILES.map((name) => `security/${name}`)];
  for (const name of files) {
    const path = join(root, name);
    if (!(await exists(path))) continue;
    if (!(await lstat(path)).isFile() || (await realpath(path)) !== path)
      throw new Error("Expected a regular settings file in the relocation staging directory: " + name);
    const raw = await readFile(path, "utf8");
    const settings = record(JSON.parse(raw));
    if (!settings) throw new Error("Invalid workspace settings: " + name);
    const original = JSON.stringify(settings);
    if (name === "cli/plugin-secrets.json") {
      const workspaces = record(settings.workspaces);
      if (!workspaces) continue;
      const moved = new Map<string, unknown>();
      for (const [key, value] of Object.entries(workspaces)) {
        const next = relocateDataPath(key, plan);
        if (moved.has(next)) throw new Error("Conflicting workspace plugin settings during relocation");
        moved.set(next, value);
      }
      settings.workspaces = Object.fromEntries(moved);
    } else if (Array.isArray(settings.records)) {
      for (const item of settings.records) {
        const entry = record(item);
        if (!entry || isRemoteWorkspaceIdentity(String(entry.workspaceIdentity ?? ""))) continue;
        mapFields(entry, ["workspaceIdentity", "sourcePathAtGrant"], plan);
      }
    }
    if (JSON.stringify(settings) !== original) await writeFile(path, JSON.stringify(settings), { mode: 0o600 });
  }
}

function relocateDatabase(
  dbPath: string,
  plan: DataRelocationPlan,
  workspaces: Map<string, string>,
  checkpointRefs: Set<string>,
): void {
  const db = new DatabaseSync(dbPath);
  const localSessions = new Set<string>();
  const projectIds = new Map<string, string>();
  try {
    db.exec("BEGIN IMMEDIATE");
    // OZ-C009：独占暂存库内重定位会话及跨会话引用时，0025 会拒绝改写待删除数据。
    // 将删除记录暂存在连接私有表，原触发器保留；提交前还原，失败时 SQLite 回滚整个事务。
    const hasPurge = columns(db, "session_purge").size > 0;
    if (hasPurge) {
      db.exec("CREATE TEMP TABLE relocation_purge AS SELECT * FROM main.session_purge");
      db.exec("DELETE FROM main.session_purge");
    }
    rewriteRows(db, "session", (row) => {
      if (isRemoteWorkspaceIdentity(String(row.workspace_id ?? ""))) return;
      localSessions.add(String(row.id));
      const oldDirectory = String(row.directory);
      const directory = relocateDataPath(oldDirectory, plan);
      const oldIdentity = typeof row.workspace_id === "string" ? row.workspace_id : undefined;
      if (directory !== oldDirectory) {
        row.directory = directory;
        if (row.workspace_id === oldDirectory) row.workspace_id = directory;
        if (row.project_id === localProjectId(oldDirectory)) {
          const projectId = localProjectId(directory);
          projectIds.set(String(row.project_id), projectId);
          row.project_id = projectId;
        }
      }
      const newIdentity = typeof row.workspace_id === "string" ? row.workspace_id : undefined;
      workspaces.set(
        projectMemoryDirectoryName(oldDirectory, oldIdentity),
        projectMemoryDirectoryName(directory, newIdentity),
      );
      if (typeof row.path === "string") row.path = relocateDataPath(row.path, plan);
      jsonField(row, "summary_diffs", (value) => {
        if (Array.isArray(value)) for (const diff of value) mapFields(diff, ["file"], plan);
      });
    });
    for (const [previous, next] of projectIds) {
      if (
        previous !== next &&
        db.prepare("SELECT 1 FROM session WHERE project_id=? LIMIT 1").get(previous)
      )
        throw new Error(
          "A relocated workspace shares its path-derived project ID with another workspace",
        );
    }
    rewriteRows(db, "message", (row) => {
      if (!localSessions.has(String(row.session_id))) return;
      jsonField(row, "data", (value) => {
        const message = record(value);
        if (message?.role === "assistant") mapFields(message.path, ["cwd", "root"], plan);
      });
    });
    rewriteRows(db, "part", (row) => {
      if (localSessions.has(String(row.session_id)))
        jsonField(row, "data", (value) => mapPart(value, plan));
    });
    rewriteRows(db, "session_input", (row) => {
      if (localSessions.has(String(row.session_id)))
        jsonField(row, "payload", (value) => mapPendingInput(value, plan));
    });
    rewriteRows(db, "session_entry", (row) => {
      if (!localSessions.has(String(row.session_id)) || row.type !== "runtime/workspace_checkpoint")
        return;
      jsonField(row, "data", (value) => {
        const payload = record(record(value)?.payload);
        if (typeof payload?.snapshotRef === "string") checkpointRefs.add(payload.snapshotRef);
      });
    });
    rewriteRows(db, "input_history", (row) => {
      if (row.session_id && !localSessions.has(String(row.session_id))) return;
      if (projectIds.has(String(row.project_id)))
        row.project_id = projectIds.get(String(row.project_id))!;
      jsonField(row, "attachments", (value) => mapAttachments(value, plan));
    });
    for (const table of ["permission", "local_setting"])
      rewriteRows(db, table, (row) => {
        const key = table === "permission" ? "project_id" : "scope_id";
        if (table === "local_setting" && row.scope !== "project") return;
        if (projectIds.has(String(row[key]))) row[key] = projectIds.get(String(row[key]))!;
      });
    for (const table of ["workflow_run", "dwf_run"])
      rewriteRows(db, table, (row) => {
        if (row.parent_session_id && !localSessions.has(String(row.parent_session_id))) return;
        for (const key of ["cwd", "script_path"])
          if (typeof row[key] === "string") row[key] = relocateDataPath(row[key], plan);
      });
    rewriteRows(db, "workflow_definition", (row) => {
      if (typeof row.script_path === "string")
        row.script_path = relocateDataPath(row.script_path, plan);
    });
    if (hasPurge) {
      db.exec("INSERT INTO main.session_purge SELECT * FROM temp.relocation_purge");
      db.exec("DROP TABLE temp.relocation_purge");
      rewriteRows(db, "session_purge", (row) => {
        if (isRemoteWorkspaceIdentity(String(row.workspace_identity ?? ""))) return;
        for (const key of ["workspace_path", "workspace_identity"]) {
          if (typeof row[key] === "string") row[key] = relocateDataPath(row[key], plan);
        }
      });
    }
    db.exec("COMMIT");
    const checks = db.prepare("PRAGMA quick_check").all();
    if (checks.length !== 1 || Object.values(checks[0]!)[0] !== "ok")
      throw new Error("Relocated CLI database failed integrity validation");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
