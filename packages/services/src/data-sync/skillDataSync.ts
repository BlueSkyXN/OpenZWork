import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type {
  DataSyncImportItem,
  DataSyncImportResultItem,
  DataSyncListItem,
  SkillDataSyncPayload,
} from "@zcode/shared";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";
import { withFileLock } from "@zcode/shared/node";
import { pathExists, updateJsonObjectFile } from "#src/fs/atomicFileUtils.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { walkSkillMarkdownPaths } from "#src/skills/skillDiscoveryWalk.js";
import { checkRemoteSyncDirectoriesWriteAccess } from "#src/remote-sync/remoteSyncWriteAccess.js";
import {
  createSkillSyncArchive,
  extractSkillSyncArchive,
} from "#src/skill-sync/skillSyncArchive.js";
import { createSkillSyncSizeLimitError } from "#src/skill-sync/skillSyncErrors.js";
import { resolveSkillSyncPathWithin } from "#src/skill-sync/skillSyncPath.js";
import {
  collectUserSkillCandidates,
  getUserZcodeSkillRoot,
  normalizeSkillNameKey,
  parseSkillMetadata,
  readSkillFileOrNull,
  resolveUserHomeDir,
} from "#src/skill-sync/skillSyncService.js";
import type { IDataSyncCategoryService } from "./contract.js";
import {
  hashDirectoryContent,
  hasSymlinkWithin,
  isPathWithin,
  prepareSyncWriteParent,
  scanDirectoryContent,
} from "./directoryContent.js";
import { errorMessage } from "./syncUtils.js";

const logger = createServiceLogger("skill-data-sync");

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_META_FILE_NAME = "_meta.json";

interface ResolvedUserSkill {
  key: string;
  name: string;
  description: string;
  directoryName: string;
  /** 技能目录（可能是软链路径）。 */
  directoryPath: string;
  skillFilePath: string;
  location: "zcode" | "agents";
  /** 技能目录或其位于技能根以内的上级目录是软链。 */
  isSymlink: boolean;
}

function getCliConfigPath(): string {
  // Bugfix（2026-11-07）：技能启用覆盖状态应存于 OpenZWork 用户配置；
  // 原路径指向官方 ZCode 的 config.json，读写均越界。与 commandsService 同源。
  return join(resolveUserHomeDir(), OPENZWORK_DATA_DIR_NAME, "cli", "config.json");
}

function normalizeSkillConfigPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** 按归一化 name 对齐的用户级技能；同名时保留候选排序中的第一项（`.openzwork` 优先）。 */
async function resolveUserSkills(): Promise<Map<string, ResolvedUserSkill>> {
  const zcodeRoot = getUserZcodeSkillRoot();
  const result = new Map<string, ResolvedUserSkill>();
  for (const candidate of await collectUserSkillCandidates()) {
    const key = normalizeSkillNameKey(candidate.name);
    if (result.has(key)) continue;
    const directoryPath = dirname(candidate.path);
    const location = isPathWithin(zcodeRoot, directoryPath) ? "zcode" : "agents";
    result.set(key, {
      key,
      name: candidate.name,
      description: candidate.description,
      directoryName: candidate.directoryName,
      directoryPath,
      skillFilePath: candidate.path,
      location,
      isSymlink: location === "zcode" ? await hasSymlinkWithin(zcodeRoot, directoryPath) : false,
    });
  }
  return result;
}

/** 只读展示：config.json 损坏时按空配置处理。写入走 updateJsonObjectFile。 */
async function readSkillEnabledOverrides(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(getCliConfigPath(), "utf-8")) as unknown;
    const skills =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).skills : undefined;
    return skills && typeof skills === "object" ? (skills as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isSkillEnabled(overrides: Record<string, unknown>, skillFilePath: string): boolean {
  const override = overrides[normalizeSkillConfigPath(skillFilePath)];
  return !(
    override &&
    typeof override === "object" &&
    (override as Record<string, unknown>).enable === false
  );
}

/** 版本只取技能商店安装元数据（_meta.json），没有时不比较版本。 */
async function readSkillStoreVersion(directoryPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directoryPath, SKILL_META_FILE_NAME), "utf-8"),
    ) as unknown;
    const version =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).version
        : undefined;
    return typeof version === "string" && version.trim() ? version.trim() : undefined;
  } catch {
    return undefined;
  }
}

type IncomingSkill = SkillDataSyncPayload["items"][number];
type CreatedSkillState = { directory: string; enabled: boolean };

function directoryDepth(directoryName: string | undefined): number {
  return directoryName ? directoryName.split("/").length : 0;
}

/** 从归档路径建立后代索引，物理父目录的一次提交覆盖它携带的全部选中后代。 */
function indexSkillDescendants(items: readonly IncomingSkill[]) {
  const index = new Map<string, IncomingSkill[]>();
  for (const item of items) {
    for (let dir = posix.dirname(item.directoryName); dir !== "." && dir !== "/"; dir = posix.dirname(dir)) {
      const children = index.get(dir) ?? [];
      children.push(item);
      index.set(dir, children);
    }
  }
  return index;
}

/** 同一端内目录包含 `skill` 目录的最近一个技能（列表的 parentKey）。 */
function findParentSkill(
  skill: ResolvedUserSkill,
  skills: readonly ResolvedUserSkill[],
): ResolvedUserSkill | undefined {
  let nearest: ResolvedUserSkill | undefined;
  for (const other of skills) {
    if (
      other !== skill &&
      isPathWithin(other.directoryPath, skill.directoryPath) &&
      (!nearest || isPathWithin(nearest.directoryPath, other.directoryPath))
    ) {
      nearest = other;
    }
  }
  return nearest;
}

export function createSkillDataSyncMethods(options: {
  maxItemBytes: number;
}): IDataSyncCategoryService<SkillDataSyncPayload> {
  const { maxItemBytes } = options;

  async function listItem(
    skill: ResolvedUserSkill,
    overrides: Record<string, unknown>,
    parentKey: string | undefined,
  ): Promise<DataSyncListItem> {
    const contentRoot = await realpath(skill.directoryPath);
    const [scan, version] = await Promise.all([
      scanDirectoryContent(contentRoot),
      readSkillStoreVersion(contentRoot),
    ]);
    return {
      key: skill.key,
      name: skill.name,
      description: skill.description,
      ...(parentKey ? { parentKey } : {}),
      ...(version ? { version } : {}),
      signature: { fileCount: scan.fileCount, totalBytes: scan.totalBytes },
      enabled: isSkillEnabled(overrides, skill.skillFilePath),
      ...(scan.totalBytes > maxItemBytes
        ? { exportBlockedReason: "size-limit" as const }
        : scan.containsSymlink
          ? { exportBlockedReason: "contains-symlink" as const }
          : {}),
      ...(skill.location === "agents"
        ? { overwriteBlockedReason: "compat-directory" as const }
        : skill.isSymlink
          ? { overwriteBlockedReason: "target-symlink" as const }
          : {}),
    };
  }

  /** 超限项不计算哈希（性能措施 3）。 */
  async function hashSkill(skill: ResolvedUserSkill, includeExecutableBits = false): Promise<string | undefined> {
    const contentRoot = await realpath(skill.directoryPath);
    const scan = await scanDirectoryContent(contentRoot);
    return scan.totalBytes > maxItemBytes ? undefined : await hashDirectoryContent(contentRoot, { includeExecutableBits });
  }

  async function importOne(params: {
    item: DataSyncImportItem;
    incoming: IncomingSkill;
    existing?: ResolvedUserSkill;
    children: IncomingSkill[];
    incomingRoot: string;
    targetRoot: string;
    backupPath: string;
    keepTempRoot: () => void;
  }): Promise<DataSyncImportResultItem> {
    const { item, incoming, existing, incomingRoot, targetRoot, children, backupPath } = params;
    const failed = (error: string): DataSyncImportResultItem => ({ key: item.key, status: "failed", error });
    const creating = item.mode === "createOnly";
    if ((creating && existing) || (!creating && !existing)) return { key: item.key, status: "conflict" };
    if (existing && (existing.location !== "zcode" || existing.isSymlink)) return failed("nested-target");
    const logicalPath = existing?.directoryPath ?? resolveSkillSyncPathWithin(targetRoot, incoming.directoryName);
    // OW-P042：命令与技能的新增和覆盖均在实际目标父目录内发布。
    const targetPath = await prepareSyncWriteParent(targetRoot, logicalPath);
    const staged = resolveSkillSyncPathWithin(incomingRoot, incoming.directoryName);
    for (const entry of [incoming, ...children]) {
      const dir = resolveSkillSyncPathWithin(incomingRoot, entry.directoryName);
      const content = await readSkillFileOrNull(join(dir, SKILL_FILE_NAME));
      if (content === null) return failed("SKILL.md is missing");
      const metadata = parseSkillMetadata(content, posix.basename(entry.directoryName));
      if (normalizeSkillNameKey(metadata.name) !== entry.key) {
        return failed("invalid skill metadata");
      }
    }
    if (existing) {
      if (!(await pathExists(targetPath))) return { key: item.key, status: "conflict" };
      // OW-P037：以实际目录核验目标独有的子技能，包括按名称去重后隐藏的安装。
      if (await hasSymlinkWithin(targetRoot, logicalPath)) return failed("nested-target");
      for await (const path of walkSkillMarkdownPaths(logicalPath, { onError: (_path, error) => { throw error; } })) {
        if (dirname(path) !== logicalPath) return failed("nested-target");
      }
      const expected = item.expectedTargetHash;
      const actualHash = await hashDirectoryContent(logicalPath, { includeExecutableBits: expected?.includes(":") });
      if (!expected || actualHash !== expected) {
        return { key: item.key, status: "conflict" };
      }
    } else if (await pathExists(targetPath)) {
      return failed("target path already exists");
    }

    const states: CreatedSkillState[] = children.map(child => ({
      directory: resolveSkillSyncPathWithin(logicalPath, posix.relative(incoming.directoryName, child.directoryName)),
      enabled: child.enabled,
    }));
    if (creating) states.push({ directory: logicalPath, enabled: incoming.enabled });
    await prepareSyncWriteParent(targetRoot, logicalPath);
    if (existing) await rename(targetPath, backupPath);
    let published = false;
    try {
      await rename(staged, targetPath);
      published = true;
      await persistCreatedSkillStates(states);
    } catch (error) {
      // 物理子树和它的启用设置是同一提交。失败时撤回新树并恢复覆盖前的原件。
      try {
        if (published) await rename(targetPath, staged);
        if (existing) await rename(backupPath, targetPath);
      } catch (restoreError) {
        params.keepTempRoot();
        logger.error(undefined, "技能导入失败且无法恢复原目录", {
          backupPath, error: errorMessage(restoreError),
        });
        return failed("rollback-incomplete");
      }
      return failed(errorMessage(error));
    }
    return { key: item.key, status: creating ? "created" : "updated" };
  }

  return {
    async listSyncItems() {
      const [skills, overrides] = await Promise.all([
        resolveUserSkills(),
        readSkillEnabledOverrides(),
      ]);
      const all = [...skills.values()];
      return {
        items: await Promise.all(
          all.map((skill) => listItem(skill, overrides, findParentSkill(skill, all)?.key)),
        ),
        homeDir: resolveUserHomeDir(),
      };
    },

    async getSyncContentHashes(params) {
      const skills = await resolveUserSkills();
      const hashes: Record<string, string> = {};
      await Promise.all(
        params.keys.map(async (key) => {
          const skill = skills.get(key);
          const hash = skill ? await hashSkill(skill, params.includeExecutableBits) : undefined;
          if (hash) hashes[key] = hash;
        }),
      );
      return { hashes };
    },

    async checkSyncWriteAccess() {
      const root = getUserZcodeSkillRoot();
      try { await prepareSyncWriteParent(root, join(root, ".sync-preflight")); }
      catch (error) { return { ok: false, path: root, error: errorMessage(error) }; }
      return await checkRemoteSyncDirectoriesWriteAccess([
        getUserZcodeSkillRoot(),
        dirname(getCliConfigPath()),
      ]);
    },

    async exportSyncItems(params) {
      const [skills, overrides] = await Promise.all([
        resolveUserSkills(),
        readSkillEnabledOverrides(),
      ]);
      const selected = params.keys.map((key) => {
        const skill = skills.get(key);
        if (!skill) throw new Error(`skill sync item not found: ${key}`);
        return skill;
      });
      // 修复（F2）：父子技能同时选中时，子目录原来会再单独打包一次，归档里重复一份子技能的字节。
      // 子技能的文件已在上级目录里，现在只打包最上层的选中目录；payload items 仍列出全部选中项。
      const packed = selected.filter(
        (skill) =>
          !selected.some(
            (other) => other !== skill && isPathWithin(other.directoryPath, skill.directoryPath),
          ),
      );
      // OW-P041：物理上独立的两个来源根可能投影到同一归档子树，展开后会改变父技能的哈希。
      const nativeRoots = packed.filter(skill => skill.location === "zcode");
      const overlaps = (left: string, right: string) =>
        left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
      const relocated = packed.filter(skill => skill.location === "agents" &&
        nativeRoots.some(other => overlaps(other.directoryName.toLowerCase(), skill.directoryName.toLowerCase())));
      const reserved = new Set(selected.map(skill => skill.directoryName.split("/")[0]!.toLowerCase()));
      let prefix = "agents";
      for (let n = 2; reserved.has(prefix); n++) prefix = "agents-" + n;
      const archivePath = (skill: ResolvedUserSkill) =>
        relocated.some(root => root === skill || isPathWithin(root.directoryPath, skill.directoryPath))
          ? posix.join(prefix, skill.directoryName) : skill.directoryName;
      const entries = await Promise.all(
        packed.map(async (skill) => {
          const sourcePath = await realpath(skill.directoryPath);
          const scan = await scanDirectoryContent(sourcePath);
          if (scan.totalBytes > maxItemBytes) {
            throw createSkillSyncSizeLimitError({
              actualBytes: scan.totalBytes,
              maxBytes: maxItemBytes,
              phase: "selected-content",
            });
          }
          return { sourcePath, archivePath: archivePath(skill) };
        }),
      );
      const archive = await createSkillSyncArchive(entries);
      if (archive.byteLength > maxItemBytes) {
        throw createSkillSyncSizeLimitError({
          actualBytes: archive.byteLength,
          maxBytes: maxItemBytes,
          phase: "archive",
        });
      }
      return {
        archive,
        sourceHomeDir: resolveUserHomeDir(),
        items: selected.map((skill) => ({
          key: skill.key,
          name: skill.name,
          directoryName: archivePath(skill),
          enabled: isSkillEnabled(overrides, skill.skillFilePath),
        })),
      };
    },

    async importSyncItems(params) {
      if (params.payload.archive.byteLength > maxItemBytes) {
        throw createSkillSyncSizeLimitError({
          actualBytes: params.payload.archive.byteLength,
          maxBytes: maxItemBytes,
          phase: "archive",
        });
      }
      const targetRoot = getUserZcodeSkillRoot();
      // 临时目录放在技能根内，保证与目标同盘，rename 是原子替换。点目录不会被技能扫描读到。
      const tempRoot = await prepareSyncWriteParent(targetRoot, join(targetRoot, `.sync-tmp-${randomUUID()}`));
      const incomingRoot = join(tempRoot, "incoming");
      let keepTempRoot = false;
      const outcomes = new Map<string, DataSyncImportResultItem>();
      try {
        await extractSkillSyncArchive(params.payload.archive, incomingRoot, {
          maxExtractedBytes: maxItemBytes,
        });
        return await withFileLock(join(dirname(tempRoot), ".sync-import"), async () => {
          const byKey = new Map(params.payload.items.map(item => [item.key, item]));
          const selected = new Map(params.items.map(item => [item.key, item]));
          const descendants = indexSkillDescendants(params.payload.items);
          // OW-P037：并发导入共用锁。只在锁内建立一次目录索引，写前重读本项和受影响的子树。
          const current = await resolveUserSkills();
          const ordered = [...params.items].sort((a, b) =>
            directoryDepth(byKey.get(a.key)?.directoryName) - directoryDepth(byKey.get(b.key)?.directoryName));
          for (const [index, item] of ordered.entries()) {
            if (outcomes.has(item.key)) continue;
            const incoming = byKey.get(item.key);
            if (!incoming) {
              outcomes.set(item.key, { key: item.key, status: "failed", error: "missing skill payload" });
              continue;
            }
            const children = descendants.get(incoming.directoryName) ?? [];
            const existing = current.get(item.key);
            let intendedPath: string | undefined;
            try {
              intendedPath = existing?.directoryPath ?? resolveSkillSyncPathWithin(targetRoot, incoming.directoryName);
              let reason: string | undefined;
              for (const child of children) {
                const choice = selected.get(child.key);
                const local = current.get(child.key);
                if (!choice) {
                  reason = "nested-selection";
                  continue;
                }
                if ((choice.mode === "createOnly" && local) || (choice.mode === "overwrite" && !local)) {
                  outcomes.set(child.key, { key: child.key, status: "conflict" });
                  reason = "nested-target";
                } else if (local) {
                  // 子项已有独立所有者。父目录保留；只有同址的已选子项可以独立检查、覆盖。
                  reason = "nested-target";
                }
              }
              const result = reason
                ? { key: item.key, status: "failed" as const, error: reason }
                : await importOne({
                    item, incoming, existing, children, incomingRoot, targetRoot,
                    backupPath: join(tempRoot, "backup-" + index),
                    keepTempRoot: () => { keepTempRoot = true; },
                  });
              outcomes.set(item.key, result);
              if (result.status === "created" || result.status === "updated") {
                for (const child of children) outcomes.set(child.key, { key: child.key, status: "created" });
                continue;
              }
            } catch (error) {
              outcomes.set(item.key, { key: item.key, status: "failed", error: errorMessage(error) });
            }
            for (const child of children) {
              if (!selected.has(child.key) || outcomes.has(child.key)) continue;
              const local = current.get(child.key);
              const suffix = posix.relative(incoming.directoryName, child.directoryName);
              const sameLocation = intendedPath && local?.directoryPath === join(intendedPath, ...suffix.split("/"));
              if (sameLocation && selected.get(child.key)?.mode === "overwrite") continue;
              outcomes.set(child.key, { key: child.key, status: "failed", error: "nested-target" });
            }
          }
          return { results: params.items.map(item => outcomes.get(item.key)!) };
        });
      } catch (error) {
        if (!outcomes.size) throw error;
        logger.warn(undefined, "技能批次在部分提交后结束", { error: errorMessage(error) });
        const message = errorMessage(error);
        return {
          results: params.items.map(({ key }) => outcomes.get(key) ?? { key, status: "failed", error: message }),
        };
      } finally {
        if (!keepTempRoot) {
          await rm(tempRoot, { recursive: true, force: true }).catch(error => {
            logger.warn(undefined, "技能导入临时目录清理失败", { error: errorMessage(error) });
          });
        }
      }
    },
  };
}

/** 新目录使用来源开关。覆盖项保留目标开关，没有差异时不触碰配置文件。 */
async function persistCreatedSkillStates(states: CreatedSkillState[]): Promise<void> {
  if (!states.length) return;
  const current = await readSkillEnabledOverrides();
  const changes = states.map(state => ({
    key: normalizeSkillConfigPath(join(state.directory, SKILL_FILE_NAME)), enabled: state.enabled,
  })).filter(({ key, enabled }) => isSkillEnabled(current, key) !== enabled);
  if (!changes.length) return;
  await updateJsonObjectFile(getCliConfigPath(), config => {
    const skills = config.skills && typeof config.skills === "object" && !Array.isArray(config.skills)
      ? { ...(config.skills as Record<string, unknown>) } : {};
    for (const { key, enabled } of changes) {
      if (enabled) delete skills[key];
      else skills[key] = { enable: false };
    }
    const next = { ...config };
    if (Object.keys(skills).length) next.skills = skills;
    else delete next.skills;
    return next;
  });
}
