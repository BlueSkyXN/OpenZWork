import { useEffect, useState } from "react";
import type {
  IPlatformService,
  WebRemoteControlWorkspaceTarget,
  WebRemoteControlTaskTarget,
  WebRemoteControlStatus,
  WebRemoteControlLegacyDirectory,
} from "@zcode/shared";
import { resolveWebRemoteControlWorkspaceKey } from "@zcode/shared";
import { useOptionalProjectDirectory } from "@/project-sidebar/index.js";
import type { ProjectTree } from "@/project-sidebar/contract.js";
import { getTaskListRowActivity } from "@/v4/taskListRowActivity.js";
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

/** 旧页按 workspace 展示；目录来自窗口已有 Provider，不受打开的 tabs 限制。 */
export function buildLegacyRemoteDirectorySnapshot(
  workspaces: WebRemoteControlWorkspaceTarget[],
  tree: ProjectTree,
  rootlessLabel: string,
): Omit<WebRemoteControlLegacyDirectory, "windowControlSessionId"> & {
  tasks: WebRemoteControlTaskTarget[];
} {
  const byKey = new Map(workspaces.map((w) => [resolveWebRemoteControlWorkspaceKey(w), w]));
  const projects = new Map<string, string[]>();
  const localProjectById = new Map(
    tree.projects.filter((p) => p.hostId === "local").map((p) => [p.id, p]),
  );
  const localProjects = tree.projects.filter((p) => p.hostId === "local" && !p.deleted);
  for (const project of localProjects) {
    const path =
      project.roots.find((root) => root.isPrimary)?.rootPath ?? project.roots[0]?.rootPath;
    // 无 root 的寻址键只在兼容目录中使用；Main 经 projectId 准备后才返回真实 cwd。
    const identity = path ? undefined : JSON.stringify(["openzwork-local-project", project.id]);
    const workspaceKey = identity ?? path!;
    // 附加目录里的历史仍按原 cwd 读取；从它新建也交给项目服务选择当前主目录。
    for (const key of new Set(
      project.roots.length ? project.roots.map((root) => root.rootPath) : [workspaceKey],
    ))
      projects.set(key, [...(projects.get(key) ?? []), project.id]);
    const previous = byKey.get(workspaceKey);
    byKey.set(workspaceKey, {
      workspacePath: path ?? rootlessLabel,
      ...(identity ? { workspaceIdentity: identity } : {}),
      kind: "local",
      label: project.name,
      ...(previous?.workspacePurpose ? { workspacePurpose: previous.workspacePurpose } : {}),
    });
  }
  for (const [key, ids] of projects) {
    const workspace = byKey.get(key);
    if (workspace?.kind === "local")
      byKey.set(key, {
        ...workspace,
        label: ids.map((id) => localProjectById.get(id)!.name).join(" / "),
      });
  }
  const tasks: WebRemoteControlTaskTarget[] = [];
  for (const task of tree.tasks) {
    const key = resolveWebRemoteControlWorkspaceKey(task);
    let workspace = byKey.get(key);
    if (task.hostId === "local") {
      // local Host 的普通历史保留原 cwd；远端身份不能经本地扩展绕过当前 session 边界。
      if (task.workspaceIdentity) continue;
      if (!workspace) {
        workspace = {
          workspacePath: task.workspacePath,
          kind: "local",
          label:
            (task.projectId ? localProjectById.get(task.projectId)?.name : undefined) ??
            task.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ??
            task.workspacePath,
          ...(task.workspacePurpose ? { workspacePurpose: task.workspacePurpose } : {}),
        };
        byKey.set(key, workspace);
      }
    } else if (
      workspace?.kind !== "remote" ||
      !workspace.workspaceIdentity ||
      !workspace.remoteSessionId ||
      workspace.connectionState !== "connected"
    )
      continue;
    if (!workspace) continue;
    const activity = getTaskListRowActivity(task);
    const phase = activity?.phase;
    const displayStatus =
      phase === "running" || phase === "prewarming"
        ? "running"
        : phase === "error"
          ? "error"
          : phase === "completedSuccess" || phase === "completedInterrupted"
            ? "completed"
            : task.status === "error" || task.status === "completed"
              ? task.status
              : "idle";
    tasks.push({
      taskId: task.taskId,
      title: task.title,
      workspacePath: task.workspacePath,
      ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      workspaceLabel: workspace.label,
      workspaceKind: workspace.kind,
      createdAt: task.createdAt,
      updatedAt: activity?.lastActivityAt ?? task.updatedAt,
      provider: task.provider,
      unreadAt: task.unreadAt,
      displayStatus,
      hasBackgroundWork: activity?.hasBackgroundWork,
      workflowActivity: activity?.workflowActivity,
      pinned: task.pinned,
      archived: task.archived,
    });
  }
  return {
    workspaces: [...byKey.values()],
    tasks,
    projects: [...projects].map(([workspaceKey, projectIds]) => ({ workspaceKey, projectIds })),
  };
}

export function useWebRemoteControlLegacyTaskSync({
  platform,
  tabs,
  enabled,
  rootlessLabel,
}: {
  platform: IPlatformService;
  tabs: WindowTabState[];
  enabled: boolean;
  rootlessLabel: string;
}): void {
  const directory = useOptionalProjectDirectory();
  const [status, setStatus] = useState<WebRemoteControlStatus>({ status: "idle" });
  useEffect(() => {
    if (!enabled || !platform.syncWebRemoteControlLegacyTasks) return;
    let disposed = false;
    let statusRevision = 0;
    const stop = platform.onWebRemoteControlStatusChanged?.((next) => {
      statusRevision++;
      if (!disposed) setStatus(next);
    });
    void platform
      .getWebRemoteControlStatus()
      .then((next) => {
        // 订阅先于初始读取；迟到的读取不能把刚开启/停止的连接覆盖回旧状态。
        if (!disposed && statusRevision === 0) setStatus(next);
      })
      .catch((error) => {
        if (!disposed) logger.warn("[web-remote-control] 读取连接状态失败", error);
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [enabled, platform]);
  useEffect(() => {
    if (
      !enabled ||
      !directory ||
      directory.loading ||
      !status.sessionId ||
      status.connection?.mode !== "official" ||
      !["running", "connecting", "active"].includes(status.status)
    )
      return;
    const { tasks, ...snapshot } = buildLegacyRemoteDirectorySnapshot(
      buildWebRemoteControlWorkspaceTargets({ tabs }),
      directory.tree,
      rootlessLabel,
    );
    platform.syncWebRemoteControlLegacyTasks?.(tasks, {
      ...snapshot,
      windowControlSessionId: status.sessionId,
    });
  }, [enabled, platform, tabs, directory?.tree, directory?.loading, status, rootlessLabel]);
}
