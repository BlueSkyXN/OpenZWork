import { useCallback, useEffect, useState } from "react";
import {
  systemPromptSettingsSchema,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";

export function useSystemPromptSettings() {
  const { zcodeAgentService, settingService } = useServices();
  const { settings, loading, error, update, refresh } = useSettings();
  const [catalog, setCatalog] = useState<SystemPromptCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null);
    setCatalogError(null);
    void zcodeAgentService.getSystemPromptCatalog().then(
      (result) => {
        if (active) setCatalog(result);
      },
      (error: unknown) => {
        if (active) setCatalogError(error);
      },
    );
    return () => {
      active = false;
    };
  }, [zcodeAgentService, revision]);
  const save = useCallback(
    async (next: SystemPromptSettings, expected: SystemPromptSettings | null) => {
      const validated = systemPromptSettingsSchema.parse(next);
      await update({ systemPromptSettings: validated }, { expectedSystemPromptSettings: expected });
      const committed = await settingService.get();
      return systemPromptSettingsSchema.parse(committed.systemPromptSettings);
    },
    [settingService, update],
  );
  return {
    settings: settings?.systemPromptSettings ?? null,
    // 刷新已加载的设置不能卸载编辑器，否则保存中的草稿与失败状态会丢失。
    loading: loading && settings === null,
    error: catalogError ?? (settings === null ? error : null),
    catalog,
    save,
    retry: () => {
      setRevision((current) => current + 1);
      void refresh();
    },
  };
}
