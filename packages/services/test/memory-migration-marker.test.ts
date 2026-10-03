import assert from "node:assert/strict";
import fsPromises, { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { getMemoryMigrationMarkerPath, migrateLegacyProjectMemories } from "@zcode/shared/node";

const staleName = ".note.md.memory-migration-00000000-0000-4000-8000-000000000001.2147483647.tmp";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ozw-migration-marker-"));
  const source = join(root, "legacy", "cli", "memories");
  const target = join(root, "current");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "note.md"), "legacy-note\n");
  return { root, source, target };
}

async function observeMemoryIo<T>(
  context: TestContext,
  memories: string,
  operation: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const probes = {
    readdir: context.mock.method(fsPromises, "readdir"),
    lstat: context.mock.method(fsPromises, "lstat"),
    stat: context.mock.method(fsPromises, "stat"),
    realpath: context.mock.method(fsPromises, "realpath"),
  };
  syncBuiltinESMExports();
  try {
    const result = await operation();
    const calls = Object.entries(probes).flatMap(([method, probe]) =>
      probe.mock.calls.flatMap((call) => {
        const path = String(call.arguments[0]);
        const rel = relative(resolve(memories), resolve(path));
        return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
          ? [`${method}:${path}`]
          : [];
      }),
    );
    return { result, calls };
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("有效迁移标记直接跳过，增长后的 memories 子树没有文件系统检查或枚举", async (context) => {
  const f = await fixture();
  try {
    const input = { sourceMemoriesRoot: f.source, targetStorageRoot: f.target };
    assert.deepEqual((await migrateLegacyProjectMemories(input)).failures, []);
    const marker = getMemoryMigrationMarkerPath(f.target);
    const markerBefore = await readFile(marker, "utf8");
    const memories = join(f.target, "cli", "memories");
    for (let index = 0; index < 20; index += 1) {
      await mkdir(join(memories, "projects", `project-${index}`, "memory"), { recursive: true });
    }
    await writeFile(join(memories, staleName), "completed-tmp\n");
    await writeFile(join(f.source, "later.md"), "later-legacy-note\n");
    const { result, calls } = await observeMemoryIo(context, memories, () =>
      migrateLegacyProjectMemories(input),
    );
    assert.equal(result.status, "noop-marker-present");
    assert.deepEqual(result.failures, []);
    assert.deepEqual(calls, [], "完成后不应因记忆目录增长重新检查整棵树");
    assert.equal(await readFile(marker, "utf8"), markerBefore);
    assert.equal(await readFile(join(memories, staleName), "utf8"), "completed-tmp\n");
    await assert.rejects(readFile(join(memories, "later.md")), { code: "ENOENT" });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const markerState of ["missing", "corrupt"]) {
  test(`标记 ${markerState} 时，全树预检在清理前拒绝深层目录链接且可重试`, async () => {
    const f = await fixture();
    try {
      const memories = join(f.target, "cli", "memories");
      const marker = getMemoryMigrationMarkerPath(f.target);
      const outside = join(f.root, "outside");
      const linkedDirectory = join(memories, "projects", "project-a", "memory");
      await mkdir(dirname(linkedDirectory), { recursive: true });
      await mkdir(outside);
      await writeFile(join(memories, staleName), "target-tmp\n");
      await writeFile(join(outside, staleName), "outside-tmp\n");
      if (markerState === "corrupt") {
        await mkdir(dirname(marker), { recursive: true });
        await writeFile(marker, "{incomplete");
      }
      await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
      const input = { sourceMemoriesRoot: f.source, targetStorageRoot: f.target };
      const failed = await migrateLegacyProjectMemories(input);
      assert.ok(failed.failures.length > 0);
      assert.equal(failed.filesCopied, 0);
      assert.equal(await readFile(join(memories, staleName), "utf8"), "target-tmp\n");
      assert.equal(await readFile(join(outside, staleName), "utf8"), "outside-tmp\n");
      if (markerState === "corrupt") assert.equal(await readFile(marker, "utf8"), "{incomplete");
      else await assert.rejects(readFile(marker), { code: "ENOENT" });
      await rm(linkedDirectory);
      const retried = await migrateLegacyProjectMemories(input);
      assert.deepEqual(retried.failures, []);
      assert.equal(await readFile(join(memories, "note.md"), "utf8"), "legacy-note\n");
      await assert.rejects(readFile(join(memories, staleName)), { code: "ENOENT" });
      await readFile(marker);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

for (const boundary of ["storage", "v2", "marker", "overlap"]) {
  test(`有效标记不能绕过 ${boundary} 安全边界`, async () => {
    const f = await fixture();
    try {
      const input = { sourceMemoriesRoot: f.source, targetStorageRoot: f.target };
      assert.deepEqual((await migrateLegacyProjectMemories(input)).failures, []);
      const marker = getMemoryMigrationMarkerPath(f.target);
      const markerBefore = await readFile(marker, "utf8");
      const dirLinkType = process.platform === "win32" ? "junction" : "dir";
      let target = f.target;
      if (boundary === "storage") {
        const alias = join(f.root, "storage-alias");
        await symlink(f.target, alias, dirLinkType);
        target = alias;
      } else if (boundary === "v2") {
        const outside = join(f.root, "outside-v2");
        await mkdir(outside);
        await writeFile(join(outside, "memory-migration.json"), markerBefore);
        await rm(dirname(marker), { recursive: true });
        await symlink(outside, dirname(marker), dirLinkType);
      } else if (boundary === "marker") {
        const outside = join(f.root, "outside-marker.json");
        await writeFile(outside, markerBefore);
        await rm(marker);
        await symlink(outside, marker, "file");
      } else {
        await mkdir(join(f.source, "v2"));
        target = f.source;
        await writeFile(getMemoryMigrationMarkerPath(target), markerBefore);
      }
      const result = await migrateLegacyProjectMemories({ ...input, targetStorageRoot: target });
      assert.ok(result.failures.length > 0);
      assert.equal(result.filesCopied, 0);
      assert.equal(await readFile(getMemoryMigrationMarkerPath(target), "utf8"), markerBefore);
      assert.equal(await readFile(join(f.source, "note.md"), "utf8"), "legacy-note\n");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}
