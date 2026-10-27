import { lstat, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import { workspaceCheckpointArtifactSchema } from "@zcode/contracts";
import {
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
