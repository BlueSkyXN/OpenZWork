import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderModelDiscoveryResult } from "@zcode/provider";
import { useServices } from "./useServices.js";

interface DiscoveryState {
  providerId: string;
  loading: boolean;
  result: ProviderModelDiscoveryResult | null;
}
/** 候选是当前打开代际的只读结果；关闭和换 Provider 后不能复活旧列表。 */
export function useProviderModelDiscovery(providerId: string, open: boolean) {
  const { providerSettingsService } = useServices();
  const [state, setState] = useState<DiscoveryState>({ providerId, loading: false, result: null });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const current = ++generation.current;
    if (!open) {
      setState({ providerId, loading: false, result: null });
      return;
    }
    setState({ providerId, loading: true, result: null });
    void providerSettingsService
      .discoverModels(providerId)
      .then((result) => {
        if (current === generation.current) setState({ providerId, loading: false, result });
      })
      .catch(() => {
        if (current === generation.current)
          setState({ providerId, loading: false, result: { ok: false, error: "request-failed" } });
      });
    return () => {
      generation.current += 1;
    };
  }, [providerSettingsService, providerId, open, revision]);
  const add = useCallback(
    async (modelId: string) => {
      const resolution = await providerSettingsService.resolveModelConfig({ providerId, modelId });
      if (resolution.issues.length) throw new Error("model-config-incomplete");
      return resolution;
    },
    [providerSettingsService, providerId],
  );
  return {
    ...(open && state.providerId === providerId
      ? state
      : { providerId, loading: false, result: null }),
    refresh,
    resolve: add,
  };
}
