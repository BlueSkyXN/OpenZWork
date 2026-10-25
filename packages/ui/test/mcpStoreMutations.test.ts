import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeMcpServerRecord } from "@zcode/shared";
import { setMcpStoreDirectoryService, setMcpStorePlatform, useMcpStore } from "@/store/mcpStore.js";
import { DEFAULT_MCP_CONFIG } from "@/store/mcpStoreHelpers.js";
import {
  buildMcpServerStatusListKey,
  refreshMcpServerStatusList,
  resolveMcpStatusListRefreshSkipReason,
  runMcpSettingsMutation,
} from "@/settings/McpSettingsSection.js";

const oldConfig = { type: "http" as const, url: "https://old.example.test/mcp" };
const aConfig = {
  type: "http" as const,
  url: "https://a.example.test/mcp",
  headers: { "X-Test-Source": "synthetic-source-a" },
};
const record = (config = oldConfig): NativeMcpServerRecord => ({
  name: "same-name",
  source: "zcodeagentmcp",
  scope: "user",
  enabled: true,
  config,
});
const directory = (servers = [record()]) => ({
  loadMcpFromUserDirectory: vi.fn(async () => ({ servers })),
  saveMcpToUserDirectory: vi.fn(async () => {}),
});
const current = () => useMcpStore.getState();
async function select(service: ReturnType<typeof directory>, name = "a") {
  return current().ensureLoadedForWorkspace(
    "/same/workspace",
    service,
    undefined,
    `source:${name}`,
  );
}
const operations = {
  add: () => current().addScopedMcpServer("zcodeagentmcp", "new-entry", aConfig),
  update: () => current().updateScopedMcpServer("zcodeagentmcp", "same-name", aConfig),
  toggle: () => current().toggleServer(current().servers[0]!.id, false),
  delete: () => current().deleteScopedMcpServer("zcodeagentmcp", "same-name"),
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
  setMcpStoreDirectoryService(null);
  setMcpStorePlatform(null);
  useMcpStore.setState({
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
    isConfigLoaded: true,
  });
});

describe("OW-P005：MCP 写入成功后才更新投影", () => {
  it.each(Object.entries(operations))(
    "%s 写入拒绝时保留原状态并返回错误",
    async (_name, mutate) => {
      const service = directory();
      await select(service);
      const before = current();
      service.saveMcpToUserDirectory.mockRejectedValue(new Error("write denied"));
      await expect(mutate()).rejects.toThrow("write denied");
      expect(current().servers).toEqual(before.servers);
      expect(current().nativeServers).toEqual(before.nativeServers);
      expect(current().enabledStates).toEqual(before.enabledStates);
    },
  );

  it.each(Object.entries(operations))(
    "%s 缺少 Source 服务时拒绝本机 fallback",
    async (_name, mutate) => {
      await select(directory());
      current().setCurrentProjectPath("/same/workspace", undefined, null, "source:a");
      const platform = {
        loadMcpFromUserDirectory: vi.fn(async () => ({ servers: [] })),
        saveMcpToUserDirectory: vi.fn(async () => ({ success: true })),
        migrateLegacyCommonMcp: vi.fn(async () => ({
          servers: {},
          totalCount: 0,
          importedCount: 0,
          skippedCount: 0,
        })),
      };
      setMcpStorePlatform(platform);
      setMcpStoreDirectoryService(directory());
      const before = current().servers;
      await expect(mutate()).rejects.toThrow("Source");
      expect(current().servers).toEqual(before);
      expect(platform.saveMcpToUserDirectory).not.toHaveBeenCalled();
    },
  );

  it("删除等待所选 Source，成功后只移除指定 scope", async () => {
    const service = directory([
      record(),
      { ...record(), scope: "workspace", projectPath: "/same/workspace" },
    ]);
    await select(service);
    const saved = Promise.withResolvers<void>();
    service.saveMcpToUserDirectory.mockReturnValue(saved.promise);
    const deletion = current().deleteScopedMcpServer(
      "zcodeagentmcp",
      "same-name",
      "/same/workspace",
    );
    expect(current().nativeServers).toHaveLength(2);
    saved.resolve();
    await expect(deletion).resolves.toBe(true);
    expect(service.saveMcpToUserDirectory).toHaveBeenCalledExactlyOnceWith({
      action: "delete",
      source: "zcodeagentmcp",
      name: "same-name",
      projectPath: "/same/workspace",
    });
    expect(current().nativeServers).toEqual([record()]);
  });

  it("本机平台保存返回失败时也保留配置", async () => {
    const save = vi.fn(async () => ({ success: false, error: "disk full" }));
    setMcpStorePlatform({
      saveMcpToUserDirectory: save,
      loadMcpFromUserDirectory: vi.fn(async () => ({ servers: [] })),
      migrateLegacyCommonMcp: vi.fn(async () => ({
        servers: {},
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
      })),
    });
    await expect(operations.add()).rejects.toThrow("disk full");
    expect(current().servers).toHaveLength(0);
  });

  it("本机平台未提供保存能力时返回失败", async () => {
    await expect(operations.add()).rejects.toThrow();
    expect(current().servers).toHaveLength(0);
  });

  it("预载新增和删除失败时保留条目及删除标记", async () => {
    const service = directory();
    await select(service);
    service.saveMcpToUserDirectory.mockRejectedValue(new Error("write denied"));
    await expect(current().mergePreloadedMcpServers({ preload: aConfig })).rejects.toThrow(
      "write denied",
    );
    await expect(current().deletePreloadedMcpServer("zcodeagentmcp", "same-name")).rejects.toThrow(
      "write denied",
    );
    expect(current().nativeServers).toEqual([record()]);
    expect(current().deletedPreloadMcpServers.size).toBe(0);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe("OW-P006：MCP 写回绑定目标代次", () => {
  it.each(["switch", "reconnect"])("%s 后同名 MCP 使用新目标的持久化开关", async (transition) => {
    await select(directory());
    await operations.toggle();
    expect(current().servers[0]!.enabled).toBe(false);
    await select(directory(), transition === "switch" ? "b" : "a");
    expect(current().servers[0]!.enabled).toBe(true);
    expect(current().enabledStates).toEqual({});
  });

  for (const transition of ["switch", "return", "reconnect"] as const) {
    it.each(Object.entries(operations))(
      `${transition} 后 %s 的迟到结果不更新当前投影`,
      async (_name, mutate) => {
        const a = directory();
        await select(a);
        const saved = Promise.withResolvers<void>();
        a.saveMcpToUserDirectory.mockReturnValue(saved.promise);
        const pending = mutate();
        const b = directory([{ ...record(), enabled: true }]);
        if (transition !== "reconnect") await select(b, "b");
        if (transition === "return") await select(a, "a");
        if (transition === "reconnect") await select(b, "a");
        const before = current();
        saved.resolve();
        await expect(pending).resolves.toBe(false);
        expect(current().servers).toEqual(before.servers);
        expect(current().nativeServers).toEqual(before.nativeServers);
        expect(current().enabledStates).toEqual(before.enabledStates);
        expect(b.saveMcpToUserDirectory).not.toHaveBeenCalled();
      },
    );
  }

  it("切换后 A 配置不进入 B 的真实状态刷新入口", async () => {
    const a = directory([]);
    await select(a);
    const saved = Promise.withResolvers<void>();
    a.saveMcpToUserDirectory.mockReturnValue(saved.promise);
    const pending = operations.add();
    await select(directory(), "b");
    saved.resolve();
    await pending;
    const state = current();
    const key = `${state.currentAuthorityKey}\0${state.currentProjectPath}`;
    expect(
      resolveMcpStatusListRefreshSkipReason({
        requestedWorkspaceKey: key,
        trigger: "auto",
        input: {
          activeWorkspaceKey: key,
          storeWorkspaceKey: key,
          configReadyWorkspaceKey: key,
          activeWorkspacePath: state.currentProjectPath,
          isConfigLoaded: true,
          serverStatusListKey: buildMcpServerStatusListKey(state.servers),
        },
      }),
    ).toBeUndefined();
    const listWorkspaceMcpServerStatuses = vi.fn(async () => ({ statuses: {} }));
    await refreshMcpServerStatusList({
      beginServerStatusListRefresh: state.beginServerStatusListRefresh,
      mergeServerStatusSnapshots: state.mergeServerStatusSnapshots,
      getCurrentWorkspaceKey: () => key,
      requestedWorkspaceKey: key,
      workspacePath: state.currentProjectPath,
      mcpServers: state.getEnabledMcpServersForZCode("zcode"),
      mcpSyncService: { listWorkspaceMcpServerStatuses },
    });
    expect(listWorkspaceMcpServerStatuses).toHaveBeenCalledOnce();
    expect(JSON.stringify(listWorkspaceMcpServerStatuses.mock.calls)).not.toContain(
      "synthetic-source-a",
    );
  });

  it("批量预载在切换后停止，不把后续项目保存到新 Source", async () => {
    const a = directory([]);
    await select(a);
    const saved = Promise.withResolvers<void>();
    a.saveMcpToUserDirectory.mockReturnValue(saved.promise);
    const pending = current().mergePreloadedMcpServers({ first: aConfig, second: aConfig });
    const b = directory([]);
    await select(b, "b");
    saved.resolve();
    await expect(pending).resolves.toBe(false);
    expect(a.saveMcpToUserDirectory).toHaveBeenCalledOnce();
    expect(b.saveMcpToUserDirectory).not.toHaveBeenCalled();
    expect(current().servers).toHaveLength(0);
  });

  it("同 Source 重连时旧读取也不能覆盖新代理结果", async () => {
    const old = directory([]);
    const loaded = Promise.withResolvers<{ servers: NativeMcpServerRecord[] }>();
    old.loadMcpFromUserDirectory.mockReturnValue(loaded.promise);
    const pending = select(old);
    const fresh = select(directory([record()]));
    loaded.resolve({ servers: [record(aConfig)] });
    await expect(pending).resolves.toBe(false);
    await expect(fresh).resolves.toBe(true);
    expect(current().nativeServers).toEqual([record()]);
  });
});

describe("OW-P005/OW-P006：设置页完成处理", () => {
  it("保存失败通知界面但不关闭表单，也不产生未处理 rejection", async () => {
    const error = new Error("write denied");
    const onError = vi.fn(),
      onApplied = vi.fn();
    await expect(
      runMcpSettingsMutation({
        mutate: async () => {
          throw error;
        },
        isCurrent: () => true,
        onApplied,
        onError,
      }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("切换后迟到的 %s 不关闭新表单或展示旧错误", async (outcome) => {
    const saved = Promise.withResolvers<boolean>();
    let active = true;
    const onError = vi.fn(),
      onApplied = vi.fn();
    const pending = runMcpSettingsMutation({
      mutate: () => saved.promise,
      isCurrent: () => active,
      onApplied,
      onError,
    });
    active = false;
    if (outcome === "success") saved.resolve(true);
    else saved.reject(new Error("old source failed"));
    await pending;
    expect(onApplied).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([true, false])("只有当前投影已应用（%s）才执行成功动作", async (applied) => {
    const onError = vi.fn(),
      onApplied = vi.fn();
    await runMcpSettingsMutation({
      mutate: async () => applied,
      isCurrent: () => true,
      onApplied,
      onError,
    });
    expect(onApplied).toHaveBeenCalledTimes(applied ? 1 : 0);
    expect(onError).not.toHaveBeenCalled();
  });
});
