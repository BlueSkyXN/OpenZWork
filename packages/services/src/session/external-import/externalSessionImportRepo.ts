import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, posix, resolve, win32 } from "node:path";
import type { ZCodeImportableSessionCandidate } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { getAppConfigDir, getDataBaseDir, getWorkspaceHash } from "#src/paths.js";
import {
  extractCodexRolloutSessionId,
  parseCodexRolloutSessionHeadInfo,
  readCodexRolloutHeadRecords,
} from "#src/session/external-import/codexRolloutParser.js";
import {
  parseQoderSessionHeadInfo,
  readQoderSessionHeadRecords,
} from "#src/session/external-import/qoderSessionParser.js";

const logger = createServiceLogger("external-import");

function normalizePathForComparison(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function collectHomeRoots(): string[] {
  const homes = new Set<string>();
  homes.add(homedir());
  const envHome = process.env.HOME?.trim();
  if (envHome) {
    homes.add(envHome);
  }
  const dataBaseDir = getDataBaseDir();
  if (dataBaseDir) {
    homes.add(dataBaseDir);
  }
  return [...homes];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const CODEX_IGNORED_DIR_NAMES = new Set(["archived"]);

async function collectCodexRolloutFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  // ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl；archived 是 Codex 自己的归档分支，不作为活跃候选。
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (CODEX_IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) {
          continue;
        }
        await walk(entryPath, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  };
  await walk(rootDir, 0);
  return files;
}

const QODER_PROJECT_DIR_CANDIDATES = [".qoder", ".qoder-cn"] as const;

async function collectQoderSessionFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = join(rootDir, entry.name);
    let sessionEntries;
    try {
      sessionEntries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (
        sessionEntry.isFile() &&
        sessionEntry.name.endsWith(".jsonl") &&
        !sessionEntry.name.startsWith(".")
      ) {
        files.push(join(projectDir, sessionEntry.name));
      }
    }
  }
  return files;
}

async function buildCodexCandidate(
  filePath: string,
  updatedAt: number,
): Promise<ZCodeImportableSessionCandidate | null> {
  const sessionId = extractCodexRolloutSessionId(basename(filePath));
  if (!sessionId) {
    return null;
  }
  const headRecords = await readCodexRolloutHeadRecords(filePath);
  const headInfo = parseCodexRolloutSessionHeadInfo(headRecords);
  if (!headInfo.workspacePath) {
    return null;
  }
  return {
    provider: "codex",
    sessionId,
    workspacePath: headInfo.workspacePath,
    sourcePath: filePath,
    updatedAt,
    ...(headInfo.createdAt ? { createdAt: headInfo.createdAt } : {}),
    ...(headInfo.previewTitle ? { previewTitle: headInfo.previewTitle } : {}),
  };
}

async function buildQoderCandidate(
  filePath: string,
  updatedAt: number,
): Promise<ZCodeImportableSessionCandidate | null> {
  const sessionId = basename(filePath, ".jsonl");
  const headRecords = await readQoderSessionHeadRecords(filePath);
  const headInfo = parseQoderSessionHeadInfo(headRecords);
  if (!headInfo.workspacePath) {
    return null;
  }
  return {
    provider: "qoder",
    sessionId,
    workspacePath: headInfo.workspacePath,
    sourcePath: filePath,
    updatedAt,
    ...(headInfo.createdAt ? { createdAt: headInfo.createdAt } : {}),
    ...(headInfo.previewTitle ? { previewTitle: headInfo.previewTitle } : {}),
  };
}

export class ExternalSessionImportRepo {
  async scanImportableSessions(params: {
    provider: "codex" | "qoder";
    workspacePath?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<ZCodeImportableSessionCandidate[]> {
    const workspaceKey = params.workspacePath
      ? normalizePathForComparison(params.workspacePath)
      : null;

    const sourceFiles: string[] = [];
    if (params.provider === "codex") {
      for (const home of collectHomeRoots()) {
        sourceFiles.push(...(await collectCodexRolloutFiles(join(home, ".codex", "sessions"))));
      }
    } else {
      for (const home of collectHomeRoots()) {
        for (const dirName of QODER_PROJECT_DIR_CANDIDATES) {
          sourceFiles.push(...(await collectQoderSessionFiles(join(home, dirName, "projects"))));
        }
      }
    }

    const candidates: ZCodeImportableSessionCandidate[] = [];
    const seenSourcePaths = new Set<string>();
    for (const filePath of sourceFiles) {
      if (seenSourcePaths.has(filePath)) {
        continue;
      }
      seenSourcePaths.add(filePath);

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      const updatedAt = Math.trunc(fileStat.mtimeMs);
      if (params.modifiedSince && updatedAt < params.modifiedSince) {
        continue;
      }

      try {
        const candidate =
          params.provider === "codex"
            ? await buildCodexCandidate(filePath, updatedAt)
            : await buildQoderCandidate(filePath, updatedAt);
        if (!candidate) {
          continue;
        }
        if (
          workspaceKey !== null &&
          normalizePathForComparison(candidate.workspacePath) !== workspaceKey
        ) {
          continue;
        }
        candidates.push(candidate);
      } catch (error) {
        logger.warn(
          undefined,
          `扫描外部 session 失败 provider=${params.provider} path=${filePath}`,
          error,
        );
      }
    }

    candidates.sort((left, right) => right.updatedAt - left.updatedAt);
    const limited =
      typeof params.limit === "number" && params.limit > 0
        ? candidates.slice(0, params.limit)
        : candidates;

    logger.info(
      undefined,
      `外部 session 扫描完成 provider=${params.provider} workspaceFilter=${params.workspacePath ?? "all"} fileCount=${sourceFiles.length} candidateCount=${limited.length}`,
    );
    return limited;
  }

  async findImportableSession(params: {
    provider: "codex" | "qoder";
    sessionId: string;
    workspacePath?: string;
  }): Promise<ZCodeImportableSessionCandidate | null> {
    const scanned = await this.scanImportableSessions({
      provider: params.provider,
      workspacePath: params.workspacePath,
    });
    return (
      scanned.find(
        (candidate) =>
          candidate.sessionId === params.sessionId &&
          (!params.workspacePath ||
            normalizePathForComparison(candidate.workspacePath) ===
              normalizePathForComparison(params.workspacePath)),
      ) ?? null
    );
  }

  async copySessionFileToWorkspace(params: {
    provider: "codex" | "qoder";
    workspacePath: string;
    workspaceIdentity?: string;
    sourcePath: string;
  }): Promise<{ outputPath: string; createdOutputPaths: string[] }> {
    // 备份目录沿用 claude 导入的 agent-config 布局：agent-config/<provider>/{workspaceHash}/...
    const relativeSource = relativeSourcePathForProvider(params.provider, params.sourcePath);
    const outputDir = join(
      getAppConfigDir(),
      "agent-config",
      params.provider,
      getWorkspaceHash(params.workspacePath, params.workspaceIdentity),
      params.provider === "codex" ? "sessions" : "projects",
      dirname(relativeSource),
    );
    const outputPath = join(outputDir, basename(relativeSource));
    const existedBefore = await pathExists(outputPath);
    const tempPath = `${outputPath}.${process.pid}.${Date.now().toString(36)}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;

    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(params.sourcePath, tempPath);
    await rename(tempPath, outputPath);

    return {
      outputPath,
      createdOutputPaths: existedBefore ? [] : [outputPath],
    };
  }
}

export const externalSessionImportRepo = new ExternalSessionImportRepo();

/** rollout/session 相对层级推导（codex=sessions/ 之后，qoder=projects/ 之后）；单独导出供测试断言。 */
export function relativeSourcePathForProvider(
  provider: "codex" | "qoder",
  sourcePath: string,
): string {
  // 扫描返回原生路径；只找正斜杠会拒绝 Windows。按来源路径选语义，保留 POSIX 文件名中的反斜杠。
  const pathApi = /^[a-z]:[\\/]|^\\\\/iu.test(sourcePath) ? win32 : posix;
  const normalizedSource = pathApi.normalize(sourcePath);
  const marker = `${pathApi.sep}${provider === "codex" ? "sessions" : "projects"}${pathApi.sep}`;
  const markerIndex = normalizedSource.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`[external-import] 外部 session 路径非法: ${sourcePath}`);
  }
  const sourceRoot = normalizedSource.slice(0, markerIndex + marker.length - 1);
  return pathApi.relative(sourceRoot, normalizedSource);
}
