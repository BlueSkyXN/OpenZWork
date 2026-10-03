import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { getMemoryMigrationMarkerPath, migrateLegacyProjectMemories } from "@zcode/shared/node";

const staleName = ".note.md.memory-migration-00000000-0000-4000-8000-000000000001.2147483647.tmp";

async function snapshot(root: string): Promise<string[]> {
  const entries: string[] = [];
  async function walk(path: string): Promise<void> {
    const info = await lstat(path);
    const name = relative(root, path) || ".";
    if (info.isSymbolicLink()) entries.push(`link:${name}:${await readlink(path)}`);
    else if (info.isDirectory()) {
      entries.push(`dir:${name}`);
      for (const child of (await readdir(path)).sort()) await walk(join(path, child));
    } else entries.push(`file:${name}:${(await readFile(path)).toString("base64")}`);
  }
  await walk(root);
  return entries;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ozw-migration-boundary-"));
  const legacy = join(root, "legacy");
  const source = join(legacy, "cli", "memories");
  const target = join(root, "current");
  const outside = join(root, "outside");
  await mkdir(join(source, "project-a"), { recursive: true });
  await mkdir(join(source, "project-b"));
  await mkdir(join(legacy, "v2"));
  await mkdir(outside);
  await writeFile(join(source, "project-a", "note.md"), "legacy-note\n");
  await writeFile(join(source, staleName), "legacy-tmp\n");
  await writeFile(join(outside, staleName), "outside-tmp\n");
  return { root, legacy, source, target, outside };
}

for (const boundary of [
  "storage",
  "cli",
  "memories",
  "project",
  "v2",
  "outside",
  "marker",
  "parent-alias",
]) {
  test(`迁移拒绝 ${boundary} 目标链接，旧根和树外字节不变且不写标记`, async () => {
    const f = await fixture();
    try {
      let target = f.target;
      const links: Record<string, [string, string]> = {
        storage: [f.legacy, f.target],
        cli: [join(f.legacy, "cli"), join(f.target, "cli")],
        memories: [f.source, join(f.target, "cli", "memories")],
        project: [join(f.source, "project-b"), join(f.target, "cli", "memories", "project-a")],
        v2: [join(f.legacy, "v2"), join(f.target, "v2")],
        outside: [f.outside, join(f.target, "cli", "memories")],
        marker: [join(f.legacy, "v2", "marker.json"), getMemoryMigrationMarkerPath(f.target)],
        "parent-alias": [f.legacy, join(f.root, "alias")],
      };
      const [destination, linkPath] = links[boundary]!;
      await mkdir(dirname(linkPath), { recursive: true });
      if (boundary === "marker") await writeFile(destination, "legacy-marker\n");
      await symlink(
        destination,
        linkPath,
        boundary === "marker" ? "file" : process.platform === "win32" ? "junction" : "dir",
      );
      if (boundary === "parent-alias") target = join(linkPath, "new-storage");
      const oldBefore = await snapshot(f.legacy);
      const outsideBefore = await snapshot(f.outside);
      const result = await migrateLegacyProjectMemories({
        sourceMemoriesRoot: f.source,
        targetStorageRoot: target,
      });
      assert.ok(result.failures.length > 0, "目录边界必须显式拒绝，不能静默成功");
      assert.equal(result.filesCopied, 0);
      assert.deepEqual(await snapshot(f.legacy), oldBefore);
      assert.deepEqual(await snapshot(f.outside), outsideBefore);
      if (boundary !== "marker")
        await assert.rejects(readFile(getMemoryMigrationMarkerPath(target)), { code: "ENOENT" });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

for (const overlap of ["equal", "source-inside-target", "target-inside-source"]) {
  test(`源父目录 alias 的物理重叠 ${overlap} 在清理前拒绝且源树不变`, async () => {
    const root = await mkdtemp(join(tmpdir(), "ozw-source-alias-"));
    try {
      const home = join(root, "home");
      const legacy = join(home, ".zcode");
      const target = join(home, ".openzwork");
      const targetMemories = join(target, "cli", "memories");
      const physicalSource =
        overlap === "equal"
          ? targetMemories
          : overlap === "source-inside-target"
            ? join(targetMemories, "source", "memories")
            : join(home, "source", "memories");
      const storage = overlap === "target-inside-source" ? join(physicalSource, "current") : target;
      await mkdir(legacy, { recursive: true });
      await mkdir(physicalSource, { recursive: true });
      await mkdir(join(storage, "cli", "memories"), { recursive: true });
      await writeFile(join(physicalSource, "note.md"), "source-note\n");
      await writeFile(join(physicalSource, staleName), "source-tmp-must-survive\n");
      await writeFile(join(storage, "cli", "memories", staleName), "target-tmp-must-survive\n");
      await symlink(
        dirname(physicalSource),
        join(legacy, "cli"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const source = join(legacy, "cli", "memories");
      assert.equal((await lstat(source)).isDirectory(), true);
      assert.equal(await realpath(source), await realpath(physicalSource));
      const before = await snapshot(home);
      const result = await migrateLegacyProjectMemories({
        sourceMemoriesRoot: source,
        targetStorageRoot: storage,
      });
      const after = await snapshot(home);
      console.info(
        JSON.stringify({
          overlap,
          failures: result.failures.length,
          filesCopied: result.filesCopied,
          sourceChanged: JSON.stringify(before) !== JSON.stringify(after),
        }),
      );
      assert.deepEqual(after, before, "源父目录链接不能让清理/复制/marker 修改物理源树");
      assert.ok(result.failures.length > 0, "物理等同和双向嵌套必须显式拒绝");
      assert.equal(result.filesCopied, 0);
      await assert.rejects(readFile(getMemoryMigrationMarkerPath(storage)), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("源与目标的正常父目录别名不重叠时仍可迁移", async () => {
  const root = await mkdtemp(join(tmpdir(), "ozw-source-parent-"));
  try {
    const data = join(root, "data");
    const alias = join(root, "alias");
    const physicalSource = join(data, "legacy", "cli", "memories");
    await mkdir(physicalSource, { recursive: true });
    await symlink(data, alias, process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(physicalSource, "note.md"), "source-note\n");
    const before = await snapshot(physicalSource);
    const source = join(alias, "legacy", "cli", "memories");
    const target = join(alias, "current");
    const result = await migrateLegacyProjectMemories({
      sourceMemoriesRoot: source,
      targetStorageRoot: target,
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(await snapshot(physicalSource), before);
    assert.equal(
      await readFile(join(target, "cli", "memories", "note.md"), "utf8"),
      "source-note\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("普通目标父目录链接仍可用，目标文件链接按 no-clobber 保留", async () => {
  const f = await fixture();
  try {
    const data = join(f.root, "data");
    const alias = join(f.root, "data-alias");
    await mkdir(data);
    await symlink(data, alias, process.platform === "win32" ? "junction" : "dir");
    const target = join(alias, "current");
    const file = join(target, "cli", "memories", "project-a", "note.md");
    await mkdir(dirname(file), { recursive: true });
    const outsideFile = join(f.outside, "existing.md");
    await writeFile(outsideFile, "existing\n");
    await symlink(outsideFile, file, "file");
    const before = await snapshot(f.legacy);
    const result = await migrateLegacyProjectMemories({
      sourceMemoriesRoot: f.source,
      targetStorageRoot: target,
    });
    assert.deepEqual(result.failures, []);
    assert.equal(await readlink(file), outsideFile);
    assert.equal(await readFile(outsideFile, "utf8"), "existing\n");
    assert.deepEqual(await snapshot(f.legacy), before);
    await readFile(getMemoryMigrationMarkerPath(target));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("修正目标边界后可重试，拒绝阶段不清理有效目标的 tmp", async () => {
  const f = await fixture();
  try {
    const memories = join(f.target, "cli", "memories");
    await mkdir(memories, { recursive: true });
    await writeFile(join(memories, staleName), "target-tmp\n");
    await symlink(
      join(f.legacy, "v2"),
      join(f.target, "v2"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const failed = await migrateLegacyProjectMemories({
      sourceMemoriesRoot: f.source,
      targetStorageRoot: f.target,
    });
    assert.ok(failed.failures.length > 0);
    assert.equal(await readFile(join(memories, staleName), "utf8"), "target-tmp\n");
    await rm(join(f.target, "v2"));
    const retried = await migrateLegacyProjectMemories({
      sourceMemoriesRoot: f.source,
      targetStorageRoot: f.target,
    });
    assert.deepEqual(retried.failures, []);
    assert.equal(await readFile(join(memories, "project-a", "note.md"), "utf8"), "legacy-note\n");
    await readFile(getMemoryMigrationMarkerPath(f.target));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
