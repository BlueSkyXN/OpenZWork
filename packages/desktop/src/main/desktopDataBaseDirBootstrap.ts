import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setDataBaseDir } from "@zcode/services/node";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";
import {
  ZCODE_CREDENTIALS_FILE_ENV,
  createSystemCredentialCipher,
  type CredentialKeyStore,
} from "@zcode/shared/credential-security";

export function resolveBootstrapSettingsFile(homePath: string = homedir()): string {
  return join(homePath, OPENZWORK_DATA_DIR_NAME, "v2", "setting.json");
}

export function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  // Bug 原因（评审 CR-01）：ZCODE_CREDENTIALS_FILE 是 Source Server Core 的进程装配，凭据路径解析
  // 会优先采用它。Desktop 从设置了该变量的 shell / launchctl 环境启动时，Main cipher、Host 凭据服务
  // 与 Agent 会整体改用外部指定的凭据库（例如 Server 自有库）。Desktop 不是该变量的合法来源，
  // 在任何凭据读写方创建、Host fork 之前删除一次，Main、Host 与 Agent 都只用 Desktop 数据根。
  delete process.env[ZCODE_CREDENTIALS_FILE_ENV];
  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}

/** 启动门禁凭据密钥共享的合成注入面：仅测试/复现使用，生产调用全部省略（真实系统密钥库）。 */
export interface CopiedDataRootCredentialKeyStores {
  sourceKeyStore?: CredentialKeyStore;
  targetKeyStore?: CredentialKeyStore;
}

/**
 * 启动门禁数据根迁移的凭据密钥共享装配（Main 专用；Main 独占系统密钥）。
 * 返回值直接作为 applyPendingDataBaseDirMigration 的 shareCredentialKeyWithDataRoot 注入。
 *
 * Bug 原因（独立复核 F1，2026-11-15）：此前装配把 cipher 绑定到目标凭据路径、又向同一路径
 * share，systemCredentialCipher 的同路径短路让共享直接成功返回，目标密钥条目一次都没写——
 * 源为系统密钥的正常迁移会在复制后留下解不开的密文（CREDENTIAL_SECURE_STORAGE_UNAVAILABLE）。
 * 上游运行时通道（desktopHostProcess）之所以能按「当前根」绑定，是因为上游在运行时切换、
 * Main 的当前根就是源；我方复制在启动门禁执行，此时 early bootstrap 已把运行时根指向目标，
 * 源只能来自迁移计划，不能从运行时根推导。修复：cipher 按计划的源凭据路径持有（密钥条目
 * 与运行时 Host fork 的登记规则一致），向目标凭据路径登记；共享失败抛错中止提交，目标已有
 * 不同密钥时由 cipher 合同拒绝覆盖。同路径短路保留（重叠根已在 copyDataDirectory 拒绝）。
 */
export function shareCopiedDataRootCredentialKey(
  plan: { sourceBaseDir: string; targetBaseDir: string },
  stores: CopiedDataRootCredentialKeyStores = {},
): Promise<void> {
  const credentialsPath = (baseDir: string) =>
    join(baseDir, OPENZWORK_DATA_DIR_NAME, "v2", "credentials.json");
  const sourceKeyStore = stores.sourceKeyStore;
  return createSystemCredentialCipher({
    filePath: credentialsPath(plan.sourceBaseDir),
    ...(sourceKeyStore ? { keyStore: sourceKeyStore } : {}),
  }).shareKeyWithCopiedCredentials(credentialsPath(plan.targetBaseDir), stores.targetKeyStore);
}
