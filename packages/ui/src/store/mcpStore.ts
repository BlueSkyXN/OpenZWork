/* eslint-disable max-lines -- MCP store 集中维护配置加载、持久化、状态刷新与运行时状态合并，拆分会增加跨状态同步复杂度。 */
/**
 * MCP (Model Context Protocol) UI State Store
 */
import { create } from "zustand";
import type {
  ZCodeAgentMcpServer,
  CliMcpSource,
  McpConfig,
  McpScope,
  McpServerConfig,
  McpServerStatus,
  McpSource,
  NativeMcpServerRecord,
  ZCodeMcpListMode,
  ZCodeMcpServerStatusSnapshot,
  ZCodeMcpServer,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";
import { convertToZCodeAgentMcpServer } from "@zcode/shared";
import { logger } from "@/logger.js";
import {
  fetchNativeMcpServers,
  migrateLegacyCommonMcpFromDesktop,
  persistCliMcpToUserDirectory,
  type McpDirectoryService,
  type McpPlatformService,
  type MigrateLegacyResult,
} from "@/store/mcpStoreDesktop.js";
import {
  importLegacyCommonServersToZCodeAgent,
  migrateStoredCommonMcpToZCodeAgent,
} from "@/store/mcpStoreMigration.js";
import {
  buildServerList,
  DEFAULT_MCP_CONFIG,
  getServerPriority,
  loadPersistedConfig,
  makeServerId,
  MCP_DELETED_PRELOAD_KEY,
  safeReadJson,
  safeWriteJson,
} from "@/store/mcpStoreHelpers.js";
import { isRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";
import { mergeMcpServerStatusSnapshots } from "@/store/mcpStoreStatusList.js";

let mcpPlatformService: McpPlatformService | null = null;

export function setMcpStorePlatform(platform: McpPlatformService | null): void {
  mcpPlatformService = platform;
}

interface UpdateServerStatusOptions {
  invalidateStatusListRequests?: boolean;
}

interface McpStoreState {
  config: McpConfig;
  nativeServers: NativeMcpServerRecord[];
  servers: ZCodeMcpServer[];
  statusSnapshots: Record<string, ZCodeMcpServerStatusSnapshot>;
  currentProjectPath: string;
  currentWorkspaceIdentity?: string;
  currentAuthorityKey?: string;
  currentDirectoryService: McpDirectoryService | null;
  enabledStates: Record<string, boolean>;
  deletedPreloadMcpServers: Set<string>;
  isConfigLoaded: boolean;
  currentSessionId: string | null;
  loadConfig: () => void;
  /** 重新读取当前绑定目标的 MCP 配置；要换目标请用 ensureLoadedForWorkspace。 */
  loadMcpFromUserDirectory: () => Promise<boolean>;
  ensureLoadedForWorkspace: (
    workspacePath?: string,
    directoryService?: McpDirectoryService | null,
    workspaceIdentity?: string,
    authorityKey?: string,
  ) => Promise<boolean>;
  saveConfig: () => void;
  addMcpServer: (name: string, config: McpServerConfig) => Promise<boolean>;
  updateMcpServer: (name: string, config: McpServerConfig) => Promise<boolean>;
  deleteMcpServer: (name: string) => Promise<boolean>;
  addScopedMcpServer: (
    source: McpSource,
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateScopedMcpServer: (
    source: McpSource,
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteScopedMcpServer: (
    source: McpSource,
    name: string,
    projectPath?: string,
  ) => Promise<boolean>;
  addZCodeAgentMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateZCodeAgentMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteZCodeAgentMcpServer: (name: string, projectPath?: string) => Promise<boolean>;
  addClaudeCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateClaudeCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteClaudeCliMcpServer: (name: string, projectPath?: string) => Promise<boolean>;
  addGeminiCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateGeminiCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteGeminiCliMcpServer: (name: string, projectPath?: string) => Promise<boolean>;
  addCodexCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateCodexCliMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteCodexCliMcpServer: (name: string, projectPath?: string) => Promise<boolean>;
  addOpenCodeMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  updateOpenCodeMcpServer: (
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) => Promise<boolean>;
  deleteOpenCodeMcpServer: (name: string, projectPath?: string) => Promise<boolean>;
  toggleServer: (id: string, enabled: boolean) => Promise<boolean>;
  updateServerStatus: (
    id: string,
    status: McpServerStatus,
    error?: string,
    options?: UpdateServerStatusOptions,
  ) => void;
  beginServerStatusListRefresh: (mode?: ZCodeMcpListMode) => number;
  markServerStatusListRefreshFailed: (
    error: string,
    requestEpoch: number,
    mode?: ZCodeMcpListMode,
  ) => void;
  mergeServerStatusSnapshots: (
    statuses: Record<string, ZCodeMcpServerStatusSnapshot>,
    requestEpoch: number,
    mode?: "connect" | "status",
  ) => void;
  getServer: (id: string) => ZCodeMcpServer | undefined;
  setCurrentProjectPath: (
    path: string,
    workspaceIdentity?: string,
    directoryService?: McpDirectoryService | null,
    authorityKey?: string,
  ) => void;
  getEnabledMcpServersForZCode: (provider: string) => ZCodeAgentMcpServer[];
  checkAllServerStatus: (
    tester: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>,
  ) => Promise<void>;
  mergePreloadedMcpServers: (preloaded: Record<string, McpServerConfig>) => Promise<boolean>;
  deletePreloadedMcpServer: (source: McpSource, name: string) => Promise<boolean>;
  setCurrentSessionId: (sessionId: string | null) => void;
  migrateLegacyCommonMcp: () => Promise<MigrateLegacyResult>;
}

export const useMcpStore = create<McpStoreState>((set, get) => {
  let directoryEpoch = 0;
  let loadMcpPromise: Promise<boolean> | null = null;
  let loadMcpWorkspaceKey: string | null = null;
  const statusListEpochs: Record<ZCodeMcpListMode, number> = {
    connect: 0,
    status: 0,
  };

  function invalidateStatusListRequests(): void {
    statusListEpochs.connect += 1;
    statusListEpochs.status += 1;
  }

  function resolveMcpDirectoryService(
    directoryService?: McpDirectoryService | null,
    workspaceIdentity?: string | null,
  ): McpDirectoryService | null {
    const state = get();
    // OW-P001：Source 用户级设置没有 workspace identity，目录服务必须与所选
    // authority 一起保留；不能使用当前 workspace 的默认服务保存另一台主机的配置。
    if (state.currentAuthorityKey?.trim()) {
      const selectedService = directoryService ?? state.currentDirectoryService;
      if (!selectedService) throw new Error("MCP Source 目录服务尚未就绪，请重新连接所选 Source。");
      return selectedService;
    }
    const effectiveWorkspaceIdentity = workspaceIdentity ?? state.currentWorkspaceIdentity;
    if (!effectiveWorkspaceIdentity?.trim()) {
      // 本地 workspace 仍要走 desktop platform 路径，才能执行旧 common MCP
      // 到用户级 ZCode Agent MCP 的迁移；目录服务只用于远端 workspace 覆盖路由。
      return null;
    }
    return directoryService ?? state.currentDirectoryService ?? mcpDirectoryService;
  }

  function commitState(partial: {
    config?: McpConfig;
    nativeServers?: NativeMcpServerRecord[];
  }): Partial<McpStoreState> {
    const state = get();
    const nextConfig = partial.config ?? state.config;
    const nextNativeServers = partial.nativeServers ?? state.nativeServers;
    return {
      config: nextConfig,
      nativeServers: nextNativeServers,
      servers: buildServerList(
        nextConfig,
        nextNativeServers,
        state.enabledStates,
        state.deletedPreloadMcpServers,
        state.servers,
      ),
    };
  }

  function updateNativeServer(
    source: CliMcpSource,
    name: string,
    config: McpServerConfig,
    projectPath?: string,
  ) {
    const nativeServers = get().nativeServers.slice();
    const targetIndex = nativeServers.findIndex(
      (server) =>
        server.source === source && server.name === name && server.projectPath === projectPath,
    );
    if (targetIndex >= 0) {
      const existing = nativeServers[targetIndex];
      if (!existing) {
        return;
      }
      nativeServers[targetIndex] = {
        ...existing,
        config,
      };
    } else {
      // 添加新的服务器记录
      const scope: McpScope = projectPath ? "workspace" : "user";
      nativeServers.push({
        source,
        scope,
        name,
        config,
        enabled: true,
        projectPath,
      });
    }
    set(commitState({ nativeServers }));
  }

  function captureWriteTarget() {
    const epoch = directoryEpoch;
    const directoryService = resolveMcpDirectoryService();
    const platform = mcpPlatformService;
    return {
      directoryService,
      platform,
      // OW-P006：目标切走再切回也不是同一次投影；重连后的旧代理结果同样作废。
      isCurrent: () =>
        epoch === directoryEpoch &&
        directoryService === resolveMcpDirectoryService() &&
        (directoryService !== null || platform === mcpPlatformService),
    };
  }

  async function persistScopedChange(
    payload: SaveCliMcpToUserDirectoryRequest,
    commit: () => void,
    target = captureWriteTarget(),
  ): Promise<boolean> {
    if (!target.isCurrent()) return false;
    invalidateStatusListRequests();
    // OW-P005：服务解析和保存失败都由调用方处理，不能吞错后提交未落盘的投影。
    const saved = await persistCliMcpToUserDirectory(
      target.platform,
      payload,
      target.directoryService,
    );
    if (!saved) throw new Error("MCP 配置保存服务尚未就绪，请重新连接后重试。");
    if (!target.isCurrent()) return false;
    // 校验与同步更新在同一边界内完成，避免 await 返回后再次跨目标写回。
    commit();
    return true;
  }

  return {
    config: { ...DEFAULT_MCP_CONFIG },
    nativeServers: [],
    servers: [],
    statusSnapshots: {},
    currentProjectPath: "",
    currentWorkspaceIdentity: undefined,
    currentAuthorityKey: undefined,
    currentDirectoryService: null,
    enabledStates: {},
    deletedPreloadMcpServers: new Set(),
    isConfigLoaded: false,
    currentSessionId: null,

    loadConfig: () => {
      const config = loadPersistedConfig();
      // MCP 启停状态已经迁移到 ~/.openzwork/cli/config.json，不能再读取旧 localStorage，
      // 否则旧的本地开关会覆盖新的 ZCode Agent 配置来源。
      const enabledStates: Record<string, boolean> = {};
      const deletedPreload = new Set<string>(safeReadJson<string[]>(MCP_DELETED_PRELOAD_KEY, []));
      const servers = buildServerList(config, [], enabledStates, deletedPreload, []);
      set({
        config,
        nativeServers: [],
        enabledStates,
        deletedPreloadMcpServers: deletedPreload,
        servers,
        statusSnapshots: {},
        isConfigLoaded: true,
      });
    },

    loadMcpFromUserDirectory: async () => {
      if (typeof window === "undefined") {
        return false;
      }

      const requestWorkspacePath = get().currentProjectPath || undefined;
      const requestWorkspaceIdentity = workspaceIdentity ?? get().currentWorkspaceIdentity;
      const requestAuthorityKey = authorityKey ?? get().currentAuthorityKey;
      const requestWorkspaceKey = `${requestAuthorityKey?.trim() || "workspace"}\0${requestWorkspaceIdentity?.trim() || requestWorkspacePath || ""}\0${directoryEpoch}`;
      if (loadMcpPromise && loadMcpWorkspaceKey === requestWorkspaceKey) {
        return await loadMcpPromise;
      }
      if (loadMcpPromise) {
        await loadMcpPromise;
      }

      const latestWorkspacePath = get().currentProjectPath || undefined;
      const latestWorkspaceIdentity = get().currentWorkspaceIdentity;
      const latestAuthorityKey = get().currentAuthorityKey;
      const latestWorkspaceKey = `${latestAuthorityKey?.trim() || "workspace"}\0${latestWorkspaceIdentity?.trim() || latestWorkspacePath || ""}\0${directoryEpoch}`;
      if (latestWorkspaceKey !== requestWorkspaceKey) {
        // 该调用等待上一轮 load 时已从 B 切到 C；B 调用持有的 remote
        // directoryService 不得继续读取 C，交给 C 自己发起的 ensure/load 调用处理。
        return false;
      }
      // 等待上一 workspace load 期间可能再次切换；目录服务必须按等待后的
      // 最新 identity 重新选择，不能拿 B 的 remote service 去读取 C 的路径。
      let activeDirectoryService: McpDirectoryService | null;
      try {
        activeDirectoryService = resolveMcpDirectoryService(
          directoryService,
          latestWorkspaceIdentity,
        );
      } catch (error) {
        logger.warn("[mcpStore] MCP directory unavailable", String(error));
        return false;
      }
      if (loadMcpPromise && loadMcpWorkspaceKey === latestWorkspaceKey) {
        return await loadMcpPromise;
      }

      const { currentProjectPath, currentWorkspaceIdentity } = get();
      const latestWorkspacePath = currentProjectPath || undefined;
      loadMcpWorkspaceKey = requestWorkspaceKey;
      loadMcpPromise = (async () => {
        try {
          // 等待上一目标 load 期间可能再次切换；目录服务取等待后的最新绑定，
          // 与 requestWorkspaceKey 属于同一组目标，不能拿 B 的服务读取 C 的路径。
          const activeDirectoryService = resolveMcpDirectoryService();
          logger.info(
            `[mcpStore] loadMcpFromUserDirectory workspace=${latestWorkspacePath ?? "<none>"} identity=${currentWorkspaceIdentity ?? "<none>"}`,
          );
          let servers = await fetchNativeMcpServers(
            mcpPlatformService,
            { workspacePath: latestWorkspacePath },
            activeDirectoryService,
          );
          if (!activeDirectoryService) {
            servers = await migrateStoredCommonMcpToZCodeAgent(
              mcpPlatformService,
              servers,
              latestWorkspacePath,
            );
          }
          const currentState = get();
          const currentWorkspaceKey = `${currentState.currentAuthorityKey?.trim() || "workspace"}\0${currentState.currentWorkspaceIdentity?.trim() || currentState.currentProjectPath}\0${directoryEpoch}`;
          if (currentWorkspaceKey !== latestWorkspaceKey) {
            // workspace A 的异步目录读取可能晚于切换到 B 才返回；
            // 旧结果包含 env/header/OAuth secret，不能写回共享 store 后被 B 的 Agent 消费。
            return false;
          }
          set(commitState({ nativeServers: servers }));
          return true;
        } catch (e) {
          // 读取失败不是“配置为空”；调用方必须保持 workspace not-ready，
          // 否则会显式下发空 mcpServers 并触发 replace，断开仍在运行的 MCP。
          // remote session attachment 绑定前只能拿到断连代理；这是初始化时序，不是
          // MCP 配置读取失败。只过滤该精确错误码，避免吞掉真实的目录或 RPC 故障。
          if (!isRemoteWorkspaceDisconnectedError(e)) {
            logger.warn("[mcpStore] loadMcpFromUserDirectory failed", String(e));
          }
          return false;
        } finally {
          loadMcpPromise = null;
          loadMcpWorkspaceKey = null;
        }
      })();

      return await loadMcpPromise;
    },

    ensureLoadedForWorkspace: async (
      workspacePath,
      directoryService,
      workspaceIdentity,
      authorityKey,
    ) => {
      if (!get().isConfigLoaded) {
        get().loadConfig();
      }

      const normalizedWorkspacePath = workspacePath ?? "";
      const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || undefined;
      const normalizedAuthorityKey = authorityKey?.trim() || undefined;
      if (
        normalizedWorkspacePath !== get().currentProjectPath ||
        normalizedWorkspaceIdentity !== get().currentWorkspaceIdentity ||
        normalizedAuthorityKey !== get().currentAuthorityKey
      ) {
        get().setCurrentProjectPath(
          normalizedWorkspacePath,
          normalizedWorkspaceIdentity,
          directoryService,
          normalizedAuthorityKey,
        );
      } else if (
        directoryService !== undefined &&
        directoryService !== get().currentDirectoryService
      ) {
        // OW-P006：同一 Source 重连也推进代次，旧代理的读取/写回不能覆盖新投影。
        get().setCurrentProjectPath(
          normalizedWorkspacePath,
          normalizedWorkspaceIdentity,
          directoryService,
          normalizedAuthorityKey,
        );
      }

      return await get().loadMcpFromUserDirectory();
    },

    saveConfig: () => {
      const { deletedPreloadMcpServers } = get();
      safeWriteJson(MCP_DELETED_PRELOAD_KEY, Array.from(deletedPreloadMcpServers));
    },

    addMcpServer: (name, config) => get().addZCodeAgentMcpServer(name, config),
    updateMcpServer: (name, config) => get().updateZCodeAgentMcpServer(name, config),
    deleteMcpServer: (name) => get().deleteZCodeAgentMcpServer(name),
    addScopedMcpServer: async (source, name, config, projectPath) => {
      const targetSource: CliMcpSource = source === "mcp" ? "zcodeagentmcp" : source;
      return persistScopedChange(
        { action: "upsert", source: targetSource, name, config, projectPath },
        () => updateNativeServer(targetSource, name, config, projectPath),
      );
    },
    updateScopedMcpServer: (source, name, config, projectPath) =>
      get().addScopedMcpServer(source, name, config, projectPath),
    deleteScopedMcpServer: async (source, name, projectPath) => {
      const targetSource: CliMcpSource = source === "mcp" ? "zcodeagentmcp" : source;
      return persistScopedChange(
        { action: "delete", source: targetSource, name, projectPath },
        () =>
          set(
            commitState({
              nativeServers: get().nativeServers.filter(
                (server) =>
                  !(
                    server.source === targetSource &&
                    server.name === name &&
                    server.projectPath === projectPath
                  ),
              ),
            }),
          ),
      );
    },
    addClaudeCliMcpServer: (name, config, projectPath) =>
      get().addScopedMcpServer("claudeclimcp", name, config, projectPath),
    updateClaudeCliMcpServer: (name, config, projectPath) =>
      get().updateScopedMcpServer("claudeclimcp", name, config, projectPath),
    deleteClaudeCliMcpServer: (name, projectPath) =>
      get().deleteScopedMcpServer("claudeclimcp", name, projectPath),
    addGeminiCliMcpServer: (name, config, projectPath) =>
      get().addScopedMcpServer("geminiclimcp", name, config, projectPath),
    updateGeminiCliMcpServer: (name, config, projectPath) =>
      get().updateScopedMcpServer("geminiclimcp", name, config, projectPath),
    deleteGeminiCliMcpServer: (name, projectPath) =>
      get().deleteScopedMcpServer("geminiclimcp", name, projectPath),
    addCodexCliMcpServer: (name, config, projectPath) =>
      get().addScopedMcpServer("codexclimcp", name, config, projectPath),
    updateCodexCliMcpServer: (name, config, projectPath) =>
      get().updateScopedMcpServer("codexclimcp", name, config, projectPath),
    deleteCodexCliMcpServer: (name, projectPath) =>
      get().deleteScopedMcpServer("codexclimcp", name, projectPath),
    addOpenCodeMcpServer: (name, config, projectPath) =>
      get().addScopedMcpServer("opencodemcp", name, config, projectPath),
    updateOpenCodeMcpServer: (name, config, projectPath) =>
      get().updateScopedMcpServer("opencodemcp", name, config, projectPath),
    deleteOpenCodeMcpServer: (name, projectPath) =>
      get().deleteScopedMcpServer("opencodemcp", name, projectPath),
    addZCodeAgentMcpServer: (name, config, projectPath) =>
      get().addScopedMcpServer("zcodeagentmcp", name, config, projectPath),
    updateZCodeAgentMcpServer: (name, config, projectPath) =>
      get().updateScopedMcpServer("zcodeagentmcp", name, config, projectPath),
    deleteZCodeAgentMcpServer: (name, projectPath) =>
      get().deleteScopedMcpServer("zcodeagentmcp", name, projectPath),

    toggleServer: async (id, enabled) => {
      const targetServer = get().servers.find((server) => server.id === id);
      if (!targetServer) return false;
      const commit = () =>
        set((state) => ({
          enabledStates: { ...state.enabledStates, [id]: enabled },
          servers: state.servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
        }));
      if (targetServer.source === "mcp") {
        invalidateStatusListRequests();
        commit();
        return true;
      }
      return persistScopedChange(
        {
          action: "set-enabled",
          source: targetServer.source,
          name: targetServer.name,
          enabled,
          projectPath: targetServer.projectPath,
          location: targetServer.location,
        },
        commit,
      );
    },

    updateServerStatus: (id, status, error, options) => {
      if (options?.invalidateStatusListRequests !== false) {
        invalidateStatusListRequests();
      }
      set((state) => ({
        servers: state.servers.map((s) =>
          s.id === id
            ? {
                ...s,
                status,
                authorization: undefined,
                error,
                failureKind: status === "error" ? "connection_failed" : undefined,
                serverRequestId: undefined,
                toolCount: status === "connected" ? s.toolCount : undefined,
                changed: status === "error" ? s.changed : false,
                lastConnected: status === "connected" ? new Date() : s.lastConnected,
              }
            : s,
        ),
      }));
    },

    beginServerStatusListRefresh: (mode = "connect") => {
      statusListEpochs[mode] += 1;
      const requestEpoch = statusListEpochs[mode];
      if (mode === "status") {
        // OAuth 1s status-only 轮询只读取 runtime snapshot；不能反复清空
        // authorization/toolCount 或把用户同时编辑的其他 MCP 投影成 connecting。
        return requestEpoch;
      }
      // agent 侧 mcp/list 会等待所有 MCP 连接完成才返回；如果插件 MCP 还在 30s 超时中，
      // 修改 timeoutMs 后本地列表会长时间停在 unknown，看起来像没有立即重新检查。
      set((state) => ({
        servers: state.servers.map((server) => {
          const enabled = state.enabledStates[server.id] ?? server.enabled;
          if (
            server.source !== "zcodeagentmcp" ||
            !enabled ||
            (!server.changed && server.status !== "unknown")
          ) {
            return server;
          }
          return {
            ...server,
            status: "connecting",
            authorization: undefined,
            error: undefined,
            failureKind: undefined,
            serverRequestId: undefined,
            toolCount: undefined,
          };
        }),
      }));
      return requestEpoch;
    },

    markServerStatusListRefreshFailed: (error, requestEpoch, mode = "connect") => {
      if (requestEpoch !== statusListEpochs[mode] || mode === "status") {
        // OAuth 轮询是只读的 best-effort status 请求；临时失败不能清空已有
        // authorization snapshot，也不能把同一列表中仍在连接的 MCP 批量标红。
        return;
      }
      set((state) => ({
        statusSnapshots: {},
        servers: state.servers.map((server) => {
          const enabled = state.enabledStates[server.id] ?? server.enabled;
          if (server.source !== "zcodeagentmcp" || !enabled || server.status !== "connecting") {
            return server;
          }
          return {
            ...server,
            status: "error",
            authorization: undefined,
            error,
            failureKind: "status_unavailable",
            serverRequestId: undefined,
            toolCount: undefined,
          };
        }),
      }));
    },

    mergeServerStatusSnapshots: (statuses, requestEpoch, mode = "connect") => {
      if (requestEpoch !== statusListEpochs[mode]) {
        return;
      }
      set((state) => {
        const nextStatusSnapshots =
          mode === "status" ? { ...state.statusSnapshots, ...statuses } : statuses;
        return {
          statusSnapshots: nextStatusSnapshots,
          servers: mergeMcpServerStatusSnapshots(state.servers, nextStatusSnapshots, {
            // Bugfix：OAuth 轮询的 status-only 响应可能只包含 pending 子集。
            // 缺失项不能按全量 mcp/list 处理，否则会把其他 MCP 误标为 agent 未返回。
            markMissingConnectingAsError: mode !== "status",
          }),
        };
      });
    },

    getServer: (id) => get().servers.find((s) => s.id === id),

    setCurrentProjectPath: (path, workspaceIdentity, directoryService, authorityKey) => {
      invalidateStatusListRequests();
      const {
        config,
        currentProjectPath,
        currentWorkspaceIdentity,
        currentAuthorityKey,
        deletedPreloadMcpServers,
        enabledStates,
        isConfigLoaded,
        nativeServers,
        servers,
      } = get();
      const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || undefined;
      const normalizedAuthorityKey = authorityKey?.trim() || undefined;
      const workspaceChanged =
        path !== currentProjectPath ||
        normalizedWorkspaceIdentity !== currentWorkspaceIdentity ||
        normalizedAuthorityKey !== currentAuthorityKey;
      const targetChanged =
        workspaceChanged || get().currentDirectoryService !== (directoryService ?? null);
      if (targetChanged) directoryEpoch += 1;
      // OW-P006：同名 server 的启停投影也属于原目标，不能覆盖新 Source 的磁盘状态。
      const nextEnabledStates = targetChanged ? {} : enabledStates;
      const nextNativeServers = workspaceChanged ? [] : nativeServers;
      set({
        currentProjectPath: path,
        currentWorkspaceIdentity: normalizedWorkspaceIdentity,
        currentAuthorityKey: normalizedAuthorityKey,
        currentDirectoryService: directoryService ?? null,
        enabledStates: nextEnabledStates,
        nativeServers: nextNativeServers,
        statusSnapshots: {},
        servers: buildServerList(
          config,
          nextNativeServers,
          nextEnabledStates,
          deletedPreloadMcpServers,
          targetChanged ? [] : servers,
        ),
      });
      if (isConfigLoaded && workspaceChanged) {
        // 切换到远程 workspace 后配置加载是异步的；等待期间必须先清空 A 的
        // user-level MCP，不能把其 env/header/OAuth clientSecret 暂存为 B 的可发送配置。
        void get().loadMcpFromUserDirectory(
          directoryService,
          normalizedWorkspaceIdentity,
          normalizedAuthorityKey,
        );
      }
    },

    getEnabledMcpServersForZCode: (_provider) => {
      const { servers, enabledStates, currentProjectPath } = get();
      const candidates = new Map<string, ZCodeMcpServer>();

      for (const server of servers) {
        const isEnabled = enabledStates[server.id] ?? server.enabled;
        if (!isEnabled) continue;
        if (server.source !== "zcodeagentmcp") continue;
        if (server.scope === "workspace" && server.projectPath !== currentProjectPath) continue;

        const existing = candidates.get(server.name);
        if (!existing || getServerPriority(server) > getServerPriority(existing)) {
          candidates.set(server.name, server);
        }
      }

      const result: ZCodeAgentMcpServer[] = [];
      for (const server of candidates.values()) {
        const zcodeAgentServer = convertToZCodeAgentMcpServer(
          server.name,
          server.config,
          server.scope === "workspace" ? "workspace" : "user",
        );
        if (zcodeAgentServer) result.push(zcodeAgentServer);
      }
      return result;
    },

    checkAllServerStatus: async (tester) => {
      for (const server of get().servers) {
        const isEnabled = get().enabledStates[server.id] ?? server.enabled;
        if (!isEnabled || (!server.changed && server.status !== "unknown")) continue;

        get().updateServerStatus(server.id, "connecting");
        try {
          const result = await tester(server.config);
          get().updateServerStatus(
            server.id,
            result.success ? "connected" : "error",
            result.success ? undefined : (result.error ?? "Connection failed"),
          );
        } catch (e) {
          get().updateServerStatus(server.id, "error", String(e));
        }
      }
    },

    mergePreloadedMcpServers: async (preloaded) => {
      const target = captureWriteTarget();
      const targetSource: CliMcpSource = "zcodeagentmcp";
      for (const [name, config] of Object.entries(preloaded)) {
        const state = get();
        const serverId = makeServerId(targetSource, name);
        const exists = state.nativeServers.some(
          (server) => server.source === targetSource && server.name === name && !server.projectPath,
        );
        if (state.deletedPreloadMcpServers.has(serverId) || exists) continue;
        const applied = await persistScopedChange(
          { action: "upsert", source: targetSource, name, config },
          () => updateNativeServer(targetSource, name, config),
          target,
        );
        if (!applied) return false;
      }
      return target.isCurrent();
    },

    deletePreloadedMcpServer: async (source, name) => {
      const targetSource: CliMcpSource = source === "mcp" ? "zcodeagentmcp" : source;
      const key = makeServerId(targetSource, name);
      return persistScopedChange({ action: "delete", source: targetSource, name }, () => {
        set((state) => {
          const nextDeleted = new Set(state.deletedPreloadMcpServers);
          nextDeleted.add(key);
          safeWriteJson(MCP_DELETED_PRELOAD_KEY, Array.from(nextDeleted));
          const nextNativeServers = state.nativeServers.filter(
            (server) =>
              !(server.source === targetSource && server.name === name && !server.projectPath),
          );
          return {
            deletedPreloadMcpServers: nextDeleted,
            nativeServers: nextNativeServers,
            servers: buildServerList(
              state.config,
              nextNativeServers,
              state.enabledStates,
              nextDeleted,
              state.servers,
            ),
          };
        });
      });
    },

    setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),

    migrateLegacyCommonMcp: async () => {
      const result = await migrateLegacyCommonMcpFromDesktop(mcpPlatformService);
      const latestWorkspacePath = get().currentProjectPath || undefined;
      const currentNativeServers =
        get().nativeServers.length > 0
          ? get().nativeServers
          : await fetchNativeMcpServers(mcpPlatformService, { workspacePath: latestWorkspacePath });
      const migration = await importLegacyCommonServersToZCodeAgent(
        mcpPlatformService,
        result.servers ?? {},
        currentNativeServers,
        result.sourcePath,
      );
      if (migration.changed) {
        const servers = await fetchNativeMcpServers(mcpPlatformService, {
          workspacePath: latestWorkspacePath,
        });
        set(commitState({ nativeServers: servers }));
      }
      return migration;
    },
  };
});
