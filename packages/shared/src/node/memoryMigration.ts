// WP-E1a 记忆数据迁移：把旧数据根（~/.zcode）下的 cli/memories 一次性单向复制到
// 当前生效的 storageRoot。背景与规则见 docs/spec/memory-migration.md：
// - WP-03 把数据根改名为 ~/.openzwork 后没有任何记忆迁移，老用户既有记忆对
//   UI catalog 与 CLI recall 双边不可见；本函数是该问题的唯一修复入口。
// - 迁移是纯增量复制：绝不删除/修改旧根；逐文件 no-clobber（目标存在即跳过），
//   临时文件+硬链接保证目标一旦存在即为完整内容；幂等标记写在 {targetStorageRoot}/v2。
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, link, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWritePrivateTextFile } from "./privateFilePersistence.js";

/** 幂等标记文件名，位于 {targetStorageRoot}/v2/（与 agents-state.json 同层，不污染 CLI 数据树）。 */
const MEMORY_MIGRATION_MARKER_FILE_NAME = "memory-migration.json";
/** 目标树内的记忆数据相对路径（旧根与新根目录结构同构，仅数据根改名）。 */
const MEMORIES_RELATIVE_PATH = join("cli", "memories");
/**
 * 仅识别本迁移生成的临时文件：隐藏名 + UUID + PID；清理时用 PID 判断是否仍有另一个
 * desktop/CLI 迁移进程正在写，避免并发首启把活跃临时文件当成陈旧残留删除。
 */
// UUID 版本与变体位限制及固定标签，确保只匹配迁移器创建的临时文件。
const tmpFilePattern = /^\..+\.memory-migration-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(\d+)\.tmp$/i;

/** 幂等标记 schema：标记存在即「该数据根已迁移完成」的唯一事实（spec §4）。 */
export const memoryMigrationMarkerSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  target: z.string(),
  completedAt: z.string(),
  filesCopied: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
});

export type MemoryMigrationMarker = z.infer<typeof memoryMigrationMarkerSchema>;

export interface MemoryMigrationResult {
  status: "migrated" | "noop-source-missing" | "noop-marker-present";
  filesCopied: number;
  filesSkipped: number;
  /** 单文件失败不中断整体迁移；存在 failures 时不写幂等标记，下次启动自动重试。 */
  failures: Array<{ path: string; error: string }>;
}

/**
 * 调用方 logger 的最小接口。只收 message（不含结构化 context）：
 * desktop main 的变参 logger 与 CLI contracts Logger 都能直接满足，
 * 避免两个宿主的 LogContext 类型差异把 shared 绑到任一侧。
 */
export interface MemoryMigrationLogger {
  debug: (message: string) => void | Promise<void>;
  info: (message: string) => void;
  warn: (message: string) => void;
}

function isNoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 目标文件是否已存在：ENOENT 视为不存在；普通文件或 symlink 冲突都不能被覆盖。
 * 目录/FIFO 等非常规同名冲突不能算迁移完成，否则会写标记却缺失记忆数据。
 */
async function targetFileExists(path: string): Promise<boolean> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isNoentError(error)) return false;
    throw error;
  }
  if (stat.isFile() || stat.isSymbolicLink()) return true;
  throw new Error(`Target exists but is not a regular file: ${path}`);
}

/** 读标记文件；不存在返回 null；内容损坏（JSON 解析失败）同样返回 null。 */
async function readMarkerIfPresent(markerPath: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await readFile(markerPath, "utf8");
  } catch (error) {
    if (isNoentError(error)) return null;
    throw error;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // 标记写一半/被手改：视为未迁移，no-clobber 语义保证重入安全。
    return null;
  }
}

/** 迁移开始前清理目标树内上次中断遗留的 tmp 残留（spec §2.1；硬链接提交后正常路径无残留）。 */
async function cleanupStaleTmpFiles(root: string, logger: MemoryMigrationLogger): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNoentError(error)) return;
    // 清理是辅助动作：失败只 warn，不能阻断迁移本身。
    logger.warn(
      `[memoryMigration] stale tmp cleanup readdir failed: ${root}: ${getErrorMessage(error)}`,
    );
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await cleanupStaleTmpFiles(path, logger);
      continue;
    }
    if (!entry.isFile()) continue;
    const match = tmpFilePattern.exec(entry.name);
    if (!match) continue;
    // 并发启动的另一个迁移进程可能正复制至其随机 tmp；活跃 PID 的临时文件归写者清理。
    const ownerPid = Number(match[1]);
    if (
      ownerPid === process.pid ||
      (ownerPid > 0 && isProcessAlive(ownerPid))
    ) {
      continue;
    }
    await rm(path, { force: true }).catch((error: unknown) => {
      logger.warn(
        `[memoryMigration] stale tmp cleanup failed: ${path}: ${getErrorMessage(error)}`,
      );
    });
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 仅探测进程，不发送信号；EPERM 同样表示 PID 存在。
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code === "EPERM"
      : false;
  }
}

/**
 * 一次性单向复制迁移：source（旧根 cli/memories，调用方拼好）→ target storageRoot
 * 下的 cli/memories，逐文件 no-clobber；幂等标记写 {targetStorageRoot}/v2/memory-migration.json。
 *
 * 判定顺序（spec §2.1）：源 ENOENT → no-op 不写标记（「先跑新版、旧根又出现数据」
 * 的边缘序列仍能被下次启动拾起）；标记存在 → no-op（性能幂等，此后旧根变化不重迁）；
 * 否则执行 no-clobber 复制（自身可重入，中断后下次启动续传）→ 写标记。
 */
export async function migrateLegacyProjectMemories(input: {
  sourceMemoriesRoot: string;
  targetStorageRoot: string;
  logger?: MemoryMigrationLogger;
}): Promise<MemoryMigrationResult> {
  const logger: MemoryMigrationLogger = input.logger ?? {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
  const sourceRoot = input.sourceMemoriesRoot;
  const targetRoot = join(input.targetStorageRoot, MEMORIES_RELATIVE_PATH);
  const markerPath = join(input.targetStorageRoot, "v2", MEMORY_MIGRATION_MARKER_FILE_NAME);

  // 源 == 目标（如用户把 storage.dir 显式指回 ~/.zcode）时复制无意义，直接 no-op。
  // 该场景在 CLI 调用点已按「非默认根跳过」拦截，这里是纯双保险。
  if (sourceRoot === targetRoot) {
    logger.debug(`[memoryMigration] source equals target, skip: ${sourceRoot}`);
    return { status: "noop-source-missing", filesCopied: 0, filesSkipped: 0, failures: [] };
  }

  try {
    const sourceStat = await lstat(sourceRoot);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      // 旧根位置被文件/链接占位属于异常环境：按源缺失处理（no-op 不写标记），不搬非常规内容。
      logger.warn(`[memoryMigration] source is not a plain directory, skip: ${sourceRoot}`);
      return { status: "noop-source-missing", filesCopied: 0, filesSkipped: 0, failures: [] };
    }
  } catch (error) {
    if (isNoentError(error)) {
      // 新用户/已清理机器：no-op 且不写标记（每次启动仅一次 lstat，成本可忽略）。
      logger.debug(`[memoryMigration] legacy source missing, nothing to migrate: ${sourceRoot}`);
      return { status: "noop-source-missing", filesCopied: 0, filesSkipped: 0, failures: [] };
    }
    throw error;
  }

  try {
    const markerRaw = await readMarkerIfPresent(markerPath);
    if (markerRaw !== null && memoryMigrationMarkerSchema.safeParse(markerRaw).success) {
      logger.debug(`[memoryMigration] marker present, skip: ${markerPath}`);
      return { status: "noop-marker-present", filesCopied: 0, filesSkipped: 0, failures: [] };
    }
  } catch (error) {
    // 标记读取失败（权限等）时继续迁移：no-clobber 保证重入安全，迁移完成后覆盖写新标记。
    logger.warn(
      `[memoryMigration] marker read failed, continuing: ${markerPath}: ${getErrorMessage(error)}`,
    );
  }

  const result: MemoryMigrationResult = {
    status: "migrated",
    filesCopied: 0,
    filesSkipped: 0,
    failures: [],
  };
  logger.debug(`[memoryMigration] start: ${sourceRoot} -> ${targetRoot}`);
  await cleanupStaleTmpFiles(targetRoot, logger);
  await copyTree(sourceRoot, targetRoot, result, logger, 0);
  logger.info(
    `[memoryMigration] copied ${result.filesCopied} file(s), skipped ${result.filesSkipped}, ` +
      `${result.failures.length} failure(s): ${sourceRoot} -> ${targetRoot}`,
  );
  for (const failure of result.failures) {
    logger.warn(`[memoryMigration] file failed: ${failure.path}: ${failure.error}`);
  }
  if (result.failures.length > 0) {
    // 有失败项时不写标记：下次启动重入，已复制文件因 no-clobber 跳过、失败文件自动重试。
    // 旧根只读不增长，每次重扫的成本是毫秒级 lstat，数据完整性优先。
    return result;
  }
  const marker: MemoryMigrationMarker = {
    version: 1,
    source: sourceRoot,
    target: targetRoot,
    completedAt: new Date().toISOString(),
    filesCopied: result.filesCopied,
    filesSkipped: result.filesSkipped,
  };
  await atomicWritePrivateTextFile(markerPath, JSON.stringify(marker, null, 2));
  return result;
}

/**
 * 逐文件 no-clobber 复制：目标文件已存在 → 跳过（用户已在新版产生的数据优先）；
 * symlink 不迁（迁入的 symlink 会被 catalog 忽略但可能被 recall 跟随，见 spec §2.1）；
 * 单文件/单目录失败入 failures 不中断整体。
 */
async function copyTree(
  sourceDir: string,
  targetDir: string,
  result: MemoryMigrationResult,
  logger: MemoryMigrationLogger,
  depth: number,
): Promise<void> {
  // 递归深度用于跟踪异常深树，拒绝超过系统递归上限的损坏/恶意路径。
  if (depth > 256) {
    const error = "Memory tree exceeds maximum depth (256)";
    result.failures.push({ path: sourceDir, error });
    logger.warn(`[memoryMigration] ${error}: ${sourceDir}`);
    return;
  }
  try {
    await mkdir(targetDir, { recursive: true });
  } catch (error) {
    result.failures.push({ path: targetDir, error: getErrorMessage(error) });
    return;
  }
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    result.failures.push({ path: sourceDir, error: getErrorMessage(error) });
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      result.filesSkipped += 1;
      continue;
    }
    const sourcePath = join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, join(targetDir, entry.name), result, logger, depth + 1);
      continue;
    }
    if (!entry.isFile()) {
      // FIFO/socket 等非常规文件不属于记忆数据树，跳过即可。
      result.filesSkipped += 1;
      continue;
    }
    const targetPath = join(targetDir, entry.name);
    try {
      if (await targetFileExists(targetPath)) {
        // no-clobber：已存在一律跳过（用户已在新版产生的数据优先于旧根同名文件）。
        result.filesSkipped += 1;
        continue;
      }
      const sourceStat = await lstat(sourcePath);
      // tmp 与目标同目录：排他硬链接作为 no-clobber 原子提交。普通 rename 在 POSIX
      // 会替换竞态中刚出现的目标文件，违反「目标已存在不覆盖」；link 遇 EEXIST 即安全跳过。
      // 唯一临时名与 PID 供并发写者相互识别，tmp 成功 link 后立即清理。
      // 固定 migration 标签，清理器只识别本迁移的文件，不能误删其他工具的通用 .*.tmp。
      const tmpPath = join(
        targetDir,
        `.${entry.name}.memory-migration-${randomUUID()}.${process.pid}.tmp`,
      );
      try {
        // COPYFILE_EXCL 独占创建临时文件并异步复制，避免覆盖已有临时项。
        await copyFile(sourcePath, tmpPath, constants.COPYFILE_EXCL);
        await chmod(tmpPath, sourceStat.mode & 0o777);
        await logger.debug(`[memoryMigration] temp file staged: ${tmpPath}`);
        try {
          await link(tmpPath, targetPath);
          result.filesCopied += 1;
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code?: unknown }).code === "EEXIST"
          ) {
            // 另一迁移进程或新版写入已经提交目标，保留目标的原子完整内容。
            result.filesSkipped += 1;
          } else {
            throw error;
          }
        }
      } finally {
        await rm(tmpPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      result.failures.push({ path: sourcePath, error: getErrorMessage(error) });
    }
  }
}

/** 标记文件的期望路径（纯路径计算，不触文件系统），供调用方诊断与测试使用。 */
export function getMemoryMigrationMarkerPath(targetStorageRoot: string): string {
  return join(targetStorageRoot, "v2", MEMORY_MIGRATION_MARKER_FILE_NAME);
}
