import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { runDesktopMemoryMigration } from "../../../packages/desktop/src/main/desktopMemoryMigration.js";
import { createMemoryService } from "../src/memory/memoryService.js";
import { migrateDefaultCliStorageMemories } from "../../../apps/zcode-cli/packages/bootstrap/src/app/memory-migration-bootstrap.js";
import { MEMORY_MIGRATION_HINTS } from "../../../packages/ui/src/settings/memoryMigrationHint.js";
import { createNodeFileSystemAdapter } from "../../../apps/zcode-cli/packages/adapters/src/fs/index.js";
import { scanMemoryManifest } from "../../../apps/zcode-cli/packages/core/src/memory/recall/index.js";
import {
  getMemoryMigrationMarkerPath,
  memoryMigrationMarkerSchema,
  migrateLegacyProjectMemories,
} from "@zcode/shared/node";

// WP-E1a 记忆数据迁移回归测试（docs/spec/memory-migration.md §7 自动化项）。
// 覆盖迁移 helper、CLI/抽取的 Desktop 启动入口、services catalog、CLI recall manifest、
// 双语 hint 文案映射及临时文件清理/真实 SIGKILL 重启；所有数据都由 tmpdir 造假，
// 不读写真实用户数据。Electron Desktop 与实际浏览器开关交互仍是单独的集成验收项。

const fixtureRoot = await mkdtemp(join(tmpdir(), "ozw-memory-migration-"));

/** 造一棵假旧根记忆树：两个项目（含 MEMORY.md 索引 + 主题文件）+ 一个空项目目录。 */
async function writeLegacySourceTree(sourceRoot: string): Promise<void> {
  await mkdir(join(sourceRoot, "projects", "demo-aaaaaaaaaaaaaaaa", "memory"), {
    recursive: true,
  });
  await writeFile(
    join(sourceRoot, "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "MEMORY.md"),
    "# Demo index\n",
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "topic.md"),
    "demo topic content\n",
    "utf8",
  );
  await mkdir(join(sourceRoot, "projects", "other-bbbbbbbbbbbbbbbb", "memory"), {
    recursive: true,
  });
  await writeFile(
    join(sourceRoot, "projects", "other-bbbbbbbbbbbbbbbb", "memory", "MEMORY.md"),
    "# Other index\n",
    "utf8",
  );
  await mkdir(join(sourceRoot, "projects", "empty-cccccccccccccccc"), { recursive: true });
}

async function listDir(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch {
    return [];
  }
}

function createTestLogger() {
  const events: Array<{ level: string; message: string }> = [];
  return {
    events,
    logger: {
      debug: (message: string) => events.push({ level: "debug", message }),
      info: (message: string) => events.push({ level: "info", message }),
      warn: (message: string) => events.push({ level: "warn", message }),
    },
  };
}

after(async () => {
  setDataBaseDir(null);
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("场景 1：旧根有数据 → 一次性复制到当前 storageRoot，字节级一致并写幂等标记", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "migrated-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.status, "migrated");
  assert.equal(result.failures.length, 0);
  // 三个普通文件全部复制；空项目目录只建目录不计文件。
  assert.equal(result.filesCopied, 3);
  assert.equal(result.filesSkipped, 0);

  const migratedIndex = await readFile(
    join(
      targetStorageRoot,
      "cli",
      "memories",
      "projects",
      "demo-aaaaaaaaaaaaaaaa",
      "memory",
      "MEMORY.md",
    ),
    "utf8",
  );
  assert.equal(migratedIndex, "# Demo index\n");
  const migratedTopic = await readFile(
    join(
      targetStorageRoot,
      "cli",
      "memories",
      "projects",
      "demo-aaaaaaaaaaaaaaaa",
      "memory",
      "topic.md",
    ),
    "utf8",
  );
  assert.equal(migratedTopic, "demo topic content\n");
  // 空项目目录（无 memory 子目录）也原样搬运：catalog 按目录枚举。
  assert.ok(
    (await listDir(join(targetStorageRoot, "cli", "memories", "projects"))).includes(
      "empty-cccccccccccccccc",
    ),
  );

  const markerRaw = await readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8");
  const marker = memoryMigrationMarkerSchema.parse(JSON.parse(markerRaw));
  assert.equal(marker.version, 1);
  assert.equal(marker.source, sourceRoot);
  assert.equal(marker.target, join(targetStorageRoot, "cli", "memories"));
  assert.equal(marker.filesCopied, 3);
  assert.ok(!Number.isNaN(Date.parse(marker.completedAt)));
});

test("CLI 接线：默认 storage 迁移后 catalog 可见，recall manifest 可读旧主题文件", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "cli-visible-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const storageRoot = join(caseRoot, "home", ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  const { events, logger } = createTestLogger();

  // 用实际 CLI 接线入口触发迁移，而非直接调用 shared helper。
  await migrateDefaultCliStorageMemories({
    storageRoot,
    sourceMemoriesRoot: sourceRoot,
    defaultStorageRoot: storageRoot,
    logger,
  });
  await access(getMemoryMigrationMarkerPath(storageRoot));

  setDataBaseDir(join(caseRoot, "home"));
  const catalog = await createMemoryService().listProjectMemories();
  assert.ok(catalog.some((workspace) => workspace.id === "demo-aaaaaaaaaaaaaaaa"));
  assert.ok(events.every((event) => event.level !== "warn"));

  const memoryRoot = join(
    storageRoot,
    "cli",
    "memories",
    "projects",
    "demo-aaaaaaaaaaaaaaaa",
    "memory",
  );
  const manifest = await scanMemoryManifest({
    fileSystem: createNodeFileSystemAdapter(),
    rootDir: memoryRoot,
  });
  assert.ok(manifest.some((entry) => entry.filename === "topic.md"));
});

test("CLI 接线：显式自定义 storage 只记 info，不创建默认目标，也不改变 source", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "custom-cli-skip-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const { events, logger } = createTestLogger();
  await writeLegacySourceTree(sourceRoot);

  await migrateDefaultCliStorageMemories({
    storageRoot: "/custom/storage",
    sourceMemoriesRoot: sourceRoot,
    logger,
  });

  assert.deepEqual(await listDir(caseRoot), [".zcode"]);
  assert.ok(events.some((event) => event.level === "info" && event.message.includes(sourceRoot)));
  assert.deepEqual(await listDir(sourceRoot), ["projects"]);
});

test("场景 2：旧根不存在 → no-op，不创建任何目标目录、不写标记", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "noop-missing-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.status, "noop-source-missing");
  assert.equal(result.filesCopied, 0);
  assert.deepEqual(await listDir(caseRoot), []);
});

test("场景 5a：标记存在 → 二次启动直接跳过，零文件复制", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "marker-present-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });

  const again = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(again.status, "noop-marker-present");
  assert.equal(again.filesCopied, 0);
});

test("场景 5b：删标记重跑 → 已存在文件 no-clobber 跳过（filesCopied=0），用户新数据不被旧根覆盖", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "no-clobber-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });

  // 模拟用户已在新版产生记忆后旧根数据再次可见：篡改目标文件并删除标记。
  const newIndex = join(
    targetStorageRoot,
    "cli",
    "memories",
    "projects",
    "demo-aaaaaaaaaaaaaaaa",
    "memory",
    "MEMORY.md",
  );
  await writeFile(newIndex, "# New-version content (must survive)\n", "utf8");
  await rm(getMemoryMigrationMarkerPath(targetStorageRoot), { force: true });

  const rerun = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(rerun.status, "migrated");
  assert.equal(rerun.filesCopied, 0);
  assert.equal(rerun.filesSkipped, 3);
  assert.equal(
    await readFile(newIndex, "utf8"),
    "# New-version content (must survive)\n",
    "no-clobber：目标已存在一律跳过，旧根不得覆盖新版数据（spec §3 规则 4）",
  );
  // 重入完成后标记重新写入，后续启动恢复性能幂等。
  assert.equal(
    (await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot }))
      .status,
    "noop-marker-present",
  );
});

test("场景 6a：中断进程遗留的 tmp 残留在下次迁移开始时被清理", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "tmp-cleanup-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  const staleTmpDir = join(
    targetStorageRoot,
    "cli",
    "memories",
    "projects",
    "demo-aaaaaaaaaaaaaaaa",
    "memory",
  );
  await mkdir(staleTmpDir, { recursive: true });
  // 使用迁移器自有 UUID/PID 命名格式，且 PID 超出系统 PID 范围，确定属于陈旧文件。
  const staleTmpName =
    ".MEMORY.md.memory-migration-00000000-0000-4000-8000-000000000001.2147483647.tmp";
  const activeTmpName =
    `.topic.md.memory-migration-00000000-0000-4000-8000-000000000002.${process.pid}.tmp`;
  await writeFile(join(staleTmpDir, staleTmpName), "partial\n", "utf8");
  await writeFile(join(staleTmpDir, activeTmpName), "in progress\n", "utf8");

  await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });

  assert.deepEqual(
    (await readdir(staleTmpDir)).filter((name) => name.endsWith(".tmp")),
    [activeTmpName],
    "仅清理本迁移格式且所属 PID 已不存在的 tmp，不得删活跃写者文件",
  );
});

test("memory settings hint 文案同时提供中英文", () => {
  assert.equal(
    MEMORY_MIGRATION_HINTS["zh-CN"],
    "开启后将读取本机 ~/.openzwork/cli/memories 下保存的工作区记忆；旧版本（~/.zcode）的数据会在应用启动时自动迁移。",
  );
  assert.equal(
    MEMORY_MIGRATION_HINTS["en-US"],
    "When enabled, workspace memories saved under ~/.openzwork/cli/memories on this device will be read. Data from the previous version (~/.zcode) is migrated automatically on app startup.",
  );
});

test("Desktop 接线：dataBaseDir 下 catalog 可见且 migration marker 同根", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "desktop-custom-base-visible-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const customDataBaseDir = join(caseRoot, "custom-data");
  const targetStorageRoot = join(customDataBaseDir, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  const { events, logger } = createTestLogger();
  await runDesktopMemoryMigration({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
    logger,
  });

  setDataBaseDir(customDataBaseDir);
  const catalog = await createMemoryService().listProjectMemories();
  assert.ok(catalog.some((workspace) => workspace.id === "other-bbbbbbbbbbbbbbbb"));
  assert.ok(events.every((event) => event.level !== "warn"));
  assert.ok(
    await readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8").then((raw) =>
      memoryMigrationMarkerSchema.safeParse(JSON.parse(raw)).success,
    ),
  );
});

test("真实子进程 kill + 重启：清理未提交 tmp、补齐剩余文件并写标记", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "kill-restart-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  // Windows 上 URL.pathname 是 "/D:/..."（前导斜杠+盘符），再经 pathToFileURL 会相对
  // cwd 解析成 D:/D:/... 导致子进程 ERR_MODULE_NOT_FOUND；必须用 fileURLToPath 取原生路径。
  const migrationModule = fileURLToPath(
    new URL("../../shared/src/node/memoryMigration.ts", import.meta.url),
  );
  const workerArgs = ["--import", "tsx", "--input-type=module", "-e", `
    import { pathToFileURL } from "node:url";
    import { open } from "node:fs/promises";
    const { migrateLegacyProjectMemories } = await import(pathToFileURL(process.env.MIGRATION_MODULE ?? "").href);
    const input = JSON.parse(process.env.MIGRATION_INPUT ?? "{}");
    const logger = {
      debug(message) {
        if (process.env.MIGRATION_MODE === "pause" && message.includes("temp file staged:")) {
          return open(process.env.MIGRATION_BLOCKER ?? "", "wx").then(async (handle) => {
            await handle.close();
            await new Promise((resolve) => setTimeout(resolve, 30000));
          });
        }
      },
      info() {},
      warn() {},
    };
    await migrateLegacyProjectMemories({
      ...input,
      logger: process.env.MIGRATION_MODE === "pause" ? logger : undefined,
    });
  `];
  const spawnWorker = (mode: "block-before-file" | "migrate") => {
    const child = spawn(process.execPath, workerArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MIGRATION_INPUT: JSON.stringify({ sourceMemoriesRoot: sourceRoot, targetStorageRoot }),
        MIGRATION_MODULE: migrationModule,
        MIGRATION_MODE: mode === "block-before-file" ? "pause" : "migrate",
        MIGRATION_BLOCKER: join(caseRoot, `blocker-${mode}`),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const done = new Promise<void>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (code === 0 && signal === null) resolveExit();
        else if (signal === "SIGKILL") rejectExit(new Error("migration worker killed with SIGKILL"));
        else rejectExit(new Error(`migration worker exited ${code}/${signal}: ${stderr.trim()}`));
      });
    });
    return { child, done };
  };
  const interrupted = spawnWorker("block-before-file");
  const blockerPath = join(caseRoot, "blocker-block-before-file");
  const startedAt = Date.now();
  while (true) {
    try {
      await access(blockerPath);
      break;
    } catch {
      if (Date.now() - startedAt > 20_000) throw new Error("migration worker did not reach temp stage");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  interrupted.child.kill("SIGKILL");
  await assert.rejects(interrupted.done, /SIGKILL/);

  const memoryTarget = join(targetStorageRoot, "cli", "memories", "projects", "demo-aaaaaaaaaaaaaaaa", "memory");
  assert.ok((await readdir(memoryTarget)).some((name) => name.endsWith(".tmp")));
  const restarted = spawnWorker("migrate");
  await restarted.done;
  await access(getMemoryMigrationMarkerPath(targetStorageRoot));
  assert.deepEqual(
    (await readdir(memoryTarget)).filter((name) => name.endsWith(".tmp")),
    [],
    "真实 kill 后新进程迁移必须清掉残留 tmp",
  );
  assert.equal(await readFile(join(memoryTarget, "MEMORY.md"), "utf8"), "# Demo index\n");
  memoryMigrationMarkerSchema.parse(
    JSON.parse(await readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8")),
  );
});

test("场景 6b：中断恢复续传——已复制文件跳过、缺失文件补齐、最终标记写入", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "resume-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);

  // 模拟上次迁移在复制 1 个文件后中断：有已复制文件、无标记。
  const partialMemoryDir = join(
    targetStorageRoot,
    "cli",
    "memories",
    "projects",
    "demo-aaaaaaaaaaaaaaaa",
    "memory",
  );
  await mkdir(partialMemoryDir, { recursive: true });
  await writeFile(join(partialMemoryDir, "MEMORY.md"), "# Demo index\n", "utf8");

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.status, "migrated");
  assert.equal(result.filesCopied, 2, "只补齐缺失的 2 个文件");
  assert.equal(result.filesSkipped, 1, "已复制的 1 个文件 no-clobber 跳过");
  assert.equal(result.failures.length, 0);
  memoryMigrationMarkerSchema.parse(
    JSON.parse(await readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8")),
  );
});

test("源树内的 symlink 一律跳过，不迁移（catalog 忽略、recall 可能跟随，见 spec §2.1）", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "symlink-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  await symlink(
    join(sourceRoot, "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "MEMORY.md"),
    join(sourceRoot, "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "alias.md"),
  );

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.filesCopied, 3);
  assert.equal(result.filesSkipped, 1, "symlink 计入 skipped");
  const migratedFiles = await listDir(
    join(targetStorageRoot, "cli", "memories", "projects", "demo-aaaaaaaaaaaaaaaa", "memory"),
  );
  assert.ok(!migratedFiles.includes("alias.md"), "symlink 不得出现在目标树");
});

test("桌面与 CLI 默认目录判定：默认 storageRoot 匹配、显式自定义根跳过，desktop 自定义根仍可迁移", async () => {
  // 与 skills-toggle.test.ts 同样使用包内 helper，验证默认值 / CLI 自定义优先级。
  const { isDefaultCliStorageRoot } =
    await import("../../../apps/zcode-cli/packages/bootstrap/src/app/paths.js");
  assert.equal(isDefaultCliStorageRoot(join(homedir(), ".openzwork")), true);
  assert.equal(isDefaultCliStorageRoot(join(homedir(), ".openzwork", "")), true);
  assert.equal(isDefaultCliStorageRoot("/custom/storage"), false);
  assert.equal(isDefaultCliStorageRoot(join(homedir(), ".zcode")), false);

  const caseRoot = await mkdtemp(join(fixtureRoot, "custom-base-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const customStorageRoot = join(caseRoot, "custom-home", ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot: customStorageRoot,
  });
  assert.equal(result.status, "migrated");
  assert.equal(
    await readFile(
      join(
        customStorageRoot,
        "cli",
        "memories",
        "projects",
        "other-bbbbbbbbbbbbbbbb",
        "memory",
        "MEMORY.md",
      ),
      "utf8",
    ),
    "# Other index\n",
  );
  assert.equal(
    getMemoryMigrationMarkerPath(customStorageRoot),
    join(customStorageRoot, "v2", "memory-migration.json"),
  );
});

test("源 == 目标（storage.dir 显式指回旧根）时 no-op 双保险", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "same-path-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot: join(caseRoot, ".zcode"),
  });

  assert.equal(result.status, "noop-source-missing");
  assert.deepEqual(await listDir(caseRoot), []);
});

test("双 worker 并发 helper 首迁：目标无撕裂且新版竞争写入不被迁移覆盖", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "concurrent-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  // 同上：Windows 需 fileURLToPath，pathname 形态会被 pathToFileURL 二次拼接盘符。
  const migrationModule = fileURLToPath(
    new URL("../../shared/src/node/memoryMigration.ts", import.meta.url),
  );
  const sourceData = JSON.stringify({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });
  const workerArgs = ["--import", "tsx", "--input-type=module", "-e", `
    import { pathToFileURL } from "node:url";
    import { open } from "node:fs/promises";
    const { migrateLegacyProjectMemories } = await import(pathToFileURL(process.env.MIGRATION_MODULE ?? "").href);
    const input = JSON.parse(process.env.MIGRATION_INPUT ?? "{}");
    const logger = {
      debug() {},
      info() {},
      warn() {},
    };
    await migrateLegacyProjectMemories({
      ...input,
      logger: process.env.MIGRATION_PAUSE === "1" ? logger : undefined,
    });
  `];
  const runWorker = () =>
    new Promise<void>((resolveExit, rejectExit) => {
      const child = spawn(process.execPath, workerArgs, {
        cwd: process.cwd(),
        env: { ...process.env, MIGRATION_INPUT: sourceData, MIGRATION_MODULE: migrationModule },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", rejectExit);
      child.once("exit", (code) =>
        code === 0 ? resolveExit() : rejectExit(new Error(`migration worker exited ${code}: ${stderr.trim()}`)),
      );
    });
  await Promise.all([runWorker(), runWorker()]);

  assert.equal(
    await readFile(join(targetStorageRoot, "cli", "memories", "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "MEMORY.md"), "utf8"),
    "# Demo index\n",
    "并发迁移目标必须是完整旧文件，而不是撕裂内容",
  );
  assert.equal(
    (await readdir(join(targetStorageRoot, "cli", "memories", "projects", "demo-aaaaaaaaaaaaaaaa", "memory"))).some((name) => name.endsWith(".tmp")),
    false,
    "两个 worker 退出后不应残留临时文件",
  );

  const contestedTarget = join(targetStorageRoot, "cli", "memories", "projects", "demo-aaaaaaaaaaaaaaaa", "memory", "topic.md");
  await writeFile(contestedTarget, "new-version writer\n", "utf8");
  await rm(getMemoryMigrationMarkerPath(targetStorageRoot), { force: true });
  await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });
  assert.equal(await readFile(contestedTarget, "utf8"), "new-version writer\n");
});

test("标记损坏（写一半/手改）→ 视为未迁移重入，no-clobber 兜底后覆盖为新标记", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "corrupt-marker-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  await migrateLegacyProjectMemories({ sourceMemoriesRoot: sourceRoot, targetStorageRoot });
  await writeFile(getMemoryMigrationMarkerPath(targetStorageRoot), "{ truncated", "utf8");

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.status, "migrated");
  assert.equal(result.filesCopied, 0, "数据已在位：no-clobber 全跳过");
  const marker = memoryMigrationMarkerSchema.parse(
    JSON.parse(await readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8")),
  );
  assert.equal(marker.filesCopied, 0);
});

test("部分目录不可创建 → 计入 failures 不中断整体，且不写幂等标记（下次启动重试）", async () => {
  const caseRoot = await mkdtemp(join(fixtureRoot, "failure-path-"));
  const sourceRoot = join(caseRoot, ".zcode", "cli", "memories");
  const targetStorageRoot = join(caseRoot, ".openzwork");
  await writeLegacySourceTree(sourceRoot);
  // 目标 projects 位置被同名文件占位：复制 projects 子树时 mkdir 必失败。
  await mkdir(join(targetStorageRoot, "cli", "memories"), { recursive: true });
  await writeFile(join(targetStorageRoot, "cli", "memories", "projects"), "not a dir\n", "utf8");

  const result = await migrateLegacyProjectMemories({
    sourceMemoriesRoot: sourceRoot,
    targetStorageRoot,
  });

  assert.equal(result.status, "migrated");
  assert.ok(result.failures.length > 0);
  assert.ok(
    result.failures.every((failure) => failure.path.includes("projects")),
    "失败记录必须给出可诊断路径",
  );
  // 有失败项不写标记：下次启动自动重试（spec §2.1 中断恢复语义的失败版）。
  await assert.rejects(
    () => readFile(getMemoryMigrationMarkerPath(targetStorageRoot), "utf8"),
    /ENOENT/,
  );
});

