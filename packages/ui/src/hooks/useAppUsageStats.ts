import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBaseWorkspaceServices } from "./useWorkspaceServices.js";
import { getLocalAppUsageService } from "./appUsageServiceAccess.js";

interface AppUsageState {
  source?: ReturnType<typeof getLocalAppUsageService>;
  loading: boolean;
  data: AppUsageSnapshot | null;
  error: string | null;
}

const INITIAL_STATE: AppUsageState = { loading: false, data: null, error: null };

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
export function useAppUsageStats(
  range: AppUsageRange,
  options: { enabled?: boolean; refreshKey?: string | number } = {},
) {
  const enabled = options.enabled !== false;
  const services = useBaseWorkspaceServices();
  const appUsageService = getLocalAppUsageService(services);
  const [state, setState] = useState<AppUsageState>(INITIAL_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!appUsageService || !enabled) {
      requestVersionRef.current += 1;
      setState(INITIAL_STATE);
      return () => {
        disposed = true;
      };
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState((current) => ({ ...current, loading: true, error: null }));
    void appUsageService
      .getAppUsageStats({ range, timeZone: getTimeZone() })
      .then((data) => {
        if (disposed || requestVersionRef.current !== requestVersion) return;
        setState({ source: appUsageService, loading: false, data, error: null });
      })
      .catch((error: unknown) => {
        if (disposed || requestVersionRef.current !== requestVersion) return;
        setState({
          source: appUsageService,
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [appUsageService, enabled, range, reloadToken, options.refreshKey]);

  return {
    ...(enabled && state.source === appUsageService ? state : INITIAL_STATE),
    loading: enabled && state.loading,
    available: Boolean(appUsageService),
    refresh,
  };
}
