import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, win32 } from "node:path";
import type {
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  McpScope,
  McpServerConfig,
  McpSyncSource,
  NativeMcpServerRecord,
  SaveCliMcpToUserDirectoryRequest,
  SettingsDirectoryLocation,
  SettingsDirectorySource,
} from "@zcode/shared";
import { OPENZWORK_DATA_DIR_NAME } from "@zcode/shared";
import { isUserHomeDirectory } from "@zcode/shared/node";
import { withAtomicFileLock } from "../fs/atomicFileUtils.js";
import type { IMcpSyncService } from "./mcpSync.js";
import { createMcpDataSyncMethods } from "../data-sync/node.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("mcp-sync");

type McpConfigKeyName = "mcp.servers" | "mcpServers";

interface DirectoryMcpDescriptor {
  source: McpSyncSource;
  directorySource: SettingsDirectorySource;
  userConfigDirSegments: string[];
  workspaceConfigDirSegments: string[];
  fileName: string;
  configKeyName: McpConfigKeyName;
}

export interface UserMcpRecord {
  name: string;
  config: McpServerConfig;
  enabled: boolean;
  source: McpSyncSource;
  path: string;
}

const ZCODE_MCP_DESCRIPTOR: DirectoryMcpDescriptor = {
  source: "zcode",
  directorySource: "zcode",
  userConfigDirSegments: [OPENZWORK_DATA_DIR_NAME, "cli"],
  workspaceConfigDirSegments: [".zcode"],
  fileName: "config.json",
  configKeyName: "mcp.servers",
};

const LEGACY_FORK_MCP_DESCRIPTOR: DirectoryMcpDescriptor = {
  ...ZCODE_MCP_DESCRIPTOR,
  workspaceConfigDirSegments: [OPENZWORK_DATA_DIR_NAME],
};
const PROJECT_FILE_MCP_DESCRIPTOR: DirectoryMcpDescriptor = {
  ...ZCODE_MCP_DESCRIPTOR,
  workspaceConfigDirSegments: [],
  fileName: "zcode.json",
};
const PROJECT_MCP_DESCRIPTORS = [
  PROJECT_FILE_MCP_DESCRIPTOR,
  ZCODE_MCP_DESCRIPTOR,
  LEGACY_FORK_MCP_DESCRIPTOR,
] as const;

const AGENTS_MCP_DESCRIPTOR: DirectoryMcpDescriptor = {
  source: "agents",
  directorySource: "agents",
  userConfigDirSegments: [".agents"],
  workspaceConfigDirSegments: [".agents"],
  fileName: "mcp.json",
  configKeyName: "mcpServers",
};

const ENABLED_KEY = "enabled";
// 历史遗留：桌面端早期把停用状态写成 enable，而 CLI 契约字段（contracts McpServerConfigBase）
// 一直是 enabled，导致同一条 server 出现两套口径、停用后仍被 agent 拉起。
// 现在读写逻辑一律只认 enabled，这里只保留一次性迁移；存量配置清空后整块删除。
const LEGACY_ENABLE_KEY = "enable";
const SECRET_CONFIG_FILE_MODE = 0o600;
const DIRECTORY_MCP_DESCRIPTORS: readonly DirectoryMcpDescriptor[] = [
  ZCODE_MCP_DESCRIPTOR,
  LEGACY_FORK_MCP_DESCRIPTOR,
  PROJECT_FILE_MCP_DESCRIPTOR,
  AGENTS_MCP_DESCRIPTOR,
];

export interface McpSyncServiceDependencies {
  setWorkspaceMcpTrust?: IMcpSyncService["setWorkspaceMcpTrust"];
  /**
   * MCP server 运行态状态检查的执行面。真实 connect/listTools 必须发生在
   * agent 进程（workspace 的 PATH/cwd 环境），host 侧没有可替代实现；无该依赖的
   * 构造（纯目录同步用途/单测）调用 listWorkspaceMcpServerStatuses 会显式抛错。
   */
  listMcpServerStatuses?: IMcpSyncService["listWorkspaceMcpServerStatuses"];
}

export function createMcpSyncService(
  dependencies: McpSyncServiceDependencies = {},
): IMcpSyncService {
  return {
    ...createMcpDataSyncMethods(),
    async loadMcpFromUserDirectory(request) {
      return loadMcpFromUserDirectory(request);
    },
    async listWorkspaceMcpServerStatuses(params) {
      if (!dependencies.listMcpServerStatuses) {
        throw new Error("MCP server status listing is unavailable in this runtime");
      }
      return dependencies.listMcpServerStatuses(params);
    },
    async setWorkspaceMcpTrust(params) {
      if (!dependencies.setWorkspaceMcpTrust) throw new Error("workspace_mcp_trust_unavailable");
      return dependencies.setWorkspaceMcpTrust(params);
    },
    async saveMcpToUserDirectory(payload) {
      await saveMcpToUserDirectory(payload);
    },
    // OpenZWork 净化说明：我方旧的 listLocalUserMcpCandidates/exportMcpServers/importMcpServers
    // 等候选枚举面已被上游 data-sync 域（createMcpDataSyncMethods + shared McpDataSyncPayload）
    // 取代，合同（mcpSync.ts）与 shared 类型已随上游收口，此处不保留旧方法。
  };
}

// data-sync 域保留：上游把 home 目录解析导出，供 mcpDataSync 等同步逻辑复用。
export function resolveUserHomeDir(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}

function buildDirectoryConfigPath(
  descriptor: DirectoryMcpDescriptor,
  scope: Exclude<McpScope, "common">,
  workspacePath?: string,
): string {
  const baseDir = scope === "user" ? resolveUserHomeDir() : workspacePath;
  if (!baseDir) {
    throw new Error(
      `Missing workspace path for ${descriptor.directorySource} workspace MCP config`,
    );
  }
  const segments =
    scope === "user" ? descriptor.userConfigDirSegments : descriptor.workspaceConfigDirSegments;
  return join(baseDir, ...segments, descriptor.fileName);
}

function buildUserConfigPath(descriptor: DirectoryMcpDescriptor): string {
  return buildDirectoryConfigPath(descriptor, "user");
}

export function getUserZcodeMcpConfigPath(): string {
  return buildUserConfigPath(ZCODE_MCP_DESCRIPTOR);
}

function buildDirectoryMcpLocation(
  descriptor: DirectoryMcpDescriptor,
  scope: Exclude<McpScope, "common">,
  workspacePath?: string,
): SettingsDirectoryLocation {
  const filePath = buildDirectoryConfigPath(descriptor, scope, workspacePath);
  return {
    source: descriptor.directorySource,
    scope: scope === "workspace" ? "project" : "user",
    directoryPath: dirname(filePath),
    ...(workspacePath ? { projectPath: workspacePath } : {}),
  };
}

function findDescriptorByLocation(location: SettingsDirectoryLocation): DirectoryMcpDescriptor {
  const descriptor = DIRECTORY_MCP_DESCRIPTORS.find(
    (item) =>
      item.directorySource === location.source &&
      dirname(
        buildDirectoryConfigPath(
          item,
          location.scope === "project" ? "workspace" : "user",
          location.projectPath,
        ),
      ) === location.directoryPath,
  );
  if (!descriptor) {
    throw new Error(`Unsupported MCP settings directory source: ${location.source}`);
  }
  return descriptor;
}

export async function collectEffectiveUserMcpRecords(): Promise<UserMcpRecord[]> {
  const zcodeRecords = await readUserMcpRecordsFromFile(ZCODE_MCP_DESCRIPTOR);
  if (zcodeRecords.length > 0) {
    return sortMcpRecords(zcodeRecords);
  }
  return sortMcpRecords(await readUserMcpRecordsFromFile(AGENTS_MCP_DESCRIPTOR));
// OpenZWork：collectEffectiveUserMcpRecordByName 仅被已删除的候选枚举面使用，随上游删除。
}

async function loadMcpFromUserDirectory(
  request?: LoadCliMcpFromUserDirectoryRequest,
): Promise<LoadCliMcpFromUserDirectoryResult> {
  const servers: NativeMcpServerRecord[] = [];
  if (request?.workspacePath) {
    servers.push(
      ...(await readDirectoryServersFromPreferredSources("workspace", request.workspacePath)),
    );
  }
  servers.push(...(await readDirectoryServersFromPreferredSources("user", request?.workspacePath)));
  return { servers };
}

async function saveMcpToUserDirectory(payload: SaveCliMcpToUserDirectoryRequest): Promise<void> {
// OpenZWork：保留我方 saveMcpToUserDirectory 实现（location 解析 + 原子锁 + 全 action 单路径），
// 上游拆分的 writeServerEnabledToFile/writeZCodeServersToFile 不引入（其 data-sync 用途由
// readZcodeServerMap/writeZcodeServerMap 导出满足）。
  const scope = payload.projectPath ? "workspace" : "user";
  if (
    payload.projectPath &&
    (await isUserHomeDirectory(payload.projectPath, resolveUserHomeDir()))
  ) {
    throw new Error("User home cannot be used as a project MCP directory");
  }
  const effective = payload.location
    ? undefined
    : (await readDirectoryServersFromPreferredSources(scope, payload.projectPath)).find(
        (server) => server.name === payload.name,
      );
  const location =
    payload.location ??
    effective?.location ??
    buildDirectoryMcpLocation(ZCODE_MCP_DESCRIPTOR, scope, payload.projectPath);
  if (
    location.scope !== (scope === "workspace" ? "project" : "user") ||
    (scope === "workspace" && location.projectPath !== payload.projectPath)
  ) {
    throw new Error("MCP location does not match the requested scope");
  }
  const descriptor = findDescriptorByLocation(location);
  const filePath = buildDirectoryConfigPath(descriptor, scope, payload.projectPath);
  await mkdir(dirname(filePath), { recursive: true });
  // 修复原因：旧入口忽略 location，把旧 fork 或 .agents 的编辑写进另一文件。
  // 在来源文件锁内重读并只改目标条目，保留其他字段与并发写入。
  await withAtomicFileLock(filePath, async () => {
    const current = (await readJsonObject(filePath)) ?? {};
    const servers = {
      ...migrateLegacyEnableFlag(readServerMapFromJson(current, descriptor.configKeyName)).servers,
    };
    const previous = servers[payload.name];
    if (payload.action === "set-enabled") {
      if (typeof payload.enabled !== "boolean")
        throw new Error("Missing enabled value for MCP set-enabled action");
      if (!previous) return;
      servers[payload.name] = setServerEnabled(previous as McpServerConfig, payload.enabled);
    } else if (payload.action === "upsert") {
      if (!payload.config) throw new Error("Missing MCP config for upsert action");
      servers[payload.name] = {
        ...payload.config,
        ...(previous?.enabled === false && payload.config.enabled === undefined
          ? { enabled: false }
          : {}),
      };
    } else {
      if (!previous) return;
      delete servers[payload.name];
    }
    const next = writeServerMapToJson(current, descriptor.configKeyName, servers);
    await writeTextAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  });
  if (payload.action === "set-enabled")
    await cleanupLegacyMcpEnabledOverride(location, payload.name);
}

function sortMcpRecords(records: UserMcpRecord[]): UserMcpRecord[] {
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

async function readDirectoryServersFromPreferredSources(
  scope: Exclude<McpScope, "common">,
  workspacePath?: string,
): Promise<NativeMcpServerRecord[]> {
  if (
    scope === "workspace" &&
    workspacePath &&
    (await isUserHomeDirectory(workspacePath, resolveUserHomeDir()))
  )
    return [];
  const descriptors = scope === "workspace" ? PROJECT_MCP_DESCRIPTORS : [ZCODE_MCP_DESCRIPTOR];
  const byName = new Map<string, NativeMcpServerRecord>();
  for (const descriptor of descriptors) {
    for (const server of await readDirectoryServersFromFile(descriptor, scope, workspacePath)) {
      // 同名以整条 server 替换，不混合不同来源的进程参数、环境或连接凭据。
      byName.set(server.name, server);
    }
  }
  const zcodeServers = [...byName.values()];
  if (zcodeServers.length > 0) {
    return zcodeServers;
  }
  return readDirectoryServersFromFile(AGENTS_MCP_DESCRIPTOR, scope, workspacePath);
}

async function readDirectoryServersFromFile(
  descriptor: DirectoryMcpDescriptor,
  scope: Exclude<McpScope, "common">,
  workspacePath?: string,
): Promise<NativeMcpServerRecord[]> {
  const filePath = buildDirectoryConfigPath(descriptor, scope, workspacePath);
  const parsed = await readJsonObject(filePath);
  if (!parsed) {
    return [];
  }
  const serverMap = await readServerMapWithLegacyMigration(
    filePath,
    parsed,
    descriptor.configKeyName,
  );
  const location = buildDirectoryMcpLocation(descriptor, scope, workspacePath);
  return Object.entries(serverMap).map(([name, config]) => ({
    source: "zcodeagentmcp",
    scope,
    name,
    config: config as McpServerConfig,
    enabled: readServerEnabled(config),
    projectPath: scope === "workspace" ? workspacePath : undefined,
    location,
    file: {
      format: "json",
      filePath,
    },
  }));
}

// OpenZWork：上游 writeZCodeServersToFile 仅服务于其拆分版 saveMcpToUserDirectory，不引入。
async function readUserCliConfig(): Promise<Record<string, unknown>> {
  return (await readJsonObject(getUserZcodeMcpConfigPath())) ?? {};
}

async function writeUserCliConfig(config: Record<string, unknown>): Promise<void> {
  await writeTextAtomic(getUserZcodeMcpConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function removeLegacyMcpEnabledOverride(
  config: Record<string, unknown>,
  location: SettingsDirectoryLocation,
  name: string,
): { config: Record<string, unknown>; changed: boolean } {
  if (!isRecord(config.mcp) || !isRecord(config.mcp[location.directoryPath])) {
    return { config, changed: false };
  }

  const mcpConfig = { ...config.mcp };
  const pathConfig = {
    ...(mcpConfig[location.directoryPath] as Record<string, unknown>),
  };
  if (!(name in pathConfig)) {
    return { config, changed: false };
  }

  delete pathConfig[name];
  if (Object.keys(pathConfig).length > 0) {
    mcpConfig[location.directoryPath] = pathConfig;
  } else {
    delete mcpConfig[location.directoryPath];
  }

  return {
    config: {
      ...config,
      mcp: mcpConfig,
    },
    changed: true,
  };
}

async function cleanupLegacyMcpEnabledOverride(
  location: SettingsDirectoryLocation,
  name: string,
): Promise<void> {
  const userConfig = await readUserCliConfig();
  const result = removeLegacyMcpEnabledOverride(userConfig, location, name);
  if (result.changed) {
    await writeUserCliConfig(result.config);
  }
}

// OpenZWork：上游 writeServerEnabledToFile 仅服务于其拆分版 saveMcpToUserDirectory，不引入。
async function readUserMcpRecordsFromFile(
  descriptor: DirectoryMcpDescriptor,
): Promise<UserMcpRecord[]> {
  const filePath = buildUserConfigPath(descriptor);
  const parsed = await readJsonObject(filePath);
  if (!parsed) {
    return [];
  }
  const serverMap = await readServerMapWithLegacyMigration(
    filePath,
    parsed,
    descriptor.configKeyName,
  );
  return Object.entries(serverMap).map(([name, config]) => ({
    name,
    config: config as McpServerConfig,
    enabled: readServerEnabled(config),
    source: descriptor.source,
    path: filePath,
  }));
}

export function normalizeMcpNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function readServerEnabled(config: Record<string, unknown>): boolean {
  return config[ENABLED_KEY] !== false;
}

// data-sync 域保留：mcpDataSync 复用启用态写法，导出（上游行为）。
export function setServerEnabled(config: McpServerConfig, enabled: boolean): McpServerConfig {
  // 启用是默认态，不落盘冗余字段；同时清掉可能残留的 legacy enable，
  // 避免再产出 enable:false + enabled:true 这类自相矛盾的配置。
  const { [LEGACY_ENABLE_KEY]: _legacyEnable, [ENABLED_KEY]: _enabled, ...rest } = config;
  if (enabled) {
    return rest;
  }
  return { ...rest, [ENABLED_KEY]: false };
}

function migrateLegacyEnableFlag(serverMap: Record<string, Record<string, unknown>>): {
  servers: Record<string, Record<string, unknown>>;
  changed: boolean;
} {
  let changed = false;
  const migrated: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(serverMap)) {
    if (!isRecord(config) || !(LEGACY_ENABLE_KEY in config)) {
      migrated[name] = config;
      continue;
    }
    changed = true;
    // 两个字段冲突时以「停用」为准：桌面端写 enable:false 时不会清理外部导入残留的
    // enabled:true，若按 enabled 取值会把用户关掉的 server 重新拉起。
    const disabled = config[LEGACY_ENABLE_KEY] === false || config[ENABLED_KEY] === false;
    migrated[name] = setServerEnabled(config as McpServerConfig, !disabled) as Record<
      string,
      unknown
    >;
  }

  return { servers: migrated, changed };
}

/**
 * 读取 server map，顺带把存量 enable 就地折叠成 enabled 并落盘。
 * 没有残留字段时不写文件，保证幂等；写盘失败不阻断读取，内存结果已是正确口径，下次加载会重试。
 */
async function readServerMapWithLegacyMigration(
  filePath: string,
  parsed: Record<string, unknown>,
  configKeyName: McpConfigKeyName,
): Promise<Record<string, Record<string, unknown>>> {
  const migration = migrateLegacyEnableFlag(readServerMapFromJson(parsed, configKeyName));
  if (!migration.changed) {
    return migration.servers;
  }

  try {
    const next = writeServerMapToJson(parsed, configKeyName, migration.servers);
    await writeTextAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    // 采用上游 serviceLogger 输出（仓库规则：服务日志不用 console）。
    logger.warn(undefined, "历史 enable 迁移写回失败，继续使用内存结果", {
      filePath,
      error: formatErrorMessage(error),
    });
  }
  return migration.servers;
}

function readServerMapFromJson(
  parsed: Record<string, unknown>,
  configKeyName: McpConfigKeyName,
): Record<string, Record<string, unknown>> {
  if (configKeyName === "mcp.servers") {
    const mcp = parsed.mcp;
    if (!isRecord(mcp)) {
      return {};
    }
    const servers = mcp.servers;
    return isRecord(servers) ? (servers as Record<string, Record<string, unknown>>) : {};
  }

  const rawServerMap = parsed[configKeyName];
  return isRecord(rawServerMap) ? (rawServerMap as Record<string, Record<string, unknown>>) : {};
}

function writeServerMapToJson(
  current: Record<string, unknown>,
  configKeyName: McpConfigKeyName,
  servers: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  if (configKeyName !== "mcp.servers") {
    return {
      ...current,
      [configKeyName]: servers,
    };
  }

  const currentMcp = isRecord(current.mcp) ? current.mcp : {};
  return {
    ...current,
    mcp: {
      ...currentMcp,
      servers,
    },
  };
}

// OpenZWork：我方旧 importMcpServers（候选枚举面）随合同收口删除；
// 保留上游 readZcodeServerMap 导出（data-sync 域在写前重读使用）。
/** 读取 `config.json` 的 `mcp.servers`（已折叠历史 enable 字段），供数据同步在写前重读后使用。 */
export function readZcodeServerMap(
  config: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  return migrateLegacyEnableFlag(readServerMapFromJson(config, ZCODE_MCP_DESCRIPTOR.configKeyName))
    .servers;
}

export function writeZcodeServerMap(
  config: Record<string, unknown>,
  servers: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return writeServerMapToJson(config, ZCODE_MCP_DESCRIPTOR.configKeyName, servers);
}

export interface McpPathRewrite {
  sourceHomeDir: string;
  sourceWorkspacePath?: string;
  targetHomeDir: string;
  targetWorkspacePath?: string;
}

/** 只改写 filesystem 类 stdio MCP 的 `args`；其他 MCP 的 args、env、cwd 原样保留。 */
export function rewriteFilesystemMcpConfig(
  name: string,
  config: McpServerConfig,
  paths: McpPathRewrite,
): McpServerConfig {
  if (!isStdioMcpConfig(config) || !isFilesystemMcpServer(name, config)) {
    return config;
  }
  if (!Array.isArray(config.args)) {
    return config;
  }
  return {
    ...config,
    args: config.args.map((arg) => rewritePathArgForRemote(arg, paths)),
  };
}

function isStdioMcpConfig(config: McpServerConfig): boolean {
  const type = typeof config.type === "string" ? config.type.trim().toLowerCase() : "";
  if (!type && typeof config.command === "string" && config.command.trim()) {
    return true;
  }
  return type === "stdio";
}

function isFilesystemMcpServer(name: string, config: McpServerConfig): boolean {
  const normalizedName = name.trim().toLowerCase();
  if (
    normalizedName === "filesystem" ||
    normalizedName === "file-system" ||
    normalizedName === "fs"
  ) {
    return true;
  }
  const haystack = [config.command, ...(Array.isArray(config.args) ? config.args : [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes("@modelcontextprotocol/server-filesystem") ||
    haystack.includes("mcp-server-filesystem")
  );
}

// 采用上游 McpPathRewrite 签名（source/target 命名与导出类型一致）。
function rewritePathArgForRemote(arg: string, paths: McpPathRewrite): string {
  const workspaceRelative = getRelativePathIfWithin(paths.sourceWorkspacePath, arg);
  if (workspaceRelative !== null && paths.targetWorkspacePath?.trim()) {
    return joinRemotePath(paths.targetWorkspacePath, workspaceRelative);
  }

  const homeRelative = getRelativePathIfWithin(paths.sourceHomeDir, arg);
  if (homeRelative !== null) {
    return joinRemotePath(paths.targetHomeDir, homeRelative);
  }

  return arg;
}

function getRelativePathIfWithin(
  basePath: string | undefined,
  candidatePath: string,
): string | null {
  if (!basePath?.trim()) {
    return null;
  }
  const base = normalizeComparablePath(basePath);
  const candidate = normalizeComparablePath(candidatePath);
  if (!base || !candidate) {
    return null;
  }
  const baseValue = base.caseInsensitive ? base.value.toLowerCase() : base.value;
  const candidateValue = base.caseInsensitive ? candidate.value.toLowerCase() : candidate.value;
  if (candidateValue === baseValue) {
    return "";
  }
  const prefix = baseValue.endsWith("/") ? baseValue : `${baseValue}/`;
  if (!candidateValue.startsWith(prefix)) {
    return null;
  }
  return candidate.value.slice(prefix.length);
}

function normalizeComparablePath(
  rawPath: string,
): { value: string; caseInsensitive: boolean } | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  const isWindowsPath = /^[a-zA-Z]:[\\/]/u.test(trimmed) || trimmed.startsWith("\\\\");
  const isPosixPath = trimmed.startsWith("/");
  if (!isWindowsPath && !isPosixPath) {
    return null;
  }

  let value = trimmed.replaceAll("\\", "/");
  value = value.replace(/\/+$/u, "");
  if (value === "") {
    value = "/";
  }
  return {
    value,
    caseInsensitive: isWindowsPath,
  };
}

function joinRemotePath(remoteBasePath: string, relativePath: string): string {
  if (!relativePath) {
    return remoteBasePath;
  }
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
  // MCP 同步运行在本机进程里，但 remoteWorkspacePath 描述的是远端主机路径。
  // 不能用 process.platform 决定拼接风格，否则 Windows 客户端同步到 Linux/WSL 时会把 /srv/... 写成 \srv\...。
  const normalizedBasePath = remoteBasePath.trim();
  if (normalizedBasePath.startsWith("/")) {
    return posix.join(normalizedBasePath.replaceAll("\\", "/"), ...segments);
  }
  if (/^[a-zA-Z]:[\\/]/u.test(normalizedBasePath) || normalizedBasePath.startsWith("\\\\")) {
    return win32.join(normalizedBasePath, ...segments);
  }
  return posix.join(normalizedBasePath.replaceAll("\\", "/"), ...segments);
}

export function cloneMcpConfig(config: McpServerConfig): McpServerConfig {
  return JSON.parse(JSON.stringify(config)) as McpServerConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw new Error(`无法读取 MCP 配置文件 ${filePath}: ${formatErrorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    // 远端 MCP 导入必须先确认现有 config.json 可读可合并；
    // JSON 损坏时如果当作空对象继续写，会静默覆盖 provider、MCP 和 secret 配置。
    // 保留我方 SyntaxError + cause：保留底层解析异常链，便于区分配置损坏与 IO 错误。
    throw new SyntaxError(`无法解析 MCP 配置文件 ${filePath}: ${formatErrorMessage(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new Error(`MCP 配置文件 ${filePath} 必须是 JSON 对象`);
  }
  return parsed;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(
    dirname(filePath),
    `${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    // 远端 MCP 配置会持久化 env/header/token 等 secret；
    // 临时文件权限不能依赖远端 umask，否则 rename 后 config.json 可能被同组或其他用户读取。
    await writeFile(tempPath, content, {
      encoding: "utf-8",
      mode: SECRET_CONFIG_FILE_MODE,
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
