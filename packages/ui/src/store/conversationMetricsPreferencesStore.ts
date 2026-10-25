import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";
import {
  DEFAULT_METRICS_DISPLAY_PREFERENCES,
  METRICS_PREFERENCES_STORAGE_KEY,
  metricsPreferencesEqual,
  normalizeMetricsDisplayPreferences,
  type MetricsDisplayPreferences,
} from "@/conversation-metrics/contract.js";

interface PreferencesState {
  preferences: MetricsDisplayPreferences;
  update(patch: Partial<Pick<MetricsDisplayPreferences, "enabled" | "visibleFields">>): void;
  reset(): void;
}

/** 同 renderer 唯一 owner；不把显示偏好发到连接中的 Host。 */
export function createConversationMetricsPreferencesStore(storage: BrowserStorageLike | null) {
  const read = (): MetricsDisplayPreferences | undefined => {
    if (!storage) return undefined;
    let raw: string | null;
    try {
      raw = storage.getItem(METRICS_PREFERENCES_STORAGE_KEY);
    } catch {
      return undefined;
    }
    try {
      return normalizeMetricsDisplayPreferences(raw ? JSON.parse(raw) : null);
    } catch {
      // 坏 JSON 只回退本分组；存储不可读的情形由上方保留已有内存偏好。
      return DEFAULT_METRICS_DISPLAY_PREFERENCES;
    }
  };
  const store = createStore<PreferencesState>((set, get) => {
    const update: PreferencesState["update"] = (patch) => {
      const next = normalizeMetricsDisplayPreferences({ ...get().preferences, ...patch });
      if (metricsPreferencesEqual(next, get().preferences)) return;
      set({ preferences: next });
      try {
        storage?.setItem(METRICS_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 无法持久化时仍保留本窗口选择，不影响会话。
      }
    };
    return {
      preferences: read() ?? DEFAULT_METRICS_DISPLAY_PREFERENCES,
      update,
      reset: () => update(DEFAULT_METRICS_DISPLAY_PREFERENCES),
    };
  });
  const refresh = () => {
    const next = read();
    if (next && !metricsPreferencesEqual(next, store.getState().preferences)) {
      store.setState({ preferences: next });
    }
  };
  let consumers = 0;
  let cleanup: (() => void) | undefined;
  const connect = (target: EventTarget) => {
    if (consumers++ === 0) {
      const receive = (event: Event) => {
        const key = (event as StorageEvent).key;
        if (key === null || key === METRICS_PREFERENCES_STORAGE_KEY) refresh();
      };
      target.addEventListener("storage", receive);
      target.addEventListener("focus", refresh);
      cleanup = () => {
        target.removeEventListener("storage", receive);
        target.removeEventListener("focus", refresh);
      };
      // 重新挂载时重新读保存值，避免所有消费者卸载期间漏掉的 storage 事件。
      refresh();
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--consumers === 0) {
        cleanup?.();
        cleanup = undefined;
      }
    };
  };
  return { store, refresh, connect };
}

export const conversationMetricsPreferences =
  createConversationMetricsPreferencesStore(getSafeLocalStorage());

export function useConversationMetricsPreferences(): MetricsDisplayPreferences {
  useEffect(() => {
    if (typeof window !== "undefined") return conversationMetricsPreferences.connect(window);
  }, []);
  return useStore(conversationMetricsPreferences.store, (state) => state.preferences);
}
