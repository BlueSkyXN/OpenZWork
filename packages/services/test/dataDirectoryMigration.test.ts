import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliStorageRelocation } from "@zcode/adapters/storage";
import { dataDirectory, DATA_ROOT_RELOCATED_MARKER } from "@zcode/shared/data-directory";

const runFile = promisify(execFile);
const envKeys = ["HOME", "ZCODE_DESKTOP_HOME_DIR", "ZCODE_DATA_BASE_DIR"] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const roots: string[] = [];
async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openzwork-migration-")));
  roots.push(root);
  return root;
}
async function runtime() {
  const home = await temp();
  process.env.HOME = home;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  delete process.env.ZCODE_DATA_BASE_DIR;
  vi.resetModules();
  const paths = await import("../src/paths.js");
  paths.setDataBaseDir(home);
  const settings = await import("../src/setting/settingService.js");
  await mkdir(join(home, ".openzwork", "v2"), { recursive: true });
  return { home, ...paths, ...settings };
}
async function fixture(root: string, relativePath: string, content: string) {
  const parts = relativePath.split("/");
  const file = parts.pop()!;
  const directory = join(root, ".openzwork", ...parts);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, file), content);
}
afterEach(async () => {
  for (const key of envKeys) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("data directory migration", () => {
  it("does not replace an unavailable original root with an empty published directory", async () => {
    const context = await runtime();
    const source = await temp();
    const target = await temp();
    await expect(context.copyDataDirectory(source, target)).rejects.toMatchObject({ code: "DATA_DIRECTORY_SOURCE_UNAVAILABLE" });
    await expect(readFile(join(target, ".openzwork/.data-directory-migration.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains a completed snapshot after pointer failure and allows explicit cancellation", async () => {
    const context = await runtime();
    const target = await temp();
    await fixture(context.home, "v2/item.txt", "original");
    const service = context.createSettingService();
    await service.updateDataBaseDir(target);
    const plan = (await service.get()).pendingDataBaseDirMigration!;
    await expect(
      context.copyDataDirectory(context.home, target, plan.id, {
        commit: async () => {
          throw new Error("synthetic pointer failure");
        },
      }),
    ).rejects.toThrow("synthetic pointer failure");
    await expect(dataDirectory.acquireUse(join(context.home, ".openzwork"))).rejects.toMatchObject({
      code: "DATA_DIRECTORY_RELOCATED",
    });
    expect(await readFile(join(target, ".openzwork/v2/item.txt"), "utf8")).toBe("original");
    await context.cancelPendingDataBaseDirMigration();
    expect((await service.get()).pendingDataBaseDirMigration).toBeUndefined();
    await (
      await dataDirectory.acquireUse(join(context.home, ".openzwork"))
    )();
    await expect(
      readFile(join(context.home, ".openzwork", DATA_ROOT_RELOCATED_MARKER)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back an unpublished copy when the CLI owner cannot transform it", async () => {
    const context = await runtime();
    const target = await temp();
    await fixture(context.home, "cli/artifacts/output.txt", "unchanged");
    const service = context.createSettingService();
    await service.updateDataBaseDir(target);
    await expect(
      context.applyPendingDataBaseDirMigration(async () => {
        throw new Error("conversion failed");
      }),
    ).rejects.toThrow("conversion failed");
    await expect(
      readFile(join(target, ".openzwork/cli/artifacts/output.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await (
      await dataDirectory.acquireUse(join(context.home, ".openzwork"))
    )();
    expect(await readFile(join(context.home, ".openzwork/cli/artifacts/output.txt"), "utf8")).toBe(
      "unchanged",
    );
  });

  it("uses the canonical target path so default workspace memory does not diverge through an alias", async () => {
    const context = await runtime();
    const target = await temp();
    const aliases = await temp();
    const alias = join(aliases, "destination");
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const service = context.createSettingService();
    await service.updateDataBaseDir(alias);
    await context.applyPendingDataBaseDirMigration();
    expect((await service.get()).dataBaseDir).toBe(target);
  });

  it("saves only a plan, includes later writes, and reopens both SQLite stores in a fresh process", async () => {
    const context = await runtime();
    const target = await temp();
    const service = context.createSettingService();
    await service.update({ locale: "en-US", dataBaseDir: context.home });
    await mkdir(join(context.home, ".openzwork/cli/db"), { recursive: true });
    const databasePaths = ["v2/tasks-index.sqlite", "cli/db/db.sqlite"];
    const databases = databasePaths.map((rel) => {
      const db = new DatabaseSync(join(context.home, ".openzwork", rel));
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE items (id TEXT PRIMARY KEY, body TEXT);");
      db.prepare("INSERT INTO items VALUES (?, ?)").run("task-1", "before save");
      return db;
    });
    try {
      await service.updateDataBaseDir(target);
      expect((await service.get()).dataBaseDir).toBe(context.home);
      expect((await service.get()).pendingDataBaseDirMigration?.targetBaseDir).toBe(target);
      expect(await readdir(target)).toEqual([]);
      for (const db of databases)
        db.prepare("INSERT INTO items VALUES (?, ?)").run("task-2", "after save");
    } finally {
      for (const db of databases) db.close();
    }
    for (const rel of [
      "cli/memories/projects/work/memory.md",
      "cli/artifacts/result.txt",
      "workspace/default/note.txt",
      "clipboard/attachment.txt",
      "security/trust-canary.txt",
      "workspace/default/user-file.sqlite",
      "workspace/default/user-file.sqlite-wal",
    ]) {
      await fixture(context.home, rel, rel);
    }
    await fixture(context.home, "cli/config.json", '{"userConfig":true}');
    await context.applyPendingDataBaseDirMigration(cliStorageRelocation.relocate);
    const saved = await context.createSettingService().get();
    expect(saved.dataBaseDir).toBe(target);
    expect(saved.pendingDataBaseDirMigration).toBeUndefined();
    expect(saved.locale).toBe("en-US");
    for (const rel of databasePaths) {
      const file = join(target, ".openzwork", rel);
      const result = await runFile(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { DatabaseSync } from "node:sqlite";
        const db = new DatabaseSync(process.argv[1]);
        console.log(JSON.stringify(db.prepare('SELECT * FROM items ORDER BY id').all()));
        db.prepare('INSERT INTO items VALUES (?, ?)').run('task-3', 'new root');
        db.close();
      `,
        file,
      ]);
      expect(JSON.parse(result.stdout)).toEqual([
        { id: "task-1", body: "before save" },
        { id: "task-2", body: "after save" },
      ]);
      const old = new DatabaseSync(join(context.home, ".openzwork", rel));
      try {
        expect(old.prepare("SELECT count(*) AS n FROM items").get()?.n).toBe(2);
      } finally {
        old.close();
      }
    }
    expect(
      await readFile(join(target, ".openzwork/cli/memories/projects/work/memory.md"), "utf8"),
    ).toBe("cli/memories/projects/work/memory.md");
    expect(await readFile(join(target, ".openzwork/workspace/default/note.txt"), "utf8")).toBe(
      "workspace/default/note.txt",
    );
    for (const rel of [
      "security/trust-canary.txt",
      "workspace/default/user-file.sqlite",
      "workspace/default/user-file.sqlite-wal",
    ]) {
      expect(await readFile(join(target, ".openzwork", rel), "utf8")).toBe(rel);
    }
    await expect(readFile(join(target, ".openzwork/v2/setting.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(target, ".openzwork/cli/config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("includes committed WAL pages without copying a mismatched WAL/SHM pair", async () => {
    const context = await runtime();
    const target = await temp();
    const db = new DatabaseSync(join(context.home, ".openzwork/v2/tasks-index.sqlite"));
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE items (body TEXT); INSERT INTO items VALUES ('wal-only');",
      );
      await context.copyDataDirectory(context.home, target);
      const copied = new DatabaseSync(join(target, ".openzwork/v2/tasks-index.sqlite"));
      try {
        expect(copied.prepare("SELECT body FROM items").get()?.body).toBe("wal-only");
      } finally {
        copied.close();
      }
      expect(await readdir(join(target, ".openzwork/v2"))).not.toContain("tasks-index.sqlite-wal");
    } finally {
      db.close();
    }
  });

  it("rejects occupied targets before changing the pointer or either data set", async () => {
    const context = await runtime();
    const target = await temp();
    await fixture(target, "v2/existing.txt", "target");
    const service = context.createSettingService();
    await service.update({ dataBaseDir: context.home });
    await expect(service.updateDataBaseDir(target)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_NOT_EMPTY",
    });
    expect((await service.get()).pendingDataBaseDirMigration).toBeUndefined();
    expect((await service.get()).dataBaseDir).toBe(context.home);
    expect(await readFile(join(target, ".openzwork/v2/existing.txt"), "utf8")).toBe("target");
  });

  it("keeps the original pointer and plan when copying an invalid database fails", async () => {
    const context = await runtime();
    const target = await temp();
    const service = context.createSettingService();
    await service.update({ dataBaseDir: context.home });
    await fixture(context.home, "v2/tasks-index.sqlite", "invalid database");
    await service.updateDataBaseDir(target);
    await expect(context.applyPendingDataBaseDirMigration()).rejects.toThrow();
    expect((await service.get()).dataBaseDir).toBe(context.home);
    expect((await service.get()).pendingDataBaseDirMigration?.targetBaseDir).toBe(target);
    expect((await readdir(target)).filter((entry) => entry !== ".openzwork.data-access")).toEqual(
      [],
    );
    expect(await readFile(join(context.home, ".openzwork/v2/tasks-index.sqlite"), "utf8")).toBe(
      "invalid database",
    );
  });

  it("does not switch to an empty store when a database path is a directory", async () => {
    const context = await runtime();
    const target = await temp();
    await mkdir(join(context.home, ".openzwork/v2/tasks-index.sqlite"));
    const service = context.createSettingService();
    await service.update({ dataBaseDir: context.home });
    await service.updateDataBaseDir(target);
    await expect(context.applyPendingDataBaseDirMigration()).rejects.toMatchObject({
      code: "DATA_DIRECTORY_DATABASE_INVALID",
    });
    expect((await service.get()).dataBaseDir).toBe(context.home);
    expect((await readdir(target)).filter((entry) => entry !== ".openzwork.data-access")).toEqual(
      [],
    );
  });

  it("retries pointer commit for the same completed plan without merging a foreign target", async () => {
    const context = await runtime();
    const target = await temp();
    await fixture(context.home, "v2/item.txt", "original");
    const service = context.createSettingService();
    await service.updateDataBaseDir(target);
    const plan = (await service.get()).pendingDataBaseDirMigration!;
    await context.copyDataDirectory(plan.sourceBaseDir, plan.targetBaseDir, plan.id);
    await context.applyPendingDataBaseDirMigration();
    expect((await service.get()).dataBaseDir).toBe(target);
    await expect(
      context.copyDataDirectory(context.home, target, randomUUID()),
    ).rejects.toMatchObject({ code: "DATA_DIRECTORY_RELOCATED" });
  });

  it("rejects nested targets and aliases of the original root", async () => {
    const context = await runtime();
    const nested = join(context.home, ".openzwork", "nested");
    await mkdir(nested);
    await expect(context.copyDataDirectory(context.home, nested)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_OVERLAP",
    });
    const alias = join(await temp(), "alias");
    await symlink(context.home, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(context.copyDataDirectory(context.home, alias)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_OVERLAP",
    });
  });

  it("cancels a pending plan when the user chooses the current root", async () => {
    const context = await runtime();
    const target = await temp();
    const service = context.createSettingService();
    await service.updateDataBaseDir(target);
    await service.updateDataBaseDir(context.home);
    expect((await service.get()).pendingDataBaseDirMigration).toBeUndefined();
    expect(await readdir(target)).toEqual([]);
  });
});
