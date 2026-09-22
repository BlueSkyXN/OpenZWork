// Modified for the private fork, 2026-09-21: custom providers only — official
// account/preset/coding-plan navigation was removed together with the account services.
import { useEffect, useMemo } from "react";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import type { ProviderOrderView } from "@/lib/modelProviderOrdering.js";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelProviderNavGroup, ModelProviderNavItem } from "./constants.js";
import { createCustomProviderNodeKey } from "./utils.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

export function useModelProviderNavigation({
  modelProviders,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const customProviders = useMemo(() => {
    const allCustomProviders = modelProviders.filter(
      (provider) => provider.config.group === "standard-personal",
    );
    // 这里复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    return sortModelProvidersForDisplay(allCustomProviders, displayOrder);
  }, [displayOrder, modelProviders]);

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(
    () => [
      {
        id: "custom" as const,
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "custom" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ],
    // 左侧导航分组标题在这个 memo 内格式化。
    // 语言切换时 provider 引用可能不变，必须依赖 intl 才能刷新旧 locale 的文案。
    [customProviders, intl],
  );

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );
  const navigationItemByKey = useMemo(
    () => new Map<string, ModelProviderNavItem>(navigationItems.map((item) => [item.key, item])),
    [navigationItems],
  );

  const selectedNavItem = selectedNodeKey ? (navigationItemByKey.get(selectedNodeKey) ?? null) : null;

  // 初始化只在没有有效选中项时发生；如果当前用户选择仍有效，不抢焦点。
  const fallbackNodeKey = navigationItems[0]?.key ?? null;
  useEffect(() => {
    if (selectedNodeKey && navigationItemByKey.has(selectedNodeKey)) {
      return;
    }
    if (selectedNodeKey !== fallbackNodeKey) {
      setSelectedNodeKey(fallbackNodeKey);
    }
  }, [fallbackNodeKey, navigationItemByKey, selectedNodeKey, setSelectedNodeKey]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
    navigationUnavailable: false,
  };
}
