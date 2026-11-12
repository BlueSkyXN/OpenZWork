// 设置页插件管理薄服务实现——plugins/* 旧协议词的唯一 host 侧消费点。
// 插件安装/市场/启停的事实源在 zcode-cli 进程（读写 ~/.openzwork 插件目录并热更新
// 运行态），host 无副本，故实现保持 agent 协议往返；收敛价值在 UI 层不再直触
// IZCodeAgentService，词表消费面从 UI 散点收拢到本文件一处。
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IPluginManagementService } from "./pluginManagement.js";

/** 插件管理变更成功的信号（Window Host 侧）。action 与遥测的动作名相同。 */
export interface PluginMutationSucceededEvent {
  /** install、uninstall、update、restore、configure、reset_config、enable、disable、source_* 等。 */
  action: string;
  pluginId?: string;
  scope?: "user" | "workspace";
}

export interface PluginManagementServiceDependencies {
  /**
   * 插件清单「变了」的 Window Host 侧信号：安装、卸载、启停、配置等变更成功返回后调用。
   * 扩展进程据此重读插件清单（docs/plugins/extension-host.md §3.4、§13）；配置与重置还通知该插件的
   * settings.onDidChange（§16.7）。dryRun 不触发。
   */
  onMutationSucceeded?: (event: PluginMutationSucceededEvent) => void;
  now?: () => number;
  zcodeAgentService: Pick<
    IZCodeAgentService,
    | "listPlugins"
    | "getPluginReferenceCatalog"
    | "resolveSuggestedPluginReference"
    | "onDynamicPluginOperationProgress"
    | "getPluginsOverview"
    | "addPluginMarketplace"
    | "removePluginMarketplace"
    | "updatePluginMarketplace"
    | "installPlugin"
    | "cancelPluginOperation"
    | "uninstallPlugin"
    | "updatePlugin"
    | "restoreBuiltinPlugin"
    | "configurePlugin"
    | "resetPluginConfig"
    | "validatePlugin"
    | "describePlugin"
    | "setPluginEnabled"
  >;
}

export function createPluginManagementService(
  dependencies: PluginManagementServiceDependencies,
): IPluginManagementService {
  const agent = dependencies.zcodeAgentService;
  const now = dependencies.now ?? Date.now;
  type Params =
    import("../zcode-agent/zcodeAgentPluginParams.js").ZCodeAgentPluginMutationTarget & {
      pluginId?: string;
      pluginName?: string;
      marketplace?: string;
      scope?: "user" | "workspace";
      dryRun?: boolean;
      removeCache?: boolean;
    };
  type Result = {
    diagnostics?: Array<{ severity?: string; code?: string }>;
    installedPlugins?: Array<{
      id: string;
      marketplace: string;
      version?: string;
      scope: string;
      listing?: { publisherType?: string };
    }>;
    removedPlugin?: { id: string; marketplace: string; version?: string };
    pluginId?: string;
    marketplaces?: unknown[];
    marketplace?: { id: string };
    plugin?: { id: string; marketplace: string; source: string; version?: string };
  };
  const observe = async <T extends Result>(
    action: string,
    params: Params,
    invoke: (clean: Params) => Promise<T>,
  ): Promise<T> => {
    const startedAt = now();
    const clean = params;
    try {
      const result = await invoke(clean);
      if (!params.dryRun) {
        // 通知方故障不能改变已成功的业务返回。
        try {
          dependencies.onMutationSucceeded?.({
            action,
            ...(params.pluginId ? { pluginId: params.pluginId } : {}),
            ...(params.scope ? { scope: params.scope } : {}),
          });
        } catch {
          /* 观察者自行记录错误。 */
        }
      }
      return result;
    } catch (error) {
      throw error;
    }
  };
  return {
    listPlugins: (params) => agent.listPlugins(params),
    getPluginReferenceCatalog: (params) => agent.getPluginReferenceCatalog(params),
    resolveSuggestedPluginReference: (params) => agent.resolveSuggestedPluginReference(params),
    onDynamicPluginOperationProgress: (operationId) =>
      agent.onDynamicPluginOperationProgress(operationId),
    getPluginsOverview: (params) => agent.getPluginsOverview(params),
    addPluginMarketplace: (params) => agent.addPluginMarketplace(params),
    removePluginMarketplace: (params) => agent.removePluginMarketplace(params),
    updatePluginMarketplace: (params) => agent.updatePluginMarketplace(params),
    installPlugin: (params) => agent.installPlugin(params),
    cancelPluginOperation: (params) => agent.cancelPluginOperation(params),
    uninstallPlugin: (params) => agent.uninstallPlugin(params),
    updatePlugin: (params) => agent.updatePlugin(params),
    restoreBuiltinPlugin: (params) => agent.restoreBuiltinPlugin(params),
    configurePlugin: (params) => agent.configurePlugin(params),
    resetPluginConfig: (params) => agent.resetPluginConfig(params),
    validatePlugin: (params) => agent.validatePlugin(params),
    describePlugin: (params) => agent.describePlugin(params),
    setPluginEnabled: (params) => agent.setPluginEnabled(params),
  };
}
