// 包测试入口执行 managed 模块契约，根集成测试另覆盖真实跨进程搬迁及旧根隔离。
import "../src/storage-relocation/contract.test.js";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import { cliStorageRelocation } from "../src/storage-relocation/index.js";

it("OZ-C009：离线搬迁同时保留待删除会话、跨会话产物引用和删除屏障", async () => {
  const root = await mkdtemp(join(tmpdir(), "oz-relocate-purge-"));
  const plan = { sourceRoot: join(root, "source"), targetRoot: join(root, "target"), stageRoot: join(root, "stage") };
  try {
    const dbDir = join(plan.stageRoot, "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const file = join(dbDir, "db.sqlite");
    const previous = join(plan.sourceRoot, "workspace", "default");
    const next = join(plan.targetRoot, "workspace", "default");
    const db = new DatabaseSync(file);
    try {
      await runSqliteSessionMigrations(db, file);
      const add = db.prepare("INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES(?, 'p', 'fixture', ?, 'fixture', '1', 1, 1)");
      for (const id of ["deleting", "live"]) add.run(id, previous);
      const data = { role: "assistant", path: { cwd: previous }, summary: "zcode-artifact://deleting/file" };
      db.prepare("INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES('msg','live',1,1,?)").run(JSON.stringify(data));
      db.prepare("INSERT INTO session_purge(session_id,root_id,operation_id,retained_artifacts,workspace_path,state) VALUES('deleting','deleting','op','[]',?,'deleting')").run(previous);
    } finally { db.close(); }
    await cliStorageRelocation.relocate(plan);
    const result = new DatabaseSync(file);
    try {
      expect(result.prepare("SELECT workspace_path,state FROM session_purge").get()).toMatchObject({workspace_path: next, state: "deleting"});
      expect(result.prepare("SELECT directory FROM session WHERE id='deleting'").get()?.directory).toBe(next);
      const data = JSON.parse(String(result.prepare("SELECT data FROM message").get()?.data));
      expect(data.path.cwd).toBe(next);
      expect(data.summary).toBe("zcode-artifact://deleting/file");
      expect(() => result.exec("UPDATE session SET title='changed' WHERE id='deleting'")).toThrow("session-data.deleting");
      expect(() => result.exec("UPDATE message SET data=data WHERE id='msg'")).toThrow("session-data.deleting");
    } finally { result.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("OZ-C009：插件私有值按工作区迁移，信任记录只改变路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "oz-relocate-settings-"));
  const plan = { sourceRoot: join(root, "old"), targetRoot: join(root, "new"), stageRoot: join(root, "staging") };
  const old = join(plan.sourceRoot, "workspace", "default");
  const next = join(plan.targetRoot, "workspace", "default");
  try {
    const cli = join(plan.stageRoot, "cli");
    const security = join(plan.stageRoot, "security");
    await mkdir(cli, { recursive: true });
    await mkdir(security);
    const secrets = join(cli, "plugin-secrets.json");
    const trust = join(security, "workspace-hook-trust-v1.json");
    const leaf = { example: { fixture: "opaque-value" } };
    const record = { workspaceIdentity: old, sourcePathAtGrant: join(old, ".zcode", "hooks.json"), hookDeclarationDigest: "1".repeat(64) };
    await writeFile(secrets, JSON.stringify({ version: 1, user: {}, workspaces: { [old]: leaf } }));
    await writeFile(trust, JSON.stringify({ schemaVersion: 1, records: [record] }));
    await cliStorageRelocation.relocate(plan);
    expect(JSON.parse(await readFile(secrets, "utf8")).workspaces).toEqual({ [next]: leaf });
    expect(JSON.parse(await readFile(trust, "utf8")).records).toEqual([
      { ...record, workspaceIdentity: next, sourcePathAtGrant: join(next, ".zcode", "hooks.json") },
    ]);
    await writeFile(secrets, JSON.stringify({ workspaces: { [old]: leaf, [next]: leaf } }));
    await expect(cliStorageRelocation.relocate(plan)).rejects.toThrow("Conflicting workspace");
  } finally { await rm(root, { recursive: true, force: true }); }
});
