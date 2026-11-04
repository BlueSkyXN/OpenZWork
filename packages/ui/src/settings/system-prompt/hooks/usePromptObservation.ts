import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemPromptObservationResult, SystemPromptSettings } from "@zcode/shared";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";

export interface PromptSessionTarget {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  label: string;
  key: string;
}

export function usePromptSessionTargets(): PromptSessionTarget[] {
  const tabs = useOptionalTabStore((state) => state.tabs);
  const workspaces = useZCodeSessionStore((state) => state.workspaces);
  return useMemo(
    () =>
      (tabs ?? []).filter(isWorkspaceTab).flatMap((tab) => {
        const identity = tab.workspaceIdentity?.trim() || tab.workspacePath;
        const workspace = workspaces[identity];
        const tasks = workspace?.taskListCache ?? [];
        const targets = tasks.map((task) => ({ sessionId: task.taskId, title: task.title }));
        if (
          workspace?.activeTaskId &&
          !targets.some((task) => task.sessionId === workspace.activeTaskId)
        )
          targets.unshift({ sessionId: workspace.activeTaskId, title: workspace.activeTaskId });
        return targets.map((task) => ({
          sessionId: task.sessionId,
          workspacePath: tab.workspacePath,
          workspaceIdentity: tab.workspaceIdentity ?? undefined,
          remoteSessionId: tab.remoteSessionId,
          label: `${task.title} · ${tab.workspacePath}`,
          key: JSON.stringify([identity, tab.remoteSessionId, task.sessionId]),
        }));
      }),
    [tabs, workspaces],
  );
}

export function usePromptObservation(target: PromptSessionTarget | undefined) {
  const resolution = useWorkspaceServicesResolution(
    target?.workspacePath,
    target?.remoteSessionId,
    target?.workspaceIdentity,
  );
  const service = resolution.services.zcodeAgentService;
  const key = JSON.stringify([target?.key, resolution.remoteSessionId]);
  const sequence = useRef(0);
  const [state, setState] = useState<{
    key: string;
    service: typeof service;
    data?: SystemPromptObservationResult;
    error?: string;
    loading: boolean;
    comparedDraft?: string;
  } | null>(null);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [key, service],
  );
  const read = useCallback(
    async (settings?: SystemPromptSettings, snapshotId?: string) => {
      if (!target) return;
      const current = ++sequence.current;
      setState({ key, service, loading: true });
      try {
        if (!resolution.rpcReady) throw new Error("Remote unavailable");
        const data = await service.readSessionSystemPrompt({
          workspacePath: target.workspacePath,
          workspaceIdentity: target.workspaceIdentity,
          remoteSessionId: resolution.remoteSessionId ?? target.remoteSessionId,
          sessionId: target.sessionId,
          settings,
          snapshotId,
        });
        if (current === sequence.current)
          setState({
            key,
            service,
            data,
            loading: false,
            comparedDraft: settings ? JSON.stringify(settings) : undefined,
          });
      } catch (error) {
        if (current === sequence.current)
          setState({
            key,
            service,
            loading: false,
            error:
              error && typeof error === "object" && "code" in error && error.code === -32601
                ? "unsupported"
                : "actualError",
          });
      }
    },
    [key, service, target, resolution.rpcReady, resolution.remoteSessionId],
  );
  const visible = state?.key === key && state.service === service ? state : null;
  return { ...visible, read };
}
