import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { buildServerRemoteWorkspaceIdentity, appSettingsSchema } from "@zcode/shared";
import { hostStorageRelocation } from "./index.js";

it("relocates local organization and settings while preserving remote rows, content, IDs and group order", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-relocation-"));
  const plan = {
    sourceRoot: join(root, "old"),
    targetRoot: join(root, "new"),
    stageRoot: join(root, "stage"),
  };
  const oldWorkspace = join(plan.sourceRoot, "workspace/default");
  const newWorkspace = join(plan.targetRoot, "workspace/default");
  const identity = buildServerRemoteWorkspaceIdentity({
    serverId: "test-host",
    workspacePath: oldWorkspace,
  });
  await mkdir(join(plan.stageRoot, "v2"), { recursive: true });
  const path = join(plan.stageRoot, "v2/tasks-index.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(await readFile(new URL("../schema.baseline.sql", import.meta.url), "utf8"));
    db.exec(
      "INSERT INTO hosts(host_id,kind) VALUES('local','local'),('remote','remote'); INSERT INTO projects(project_id,host_id,name,position,created_at,updated_at) VALUES('local-project','local','local',0,1,1),('remote-project','remote','remote',1,1,1)",
    );
    const task = db.prepare(
      "INSERT INTO tasks(workspace_key,workspace_path,workspace_identity,task_id,host_id,root_path,created_at,updated_at,meta_json) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    task.run(
      oldWorkspace,
      oldWorkspace,
      null,
      "task-local",
      "local",
      oldWorkspace,
      1,
      2,
      JSON.stringify({ workspacePath: oldWorkspace, title: oldWorkspace }),
    );
    task.run(
      identity,
      oldWorkspace,
      identity,
      "task-remote",
      "remote",
      oldWorkspace,
      1,
      2,
      JSON.stringify({ workspacePath: oldWorkspace }),
    );
    db.prepare("INSERT INTO project_roots(project_id,root_path,position) VALUES(?,?,0)").run(
      "local-project",
      oldWorkspace,
    );
    db.prepare("INSERT INTO project_roots(project_id,root_path,position) VALUES(?,?,0)").run(
      "remote-project",
      oldWorkspace,
    );
    db.prepare("INSERT INTO task_group_view_node_orders VALUES('task',?,7,1,2)").run(
      JSON.stringify([oldWorkspace, "task-local"]),
    );
    db.close();
    await hostStorageRelocation.relocate(plan);
    const copied = new DatabaseSync(path);
    try {
      expect(
        copied
          .prepare(
            "SELECT workspace_key,workspace_path,root_path FROM tasks WHERE task_id='task-local'",
          )
          .get(),
      ).toEqual({
        workspace_key: newWorkspace,
        workspace_path: newWorkspace,
        root_path: newWorkspace,
      });
      expect(
        copied
          .prepare("SELECT workspace_key,workspace_path FROM tasks WHERE task_id='task-remote'")
          .get(),
      ).toEqual({ workspace_key: identity, workspace_path: oldWorkspace });
      const meta = copied.prepare("SELECT meta_json FROM tasks WHERE task_id='task-local'").get()!;
      expect(JSON.parse(String(meta.meta_json))).toEqual({
        workspacePath: newWorkspace,
        title: oldWorkspace,
      });
      expect(
        copied.prepare("SELECT root_path FROM project_roots WHERE project_id='local-project'").get()
          ?.root_path,
      ).toBe(newWorkspace);
      expect(
        copied
          .prepare("SELECT root_path FROM project_roots WHERE project_id='remote-project'")
          .get()?.root_path,
      ).toBe(oldWorkspace);
      expect(
        copied.prepare("SELECT node_key,sort_order FROM task_group_view_node_orders").get(),
      ).toEqual({ node_key: JSON.stringify([newWorkspace, "task-local"]), sort_order: 7 });
    } finally {
      copied.close();
    }
    const settings = appSettingsSchema.parse({
      recentProjects: [oldWorkspace],
      lastActiveWorkspace: { kind: "local", workspacePath: oldWorkspace },
    });
    const converted = hostStorageRelocation.settings(settings, plan);
    expect(converted.lastActiveWorkspace).toEqual({
      ...settings.lastActiveWorkspace,
      workspacePath: newWorkspace,
    });
    expect(settings.lastActiveWorkspace?.workspacePath).toBe(oldWorkspace);
  } finally {
    if (db.isOpen) db.close();
    await rm(root, { recursive: true, force: true });
  }
});
