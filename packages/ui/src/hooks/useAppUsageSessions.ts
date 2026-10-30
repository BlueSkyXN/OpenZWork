import type { AppUsageRange, AppUsageSessionsPage } from "@zcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { getLocalAppUsageService } from "./appUsageServiceAccess.js";

interface AppUsageSessionsState {
  source?: ReturnType<typeof getLocalAppUsageService>;
  scopeKey?: string;
  loading: boolean;
  data: AppUsageSessionsPage | null;
  error: string | null;
  errorCode?: string;
}

const INITIAL_STATE: AppUsageSessionsState = { loading: false, data: null, error: null };

function getTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone && Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone) {
      return timeZone;
    }
  } catch {
    // 本地 Intl 无法提供有效 IANA 时区时，协议使用稳定的 UTC 默认口径。
  }
  return "UTC";
}

/** 请求版本状态归 hook；range 由页面传入，local service 不可用时不发 RPC。 */
export function useAppUsageSessions(
  range: AppUsageRange,
  options: {
    enabled?: boolean;
    refreshKey?: string | number;
    projectId?: string | null;
    offset: number;
    limit: number;
    until?: number;
  },
) {
  const enabled = options.enabled !== false;
  const scopeKey = JSON.stringify([
    range,
    options.projectId === undefined ? "all" : { projectId: options.projectId },
    options.offset,
    options.limit,
    options.until,
  ]);
  const services = useBaseWorkspaceServices();
  const appUsageService = getLocalAppUsageService(services);
  const [state, setState] = useState<AppUsageSessionsState>(INITIAL_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!appUsageService || !enabled) {
      requestVersionRef.current += 1;
      if (!appUsageService) setState(INITIAL_STATE);
      return () => {
        disposed = true;
      };
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState((current) => ({ ...current, loading: true, error: null }));
    void appUsageService
      .getAppUsageSessions({
        range,
        timeZone: getTimeZone(),
        ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
        offset: options.offset,
        limit: options.limit,
        ...(options.until !== undefined ? { until: options.until } : {}),
      })
      .then((data) => {
        if (disposed || requestVersionRef.current !== requestVersion) return;
        setState({ source: appUsageService, scopeKey, loading: false, data, error: null });
      })
      .catch((error: unknown) => {
        if (disposed || requestVersionRef.current !== requestVersion) return;
        setState({
          source: appUsageService,
          scopeKey,
          loading: false,
          data: null,
          errorCode:
            typeof error === "object" && error !== null && "code" in error
              ? String(error.code)
              : undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    appUsageService,
    enabled,
    range,
    reloadToken,
    options.refreshKey,
    options.projectId,
    options.offset,
    options.limit,
    options.until,
    scopeKey,
  ]);

  return {
    ...(enabled && state.source === appUsageService && state.scopeKey === scopeKey
      ? state
      : INITIAL_STATE),
    loading: enabled && state.loading,
    projects: state.source === appUsageService ? (state.data?.projects ?? []) : [],
    available: Boolean(appUsageService),
    refresh,
  };
}
