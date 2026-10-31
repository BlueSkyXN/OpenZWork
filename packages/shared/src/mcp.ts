/**
 * MCP (Model Context Protocol) types for ZCode
 * Based on the original Tauri implementation
 */

import type { SettingsDirectoryLocation } from "./settings-source.js";
import type { McpServerFailureKind, WorkspaceMcpTrustReview } from "./zcode-protocol/index.js";

// 插件身份 env key：resolver（adapters/src/plugins/mcp.ts）权威写入 loaded.id，manifest/user env 不可覆盖。
export const ZCODE_PLUGIN_ID_ENV_KEY = "ZCODE_PLUGIN_ID";

/** Host 在 spawn 时注入的真实 workspace identity；只用于隔离/审计，不用于文件执行。 */
export const ZCODE_WORKSPACE_IDENTITY_ENV = "ZCODE_WORKSPACE_IDENTITY";

export type McpSource =
  | "mcp"
  | "zcodeagentmcp"
  | "claudeclimcp"
  | "geminiclimcp"
  | "codexclimcp"
  | "opencodemcp";
export type CliMcpSource = Exclude<McpSource, "mcp">;
export type McpScope = "common" | "user" | "workspace";
export type McpFileFormat = "json" | "toml";

// Single MCP server configuration
export interface McpServerConfig {
  type?: string; // Supports stdio, http, sse, streamableHttp, etc.
  url?: string; // HTTP/SSE server URL
  command?: string; // stdio server command
  args?: string[]; // stdio server arguments
  env?: Record<string, string>; // stdio server environment variables
  environment?: Record<string, string>; // 兼容导入配置；执行时统一为 env
  headers?: Record<string, string>; // HTTP/SSE server request headers
  http_headers?: Record<string, string>; // 兼容旧配置字段，历史 BigModel MCP 配置会把鉴权头写在这里
  oauth?: McpOAuthConfig; // HTTP/SSE OAuth 机器凭据配置
  // Linear specific fields
  apiKey?: string;
  projectId?: string;
  issueType?: string;
  // Figma specific fields
  personalAccessToken?: string;
  fileId?: string;
  nodeId?: string;
  // Sentry specific fields
  organizationName?: string;
  projectName?: string;
  dsn?: string;
  // Context7 specific fields
  apiEndpoint?: string;
  [key: string]: any;
}

export type McpServerStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "connecting"
  | "unknown"
  | "untrusted";

export interface CliMcpConfig {
  mcpServers: Record<string, McpServerConfig>;
  projects: Record<string, Record<string, McpServerConfig>>;
}

export interface SaveCliMcpToUserDirectoryRequest {
  action: "upsert" | "delete" | "set-enabled";
  source: CliMcpSource;
  name: string;
  config?: McpServerConfig;
  enabled?: boolean;
  projectPath?: string;
  location?: SettingsDirectoryLocation;
}

export interface NativeMcpFileReference {
  format: McpFileFormat;
  filePath: string;
}

export interface NativeMcpServerRecord {
  source: McpSource;
  scope: McpScope;
  name: string;
  config: McpServerConfig;
  enabled?: boolean;
  projectPath?: string;
  location?: SettingsDirectoryLocation;
  file?: NativeMcpFileReference;
}

export interface LoadCliMcpFromUserDirectoryRequest {
  workspacePath?: string;
}

export interface LoadCliMcpFromUserDirectoryResult {
  servers: NativeMcpServerRecord[];
}

export interface MigrateLegacyCommonMcpRequest {
  legacyStorageDir?: string;
}

export interface MigrateLegacyCommonMcpResult {
  servers: Record<string, McpServerConfig>;
  sourcePath?: string;
  /** 旧数据中发现的 MCP 配置总数 */
  totalCount: number;
  /** 成功导入的数量 */
  importedCount: number;
  /** 因已存在而跳过的数量 */
  skippedCount: number;
}

export interface McpConfig {
  mcp: {
    mcpServers: Record<string, McpServerConfig>;
  };
  zcodeagentmcp: CliMcpConfig;
  claudeclimcp: CliMcpConfig;
  geminiclimcp: CliMcpConfig;
  codexclimcp: CliMcpConfig;
  opencodemcp: CliMcpConfig;
}

export interface ZCodeMcpServer {
  id: string;
  name: string;
  config: McpServerConfig;
  enabled: boolean;
  changed?: boolean;
  status?: McpServerStatus;
  lastConnected?: Date;
  error?: string;
  failureKind?: McpServerFailureKind;
  serverRequestId?: string;
  toolCount?: number;
  workspaceTrust?: WorkspaceMcpTrustReview;
  authorization?: {
    type: "oauth_authorization_code";
    authorizationUrl: string;
    startedAt: string;
  };
  source: McpSource;
  projectPath?: string;
  scope: McpScope;
  location?: SettingsDirectoryLocation;
  file?: NativeMcpFileReference;
}

export interface McpServerListItem {
  id: string;
  name: string;
  enabled: boolean;
  status: McpServerStatus;
  hasConfig: boolean;
  error?: string;
  toolCount?: number;
  source: McpSource;
  projectPath?: string;
  scope: McpScope;
  file?: NativeMcpFileReference;
}

export interface McpTestResult {
  success: boolean;
  error?: string;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: any;
  }>;
  serverInfo?: {
    name: string;
    version: string;
  };
  response_time?: number;
}

export type ZCodeAgentMcpServer = { scope?: "user" | "workspace" } & (
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
      cwd?: string;
      alwaysLoad?: boolean;
      isolation?: "session" | "workspace";
      protocolVersion?: "legacy" | "auto" | "2026-07-28";
      timeoutMs?: number;
    }
  | {
      name: string;
      type: "http" | "sse";
      url: string;
      alwaysLoad?: boolean;
      isolation?: "session" | "workspace";
      protocolVersion?: "legacy" | "auto" | "2026-07-28";
      headers: Array<{ name: string; value: string }>;
      oauth?: McpOAuthConfig;
      timeoutMs?: number;
    }
);

export interface McpClientCredentialsOAuthConfig {
  type: "client_credentials";
  clientId: string;
  clientSecret: string;
  clientName?: string;
  scope?: string;
}

export interface McpAuthorizationCodeOAuthConfig {
  type: "authorization_code";
  clientId?: string;
  clientSecret?: string;
  clientName?: string;
  redirectPath?: string;
  scope?: string;
}

export type McpOAuthConfig = McpAuthorizationCodeOAuthConfig | McpClientCredentialsOAuthConfig;

export function getMcpServerRequestHeaders(
  config: McpServerConfig,
): Record<string, string> | undefined {
  return config.headers ?? config.http_headers;
}

// OpenZWork 净化：上游 zcode-cua MCP 识别助手（isZCodeCuaMcpCommand/isZCodeCuaMcpPackageArg，
// CUA 域）不引入；normalizeMcpStdioCommand（Windows cmd /c 归一化，CLI workspace-mcp-trust
// 消费的中性改进）保留。
/** 审核摘要与 Host DTO 共用 Windows 命令归一化，避免批准 cmd /c 后执行 npx 被误拒绝。 */
export function normalizeMcpStdioCommand(command: string, args: string[] = []) {
  const isWin32 =
    (typeof process !== "undefined" && process.platform === "win32") ||
    (typeof navigator !== "undefined" && /win/i.test(navigator.platform));
  const lowerCmd = command.toLowerCase();
  const unwrappedCommand = args[1];
  if (
    isWin32 &&
    (lowerCmd === "cmd" || lowerCmd === "cmd.exe") &&
    args[0] === "/c" &&
    unwrappedCommand
  ) {
    return { command: unwrappedCommand, args: args.slice(2) };
  }
  return { command, args };
}

export function convertToZCodeAgentMcpServer(
  name: string,
  config: McpServerConfig,
  scope?: "user" | "workspace",
): ZCodeAgentMcpServer | null {
  let inferredType = config.type;
  if (!inferredType) {
    if (config.command) inferredType = "stdio";
    else if (config.url) inferredType = "http";
  }

  const isStdio = inferredType === "stdio";
  if (isStdio && config.command) {
    // Windows 上 agent 通常用 shell: true 启动子进程，
    // "cmd /c npx ..." 会被双重包裹成 "cmd.exe /c cmd /c npx ..." 导致连接失败。
    // 这里把 cmd /c 包衣拆掉，直接使用内部命令。
    const { command, args } = normalizeMcpStdioCommand(config.command, config.args);
    // 文件解析支持 environment；DTO 不能漏掉它，否则审核与实际 env 不同。
    const env = config.env ?? config.environment;
    return {
      name,
      ...(scope ? { scope } : {}),
      command,
      args,
      ...(typeof config.cwd === "string" ? { cwd: config.cwd } : {}),
      env: env
        ? Object.entries(env).map(([key, value]) => ({
            name: key,
            value,
          }))
        : [],
      // 修复原因：DTO 逐字段重建曾丢失 alwaysLoad；仅透传布尔值，保留显式 false。
      ...(typeof config.alwaysLoad === "boolean" ? { alwaysLoad: config.alwaysLoad } : {}),
      // MCP 设置页会把 timeoutMs 写入 config；session/create 走协议 DTO 时
      // 只能透传正整数，否则 strict protocol schema 会把存量非法配置从“忽略”变成“创建失败”。
      ...(isValidMcpTimeoutMs(config.timeoutMs) ? { timeoutMs: config.timeoutMs } : {}),
      ...(isMcpIsolation(config.isolation) ? { isolation: config.isolation } : {}),
      ...(isMcpProtocolVersion(config.protocolVersion)
        ? { protocolVersion: config.protocolVersion }
        : {}),
    };
  } else if (config.url && inferredType) {
    const normalizedType: "http" | "sse" = inferredType === "sse" ? "sse" : "http";
    const headers = getMcpServerRequestHeaders(config);
    return {
      name,
      ...(scope ? { scope } : {}),
      type: normalizedType,
      url: config.url,
      headers: headers
        ? Object.entries(headers).map(([key, value]) => ({
            name: key,
            value,
          }))
        : [],
      ...(isValidMcpOAuthConfig(config.oauth) ? { oauth: config.oauth } : {}),
      // HTTP/SSE 与 stdio 使用相同规则，避免配置在进入 Agent 前丢失。
      ...(typeof config.alwaysLoad === "boolean" ? { alwaysLoad: config.alwaysLoad } : {}),
      // HTTP/SSE MCP 与 stdio 一样需要保留超时配置，避免 UI 保存后真实 session 丢字段。
      ...(isValidMcpTimeoutMs(config.timeoutMs) ? { timeoutMs: config.timeoutMs } : {}),
      ...(isMcpIsolation(config.isolation) ? { isolation: config.isolation } : {}),
      ...(isMcpProtocolVersion(config.protocolVersion)
        ? { protocolVersion: config.protocolVersion }
        : {}),
    };
  }
  return null;
}

function isValidMcpTimeoutMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isMcpIsolation(value: unknown): value is "session" | "workspace" {
  return value === "session" || value === "workspace";
}

function isMcpProtocolVersion(value: unknown): value is "legacy" | "auto" | "2026-07-28" {
  return value === "legacy" || value === "auto" || value === "2026-07-28";
}

function isValidMcpOAuthConfig(value: unknown): value is McpOAuthConfig {
  if (!isRecord(value)) return false;
  if (
    value.type === "client_credentials" &&
    typeof value.clientId === "string" &&
    value.clientId.trim().length > 0 &&
    typeof value.clientSecret === "string" &&
    value.clientSecret.trim().length > 0
  ) {
    return (
      (value.clientName === undefined || typeof value.clientName === "string") &&
      (value.scope === undefined || typeof value.scope === "string")
    );
  }
  if (value.type === "authorization_code") {
    return (
      (value.clientId === undefined || typeof value.clientId === "string") &&
      (value.clientSecret === undefined || typeof value.clientSecret === "string") &&
      (value.clientName === undefined || typeof value.clientName === "string") &&
      (value.redirectPath === undefined || typeof value.redirectPath === "string") &&
      (value.scope === undefined || typeof value.scope === "string")
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface WorkspaceMcpTrustDecision {
  workspacePath: string;
  workspaceIdentity?: string;
  serverName: string;
  declarationDigest: string;
  trusted: boolean;
}
