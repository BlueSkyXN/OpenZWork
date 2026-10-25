import { useEffect } from "react";
import type {
  IPlatformService,
  WebRemoteControlWorkspaceTarget,
  WebRemoteControlTaskTarget,
  WebRemoteControlStatus,
} from "@zcode/shared";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { getWindowControllerTaskListRegistry } from "@/v4/windowControllerTaskListRegistry.js";
import { logger } from "@/logger.js";
import { isWorkspaceTab, type WindowTabState } from "@/store/tabStore.js";

export function buildWebRemoteControlWorkspaceTargets({
  tabs,
  reconnectingRemoteWorkspaceKeys = [],
  remoteWorkspaceErrorByWorkspaceKey = {},
}: {
  tabs: WindowTabState[];
  reconnectingRemoteWorkspaceKeys?: string[];
  remoteWorkspaceErrorByWorkspaceKey?: Record<string, string>;
}): WebRemoteControlWorkspaceTarget[] {
  const reconnectingWorkspaceKeySet = new Set(reconnectingRemoteWorkspaceKeys);

  return tabs.filter(isWorkspaceTab).map((tab) => {
    const isRemote = Boolean(tab.workspaceIdentity || tab.remoteTarget || tab.remoteSessionId);
    const workspaceKey = tab.workspaceIdentity?.trim() || tab.workspacePath;
    const lastConnectionError = remoteWorkspaceErrorByWorkspaceKey[workspaceKey]?.trim();
    return {
      workspacePath: tab.workspacePath,
      label: tab.label,
      kind: isRemote ? "remote" : "local",
      ...(isRemote
        ? {
            connectionState: reconnectingWorkspaceKeySet.has(workspaceKey)
              ? ("reconnecting" as const)
              : tab.remoteSessionId
                ? ("connected" as const)
                : ("disconnected" as const),
          }
        : {}),
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      ...(isRemote && lastConnectionError ? { lastConnectionError } : {}),
    };
  });
}

export function buildConnectedRemoteWorkspaceSessionTargets({
  tabs,
}: {
  tabs: WindowTabState[];
}): WebRemoteControlWorkspaceTarget[] {
  return tabs
    .filter(isWorkspaceTab)
    .filter((tab) => tab.remoteSessionId && tab.workspaceIdentity)
    .map((tab) => ({
      workspacePath: tab.workspacePath,
      label: tab.label,
      kind: "remote" as const,
      connectionState: "connected" as const,
      workspaceIdentity: tab.workspaceIdentity!,
      remoteSessionId: tab.remoteSessionId!,
    }));
}

export function shouldPublishCompleteWorkspaceSnapshot(
  hasCompletedFullTabRestore: boolean,
): boolean {
  return hasCompletedFullTabRestore;
}

/** workspace 同步只有一个完整快照入口，不依赖远控是否已有 runtime。 */
export function useWebRemoteControlWorkspaceSync({
  platform,
  tabs,
  isDesktop,
  featureEnabled,
  hasCompletedFullTabRestore,
  reconnectingRemoteWorkspaceKeys,
  remoteWorkspaceErrorByWorkspaceKey,
}: {
  platform: Pick<IPlatformService, "syncWebRemoteControlWorkspaces">;
  tabs: WindowTabState[];
  isDesktop: boolean;
  featureEnabled: boolean;
  hasCompletedFullTabRestore: boolean;
  reconnectingRemoteWorkspaceKeys?: string[];
  remoteWorkspaceErrorByWorkspaceKey?: Record<string, string>;
}): void {
  useEffect(() => {
    if (!isDesktop || !hasCompletedFullTabRestore) return;
    // 未运行时也必须发布本地+远端完整列表，否则登录后仅剩远端局部列表，丢失本地恢复目标。
    // 特性关闭时仍保留 Bot 已连接远端的绑定入口。
    const workspaces = featureEnabled
      ? buildWebRemoteControlWorkspaceTargets({
          tabs,
          reconnectingRemoteWorkspaceKeys,
          remoteWorkspaceErrorByWorkspaceKey,
        })
      : buildConnectedRemoteWorkspaceSessionTargets({ tabs });
    platform.syncWebRemoteControlWorkspaces?.(workspaces);
  }, [
    platform,
    tabs,
    isDesktop,
    featureEnabled,
    hasCompletedFullTabRestore,
    reconnectingRemoteWorkspaceKeys,
    remoteWorkspaceErrorByWorkspaceKey,
  ]);
}

/** 旧官方页使用 workspace 目录；只转换当前窗口已有 Controller 投影，不生成成员。 */
export function buildLegacyRemoteTaskTargets(
  workspaces: WebRemoteControlWorkspaceTarget[],
  groups: Array<{
    kind: "timeline" | "pinned" | "archived";
    items: WindowHostControllerTaskListItem[];
  }>,
): WebRemoteControlTaskTarget[] {
  const byKey = new Map(
    workspaces.map((workspace) => [
      workspace.workspaceIdentity?.trim() || workspace.workspacePath,
      workspace,
    ]),
  );
  return groups.flatMap(({ kind, items }) =>
    items.flatMap((task): WebRemoteControlTaskTarget[] => {
      const workspace = byKey.get(task.workspaceIdentity?.trim() || task.workspacePath);
      if (
        !workspace ||
        (workspace.kind === "remote" &&
          (!workspace.workspaceIdentity ||
            !workspace.remoteSessionId ||
            task.sourceAvailability !== "online"))
      )
        return [];
      return [
        {
          taskId: task.taskId,
          title: task.title,
          workspacePath: task.workspacePath,
          workspaceIdentity: task.workspaceIdentity,
          remoteSessionId: workspace.remoteSessionId,
          workspaceLabel: workspace.label,
          workspaceKind: workspace.kind,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          provider: task.provider,
          unreadAt: task.unreadAt,
          displayStatus: task.liveStatus === "waiting" ? "running" : task.liveStatus,
          hasBackgroundWork: task.activity?.hasBackgroundWork,
          workflowActivity: task.activity?.workflowActivity,
          pinned: kind === "pinned",
          archived: kind === "archived",
        },
      ];
    }),
  );
}

export function useWebRemoteControlLegacyTaskSync({
  platform,
  tabs,
  enabled,
}: {
  platform: IPlatformService;
  tabs: WindowTabState[];
  enabled: boolean;
}): void {
  // 旧目录仅为桌面附加能力；手机恢复和未挂载 base 服务的首帧无需该服务。
  const windowControllerService = useOptionalBaseWorkspaceServices()?.windowControllerService;
  useEffect(() => {
    if (!enabled || !windowControllerService || !platform.syncWebRemoteControlLegacyTasks) return;
    const workspaces = buildWebRemoteControlWorkspaceTargets({ tabs });
    const registry = getWindowControllerTaskListRegistry(windowControllerService);
    let disposed = false,
      active = false,
      serial = 0,
      statusRevision = 0;
    let unsubscribe: (() => void) | undefined;
    const load = async () => {
      const request = ++serial;
      try {
        const groups = await Promise.all(
          (["timeline", "pinned", "archived"] as const).map(async (kind) => {
            const query = {
              kind,
              workspaceScopes: workspaces.map(({ workspacePath, workspaceIdentity }) => ({
                workspacePath,
                workspaceIdentity,
              })),
              sortBy: "updated" as const,
            };
            if (!query.workspaceScopes.length) return { kind, items: [] };
            const result = await registry.list(
              JSON.stringify(query),
              {
                controllerRevision: registry.getRevision(),
                taskListVersionSignature: "",
                workspaceSourceGenerationSignature: JSON.stringify(
                  workspaces.map((w) => [
                    w.workspaceIdentity || w.workspacePath,
                    w.remoteSessionId,
                  ]),
                ),
              },
              query,
            );
            return { kind, items: result.items };
          }),
        );
        // 停止或 scope 换代后旧结果不能覆盖新连接；三个分组齐备才发布整快照。
        if (!disposed && active && request === serial)
          platform.syncWebRemoteControlLegacyTasks?.(
            buildLegacyRemoteTaskTargets(workspaces, groups),
          );
      } catch (error) {
        if (!disposed && active && request === serial)
          logger.warn("[web-remote-control] 旧版任务目录读取失败", error);
      }
    };
    const accept = (status: WebRemoteControlStatus) => {
      if (disposed) return;
      const next =
        status.connection?.mode === "official" &&
        ["running", "connecting", "active"].includes(status.status);
      if (next === active) return;
      active = next;
      serial++;
      unsubscribe?.();
      unsubscribe = undefined;
      if (active) {
        unsubscribe = registry.subscribe(() => {
          void load();
        });
        void load();
      }
    };
    const stopStatus = platform.onWebRemoteControlStatusChanged?.((status) => {
      statusRevision++;
      accept(status);
    });
    void platform
      .getWebRemoteControlStatus()
      .then((status) => {
        if (statusRevision === 0) accept(status);
      })
      .catch((error) => {
        if (!disposed) logger.warn("[web-remote-control] 读取连接状态失败", error);
      });
    return () => {
      disposed = true;
      serial++;
      unsubscribe?.();
      stopStatus?.();
    };
  }, [enabled, platform, tabs, windowControllerService]);
}
