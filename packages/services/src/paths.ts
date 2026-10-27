/* path 规则集中维护：旧 task 快照与 provider 配置路径仍在这里收口。 */
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep, win32 } from "node:path";
import { homedir } from "node:os";
import {
  DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
  OPENZWORK_DATA_DIR_NAME,
  ZCODE_AGENT_RUNTIME,
} from "@zcode/shared";
import {
  BUSINESS_DATA_ENTRIES,
  DATA_ROOT_RELOCATED_MARKER,
  dataDirectory,
  relocateDataPath,
  type DataRelocationPlan,
} from "@zcode/shared/data-directory";
import { relocateHostStorage } from "./project-storage/relocation/index.js";

let _dataBaseDir: string | null = null;
export const ZCODE_WINDOWS_APP_INSTALL_DIR_ENV = "ZCODE_WINDOWS_APP_INSTALL_DIR";
const envDataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim() || null;
const defaultDataBaseDir = process.env.HOME?.trim() || homedir();

export interface DataBaseDirTargetValidationOptions {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  appInstallDir?: string | null;
}

export type DataBaseDirTargetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE;
      forbiddenDir: string;
    };

/** Set the base directory for app data (replaces homedir() prefix). */
export function setDataBaseDir(dir: string | null): void {
  _dataBaseDir = dir?.trim() || null;
}

/** Get the current base directory. Priority: setDataBaseDir() > env ZCODE_DATA_BASE_DIR > homedir(). */
export function getDataBaseDir(): string {
  if (_dataBaseDir) return _dataBaseDir;
  if (envDataBaseDir) return envDataBaseDir;
  // 服务实例会启动后台刷新任务；若每次调用都动态读取 HOME，
  // 测试或宿主切换环境变量后，旧实例可能把数据写到新实例目录。
  return defaultDataBaseDir;
}

/** {dataBaseDir}/.openzwork */
export function getZCodeDataRootDir(): string {
  return join(getDataBaseDir(), OPENZWORK_DATA_DIR_NAME);
}

/** 非项目对话共享的真实工作目录；默认 ~/.openzwork/workspace/default。 */
export function getConversationWorkspaceDir(): string {
  return join(getZCodeDataRootDir(), "workspace", "default");
}

/** {dataBaseDir}/.openzwork/v2 */
export function getAppConfigDir(): string {
  return join(getZCodeDataRootDir(), "v2");
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(env)) {
    if (candidateKey.toLowerCase() !== lowerKey) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeWindowsComparablePath(pathValue: string): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = win32.normalize(trimmed).replace(/[\\/]+$/, "");
  if (!normalized) {
    return null;
  }

  return win32
    .resolve(normalized)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsPathEqualOrInside(pathValue: string, rootValue: string): boolean {
  const normalizedPath = normalizeWindowsComparablePath(pathValue);
  const normalizedRoot = normalizeWindowsComparablePath(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function collectWindowsForbiddenAppInstallDirs(
  options: Required<Pick<DataBaseDirTargetValidationOptions, "env">> &
    Pick<DataBaseDirTargetValidationOptions, "appInstallDir">,
): string[] {
  const env = options.env;
  const programFiles = readEnvValue(env, "ProgramFiles");
  const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)");
  const programW6432 = readEnvValue(env, "ProgramW6432");
  const localAppData = readEnvValue(env, "LOCALAPPDATA");
  const candidates = [
    options.appInstallDir,
    readEnvValue(env, ZCODE_WINDOWS_APP_INSTALL_DIR_ENV),
    ...[programFiles, programFilesX86, programW6432].flatMap((root) =>
      root ? ["OpenZWork", "OpenZWork Preview"].map((name) => win32.join(root, name)) : [],
    ),
    ...(localAppData
      ? ["OpenZWork", "OpenZWork Preview"].map((name) => win32.join(localAppData, "Programs", name))
      : []),
    programFiles ? win32.join(programFiles, "ZCode") : null,
    programFilesX86 ? win32.join(programFilesX86, "ZCode") : null,
    programW6432 ? win32.join(programW6432, "ZCode") : null,
    localAppData ? win32.join(localAppData, "Programs", "ZCode") : null,
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? normalizeWindowsComparablePath(candidate) : null;
    if (!candidate || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }

  return result;
}

export function validateDataBaseDirTarget(
  targetBaseDir: string,
  options: DataBaseDirTargetValidationOptions = {},
): DataBaseDirTargetValidationResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: true };
  }

  for (const forbiddenDir of collectWindowsForbiddenAppInstallDirs({
    env: options.env ?? process.env,
    appInstallDir: options.appInstallDir ?? null,
  })) {
    if (isWindowsPathEqualOrInside(targetBaseDir, forbiddenDir)) {
      return {
        ok: false,
        code: DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
        forbiddenDir,
      };
    }
  }

  return { ok: true };
}

export function getExportLogStageDir(): string {
  return join(getZCodeDataRootDir(), "export-log-stage");
}

export function getExportLogDir(): string {
  return join(getZCodeDataRootDir(), "export-log");
}

export function getFeedbackRootDir(): string {
  return join(getZCodeDataRootDir(), "feedback");
}

export function getFeedbackLogArchiveDir(): string {
  return join(getFeedbackRootDir(), "logs");
}

export function getGitCheckpointIndexRootDir(): string {
  return join(getZCodeDataRootDir(), "git-checkpoint-index");
}

/** ~/.openzwork/v2/tasks-index.sqlite */
export function getTasksIndexDatabasePath(): string {
  return join(getAppConfigDir(), "tasks-index.sqlite");
}

/** workspace 级身份键：远程优先使用 workspaceIdentity，本地回退 workspacePath。 */
function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

/** 与 ZCode session 持久化一致：使用 workspaceKey 的 SHA-256 前 12 位 */
export function getWorkspaceHash(workspacePath: string, workspaceIdentity?: string): string {
  return createHash("sha256")
    .update(getWorkspaceKey(workspacePath, workspaceIdentity))
    .digest("hex")
    .slice(0, 12);
}

/** ~/.openzwork/v2/sessions/{workspaceHash} */
function getTaskSessionDir(workspacePath: string, workspaceIdentity?: string): string {
  return join(getAppConfigDir(), "sessions", getWorkspaceHash(workspacePath, workspaceIdentity));
}

/** ~/.openzwork/v2/sessions/{workspaceHash}/{taskId}.json */
export function getLegacyTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.json`);
}

/** ~/.openzwork/v2/sessions/{workspaceHash}/{taskId}.deleted.json */
export function getLegacyDeletedTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.deleted.json`);
}

/**
 * GLM（唯一 agent provider）的配置目录；nativeConfigDir 已随 fork 净化为 .openzwork/cli。
 * Bugfix：GLM 配置改为直接读写 zcode-cli 的全局配置目录，不做 workspace 隔离，
 * 避免同机不同工作区配置漂移。
 */
export function getProviderWorkspaceConfigDir(): string {
  return ZCODE_AGENT_RUNTIME.nativeConfigDir
    ? join(getDataBaseDir(), ZCODE_AGENT_RUNTIME.nativeConfigDir)
    : join(getDataBaseDir(), ".openzwork", "cli");
}

const MIGRATION_CONTENTS = BUSINESS_DATA_ENTRIES;
const MIGRATION_MARKER = ".data-directory-migration.json";
// 只对产品拥有的会话/索引库做快照；工作区的同名文件和外部数据库属于用户文件。
const MIGRATION_DATABASE_PATTERN = /^(?:v2\/[^/]+\.sqlite|cli\/db\/db\.sqlite)$/;

function migrationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function resolveMigrationSourceRoot(baseDir: string): Promise<string> {
  const root = join(await realpath(baseDir), OPENZWORK_DATA_DIR_NAME);
  try {
    return await realpath(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return root;
    throw error;
  }
}

/** 校验实际路径，不能把目标放进源数据树或借符号链接覆盖原目录。 */
export async function validateDataDirectoryMigration(
  oldBaseDir: string,
  newBaseDir: string,
): Promise<void> {
  const source = await resolveMigrationSourceRoot(oldBaseDir);
  const target = join(await realpath(newBaseDir), OPENZWORK_DATA_DIR_NAME);
  const isWithin = (parent: string, child: string) => {
    const rel = relative(parent, child);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  if (isWithin(source, target) || isWithin(target, source)) {
    throw migrationError(
      "DATA_DIRECTORY_OVERLAP",
      "Source and target data directories must be separate",
    );
  }
  try {
    const targetInfo = await lstat(target);
    if (
      targetInfo.isSymbolicLink() ||
      !targetInfo.isDirectory() ||
      (await directoryEntries(target)).length > 0
    ) {
      throw migrationError(
        "DATA_DIRECTORY_NOT_EMPTY",
        "Choose a folder without existing OpenZWork data",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** 在业务进程启动前复制完整存储快照；旧数据不动，目标非空时不做逐文件合并。 */
export async function copyDataDirectory(
  oldBaseDir: string,
  newBaseDir: string,
  migrationId: string = randomUUID(),
  options: {
    relocateAgent?: (plan: DataRelocationPlan) => Promise<void>;
    commit?: (plan: DataRelocationPlan) => Promise<void>;
  } = {},
): Promise<void> {
  const sourceRoot = await resolveMigrationSourceRoot(oldBaseDir);
  const targetBase = await realpath(newBaseDir);
  const targetRoot = join(targetBase, OPENZWORK_DATA_DIR_NAME);
  if (sourceRoot === targetRoot)
    throw migrationError(
      "DATA_DIRECTORY_OVERLAP",
      "Source and target data directories must be separate",
    );
  // 两根按稳定顺序锁定，避免 A→B 与 B→A 的并发准入互等。
  const roots = [sourceRoot, targetRoot].sort();
  await dataDirectory.exclusive(roots[0]!, () =>
    dataDirectory.exclusive(roots[1]!, () =>
      copyExclusiveDataDirectory(
        sourceRoot,
        targetBase,
        targetRoot,
        oldBaseDir,
        newBaseDir,
        migrationId,
        options,
      ),
    ),
  );
}

async function copyExclusiveDataDirectory(
  sourceRoot: string,
  targetBase: string,
  targetRoot: string,
  oldBaseDir: string,
  newBaseDir: string,
  migrationId: string,
  options: {
    relocateAgent?: (plan: DataRelocationPlan) => Promise<void>;
    commit?: (plan: DataRelocationPlan) => Promise<void>;
  },
): Promise<void> {
  const marker = { version: 2, id: migrationId, sourceRoot, targetRoot };
  const sourceMarker = join(sourceRoot, DATA_ROOT_RELOCATED_MARKER);
  const plan = (stageRoot: string): DataRelocationPlan => ({
    sourceRoot,
    targetRoot,
    stageRoot,
    sourceAliases: [join(oldBaseDir, OPENZWORK_DATA_DIR_NAME)],
  });
  try {
    const retired = JSON.parse(await readFile(sourceMarker, "utf8"));
    if (retired.id !== migrationId || retired.targetRoot !== targetRoot)
      throw migrationError(
        "DATA_DIRECTORY_RELOCATED",
        "The source data directory belongs to another relocation plan",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const published = JSON.parse(await readFile(join(targetRoot, MIGRATION_MARKER), "utf8"));
    if (
      published.version === marker.version &&
      published.id === marker.id &&
      published.sourceRoot === sourceRoot
    ) {
      await options.commit?.(plan(targetRoot));
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await validateDataDirectoryMigration(oldBaseDir, newBaseDir);
  try {
    if (!(await lstat(sourceRoot)).isDirectory()) throw new Error("Expected a source data directory");
  } catch (cause) {
    throw Object.assign(new Error("The original data directory is unavailable. Restore access before retrying relocation.", { cause }), { code: "DATA_DIRECTORY_SOURCE_UNAVAILABLE" });
  }
  const stage = await mkdtemp(join(targetBase, ".openzwork-migration-"));
  let published = false;
  try {
    await mkdir(sourceRoot, { recursive: true });
    // 先封住源根重入；进程崩溃后只允许相同计划重试或显式取消。
    await writeFile(sourceMarker, JSON.stringify(marker), { mode: 0o600 });
    const databases: string[] = [];
    for (const entry of MIGRATION_CONTENTS) {
      const source = join(sourceRoot, entry);
      try {
        await lstat(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await cp(source, join(stage, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
        filter: async (path) => {
          const rel = relative(sourceRoot, path).split(sep).join("/");
          if (rel === "v2/setting.json" || rel.startsWith("v2/setting.json.")) return false;
          if (rel === "cli/config.json" || rel.startsWith("cli/config.json.")) return false;
          const info = await lstat(path);
          if (MIGRATION_DATABASE_PATTERN.test(rel)) {
            if (!info.isFile() && !info.isSymbolicLink()) {
              throw migrationError(
                "DATA_DIRECTORY_DATABASE_INVALID",
                "Expected an application database file",
              );
            }
            databases.push(rel);
            return false;
          }
          // 历史 agent-config 共享链接由运行时重建；真实工作区链接必须保留或明确失败。
          if (info.isSymbolicLink()) {
            if (rel.startsWith("v2/agent-config/")) return false;
            // 转换器只写副本；这些目录若保留链接会把离线 SQL/快照改写指回源目录。
            if (
              [
                "v2",
                "v2/sessions",
                "cli",
                "cli/db",
                "cli/memories",
                "cli/memories/projects",
              ].includes(rel)
            )
              throw migrationError(
                "DATA_DIRECTORY_SOURCE_LINK",
                "Application database and index directories must be real directories before relocation",
              );
            return true;
          }
          return !MIGRATION_DATABASE_PATTERN.test(rel.replace(/-(?:wal|shm|journal)$/, ""));
        },
      });
    }
    for (const rel of databases) {
      const destination = join(stage, rel);
      await mkdir(dirname(destination), { recursive: true });
      // 普通 cp 会拆开 WAL 与主库；SQLite backup 读取同一个已提交快照。
      const sourceDb = new DatabaseSync(join(sourceRoot, rel), { readOnly: true });
      try {
        await backup(sourceDb, destination);
      } finally {
        sourceDb.close();
      }
      const copiedDb = new DatabaseSync(destination, { readOnly: true });
      try {
        const check = copiedDb.prepare("PRAGMA quick_check").all();
        if (check.length !== 1 || Object.values(check[0] ?? {})[0] !== "ok") {
          throw migrationError(
            "DATA_DIRECTORY_DATABASE_INVALID",
            "Copied database failed integrity validation",
          );
        }
      } finally {
        copiedDb.close();
      }
    }
    const relocation = plan(stage);
    await relocateHostStorage(relocation);
    const cliEntries = await directoryEntries(join(stage, "cli"));
    if (cliEntries.length) {
      if (!options.relocateAgent)
        throw migrationError(
          "DATA_DIRECTORY_AGENT_REQUIRED",
          "The bundled CLI is required to migrate session references",
        );
      await options.relocateAgent(relocation);
    }
    await relocateCopiedLinks(stage, relocation);
    await writeFile(join(stage, MIGRATION_MARKER), JSON.stringify(marker), { mode: 0o600 });
    // rename 仅能替换空目录；目标被其他进程写入时失败，不覆盖其业务数据。
    try {
      await rmdir(targetRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stage, targetRoot);
    published = true;
    await options.commit?.(relocation);
  } finally {
    if (!published) await rm(sourceMarker, { force: true });
    await rm(stage, { recursive: true, force: true });
  }
}

async function relocateCopiedLinks(directory: string, plan: DataRelocationPlan): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await relocateCopiedLinks(path, plan);
    else if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      const next = relocateDataPath(target, plan);
      if (target === next) continue;
      const type = (await stat(path)).isDirectory() ? "dir" : "file";
      await unlink(path);
      await symlink(next, path, type);
    }
  }
}
