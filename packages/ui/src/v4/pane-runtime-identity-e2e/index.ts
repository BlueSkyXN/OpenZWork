// WT04 direct 证据的 pane 侧观察面（docs/specs/wt04-direct-runtime-association-openzwork.md）。
// 仅当「E2E store bridge 构建开关打开 + 页面携带有效 E2E run ID」时，被测 pane 用
// 「自己当前注入的服务 + Provider 已解析 scope」独立查询 workspace runtime identity，
// 并把结果注册到 window 诊断表；注册随 pane 生命周期清理，查询失败按错误条目记录
// （验收端把缺证据/错误明确判失败）。任一条件缺失（含生产构建）不注册诊断入口、
// 不做额外查询。桌面 renderer 的 run ID 由 main 经加载 URL 参数注入
// （desktopHostProcess 的 zcodeE2eRunId）；手机 Web 由 E2E helper 在配对 URL 追加。
import { useEffect, useMemo } from "react";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import { useOptionalServices } from "@/hooks/useServices.js";

/** renderer URL 中携带 E2E run ID 的参数名（main/测试 helper 注入，生产构建不存在）。 */
export const PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM = "zcodeE2eRunId";

/** pane 诊断启用判定（纯函数，供装配矩阵测试）：build flag 与有效 run ID 缺一不可。 */
export function shouldEnablePaneRuntimeIdentityE2E(input: {
  bridgeFlagEnabled: boolean;
  runId: string | null | undefined;
}): boolean {
  return input.bridgeFlagEnabled && Boolean(input.runId?.trim());
}

export function readPaneRuntimeIdentityE2ERunId(): string | null {
  if (typeof window === "undefined") return null;
  // 桌面 renderer：main 经加载 URL 注入。手机 Web：SPA 路由会重写 URL，配对 URL 也
  // 不能附加参数（一次性 token 对参数敏感，实测附加即配对失败）；E2E 上下文经
  // addInitScript 种入 sessionStorage（与凭据种子同模式），生产环境两者皆不存在。
  const fromUrl = new URLSearchParams(window.location.search).get(
    PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM,
  );
  if (fromUrl?.trim()) return fromUrl;
  const fromStorage = window.sessionStorage?.getItem(PANE_RUNTIME_IDENTITY_E2E_RUN_ID_PARAM);
  return fromStorage?.trim() || null;
}

export interface PaneRuntimeIdentityE2ETarget {
  workspacePath: string;
  workspaceIdentity: string | null;
  remoteSessionId: string | null;
}

export type PaneRuntimeIdentityE2EEntry =
  | {
      status: "ok";
      identity: string;
      generation: number;
      processId?: number;
      workspaceKey: string;
      queriedAt: string;
      target: PaneRuntimeIdentityE2ETarget;
    }
  | {
      status: "error";
      error: string;
      queriedAt: string;
      target: PaneRuntimeIdentityE2ETarget;
    };

declare global {
  interface Window {
    __zcodePaneRuntimeIdentityE2E?: Record<string, PaneRuntimeIdentityE2EEntry | null>;
    /** E2E 触发某 pane 立即重查（existing-only 只读查询），用于同一挂载期内的前后对比。 */
    __zcodePaneRuntimeIdentityE2ERefresh?: Record<string, () => void>;
  }
}

export function readPaneRuntimeIdentityE2EEntries(): Record<
  string,
  PaneRuntimeIdentityE2EEntry | null
> {
  return (typeof window !== "undefined" && window.__zcodePaneRuntimeIdentityE2E) || {};
}

function writePaneRuntimeIdentityE2EEntry(
  paneKey: string,
  entry: PaneRuntimeIdentityE2EEntry | null,
): void {
  window.__zcodePaneRuntimeIdentityE2E = {
    ...readPaneRuntimeIdentityE2EEntries(),
    [paneKey]: entry,
  };
}

/**
 * pane 生命周期诊断：active（非 draft 且 pane 在使用中）时查询一次，scope 变化重查，
 * 卸载/失活清空本 pane 条目；E2E 可经 `__zcodePaneRuntimeIdentityE2ERefresh[paneKey]`
 * 在同一挂载期内触发重查（查看前/后对比）。查询走 pane 注入的 zcodeSessionService
 * （与 V4 会话订阅同一 accessor/服务端口），workspaceKey 按 `identity?.trim() || path`
 * 回落对齐产品合同。
 */
export function usePaneRuntimeIdentityE2E(input: {
  paneKey: string;
  workspacePath: string | undefined;
  workspaceIdentity: string | null | undefined;
  remoteSessionId: string | null | undefined;
  active: boolean;
}): void {
  const services = useOptionalServices();
  const enabled = shouldEnablePaneRuntimeIdentityE2E({
    bridgeFlagEnabled: shouldExposeE2EStoreBridge(),
    runId: readPaneRuntimeIdentityE2ERunId(),
  });
  const target = useMemo<PaneRuntimeIdentityE2ETarget>(
    () => ({
      workspacePath: input.workspacePath ?? "",
      workspaceIdentity: input.workspaceIdentity?.trim() || null,
      remoteSessionId: input.remoteSessionId?.trim() || null,
    }),
    [input.workspacePath, input.workspaceIdentity, input.remoteSessionId],
  );
  useEffect(() => {
    if (!enabled || !services || !input.active || !target.workspacePath) return;
    let cancelled = false;
    const runQuery = () => {
      const queriedAt = new Date().toISOString();
      services!.zcodeSessionService
        .getWorkspaceRuntimeIdentity({
          workspacePath: target.workspacePath,
          ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
          ...(target.remoteSessionId ? { remoteSessionId: target.remoteSessionId } : {}),
        })
        .then((identity) => {
          if (cancelled) return;
          writePaneRuntimeIdentityE2EEntry(input.paneKey, {
            status: "ok",
            identity: identity.identity,
            generation: identity.generation,
            ...(identity.processId !== undefined ? { processId: identity.processId } : {}),
            workspaceKey: identity.workspaceKey,
            queriedAt,
            target,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          writePaneRuntimeIdentityE2EEntry(input.paneKey, {
            status: "error",
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            queriedAt,
            target,
          });
        });
    };
    runQuery();
    // 只在 E2E 构建注册按需重查入口；卸载时一并清理，不留跨 pane 闭包。
    window.__zcodePaneRuntimeIdentityE2ERefresh = {
      ...(window.__zcodePaneRuntimeIdentityE2ERefresh ?? {}),
      [input.paneKey]: runQuery,
    };
    return () => {
      cancelled = true;
      writePaneRuntimeIdentityE2EEntry(input.paneKey, null);
      const refresh = { ...(window.__zcodePaneRuntimeIdentityE2ERefresh ?? {}) };
      delete refresh[input.paneKey];
      window.__zcodePaneRuntimeIdentityE2ERefresh = refresh;
    };
  }, [enabled, services, input.active, input.paneKey, target]);
}
