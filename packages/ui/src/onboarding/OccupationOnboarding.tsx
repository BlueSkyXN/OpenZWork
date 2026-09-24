import { OnboardingHeader } from "@/onboarding/OnboardingHeader.js";
import { OccupationOnboardingVisual } from "@/onboarding/OccupationOnboardingVisual.js";
import { occupations, type OccupationValue } from "@/onboarding/occupationOptions.js";
import { OnboardingModeSelector } from "@/onboarding/OnboardingModeSelector.js";
import { OnboardingOccupationGrid } from "@/onboarding/OnboardingOccupationGrid.js";
import {
  shouldShowOccupationOnboarding,
  shouldWaitForOccupationOnboardingSettings,
} from "@/onboarding/onboardingVisibility.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettingService.js";
import { useEffectiveShortcutBindings } from "@/shortcuts/useShortcutBindings.js";
import { matchesShortcutBinding } from "@/shortcuts/bindings.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import type { InterfaceMode } from "@/lib/interfaceMode.js";
import { logger } from "@/logger.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";

export function OccupationOnboarding({
  children,
  showWindowControls = false,
  showChildrenWhileLoading = false,
  isMacDesktop,
  isWindowsDesktop,
}: {
  children: ReactNode;
  /** Windows/Linux 自绘窗控：引导全屏覆盖主界面（含标题栏），需在此补最小化/最大化/关闭。 */
  showWindowControls?: boolean;
  /** 独立设置页不依赖引导设置加载，避免应用级引导外层遮住设置内容。 */
  showChildrenWhileLoading?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
}) {
  const { settings, update } = useSettings();
  const shortcutBindings = useEffectiveShortcutBindings();
  const storeRequested = useZCodeStore((state) => state.newUserOnboardingOpen);
  const setStoreRequested = useZCodeStore((state) => state.setNewUserOnboardingOpen);
  const [localRequested, setLocalRequested] = useState(false);
  const requested = storeRequested || localRequested;
  const setRequested = useCallback(
    (open: boolean) => {
      setLocalRequested(open);
      setStoreRequested(open);
    },
    [setLocalRequested, setStoreRequested],
  );
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `occupationOnboarding.${key}` });
  const [occupation, setOccupation] = useState<OccupationValue | null>("developer");
  const savedInterfaceMode = useZCodeStore((state) => state.interfaceMode);
  const setInterfaceMode = useZCodeStore((state) => state.setInterfaceMode);
  // mode 为 null 表示模式页被跳过；落 settings 时沿用既有保守默认值。
  const [mode, setMode] = useState<InterfaceMode | null>(savedInterfaceMode);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const preferences = step === 2;
  const requestOnboardingDialog = useZCodeStore((state) => state.requestOnboardingDialog);
  const [migration, setMigration] = useState(false);
  const [memory, setMemory] = useState(savedInterfaceMode === "office");
  const [suggestions, setSuggestions] = useState(savedInterfaceMode === "office");
  const suggestionsEditedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState(false);
  const [locallyClosed, setLocallyClosed] = useState(false);
  const onboardingVisible = shouldShowOccupationOnboarding({
    requested,
    hasStoredOccupation: Boolean(settings?.onboardingOccupation),
    dismissed: settings?.occupationOnboardingDismissed === true,
    closedThisSession: locallyClosed,
  });
  const closeOnboarding = useCallback(() => {
    if (savingRef.current) return;
    setStep(0);
    setLocallyClosed(true);
    setRequested(false);
    // 首次引导关闭态只写本地 AppSettings 去重位，不创建设备/账户锚定的记录文件。
    void update({ occupationOnboardingDismissed: true }).catch((cause: unknown) => {
      logger.warn("[occupation-onboarding] 写入本地关闭状态失败", { error: String(cause) });
    });
  }, [setRequested, update]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        shortcutBindings.toggleInterfaceMode.some((binding) =>
          matchesShortcutBinding(event, binding),
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (saving) return;
        const nextMode = savedInterfaceMode === "office" ? "coding" : "office";
        setInterfaceMode(nextMode);
        setMode(nextMode);
        if (nextMode !== mode) {
          setMemory(nextMode === "office");
          if (nextMode === "office" && !suggestionsEditedRef.current) setSuggestions(true);
        }
        return;
      }
      if (event.key === "Escape" && onboardingVisible && !saving) {
        // 直接退出不改偏好；首次引导会持久化 dismissed，避免下次启动重复展示。
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOnboarding();
        return;
      }
      if (
        !shortcutBindings.openOnboarding.some((binding) => matchesShortcutBinding(event, binding))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (saving) return;
      // 手动重新打开的引导关闭时只保留本机关闭状态，不改写已保存偏好。
      if (onboardingVisible) {
        closeOnboarding();
      } else {
        setRequested(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    closeOnboarding,
    shortcutBindings,
    setRequested,
    onboardingVisible,
    saving,
    savedInterfaceMode,
    setInterfaceMode,
    mode,
  ]);
  const resetDraft = useCallback(() => {
    setStep(0);
    // 手动重开只从唯一 owner AppSettings 恢复已存偏好；首次配置沿用旧的模式默认值。
    const hasSavedPreferences =
      Boolean(settings?.onboardingOccupation) || settings?.occupationOnboardingDismissed === true;
    const storedOccupation = settings?.onboardingOccupation;
    setOccupation(
      storedOccupation && (occupations as readonly string[]).includes(storedOccupation)
        ? (storedOccupation as OccupationValue)
        : "developer",
    );
    setMode(savedInterfaceMode);
    setMemory(
      hasSavedPreferences ? settings?.memoryEnabled === true : savedInterfaceMode === "office",
    );
    setSuggestions(settings?.proactiveSuggestionsEnabled ?? savedInterfaceMode === "office");
    setMigration(false);
    setError(false);
  }, [savedInterfaceMode, settings]);
  const markUserEdited = useCallback(() => setLocallyClosed(false), []);
  useEffect(() => {
    if (!onboardingVisible) return;
    suggestionsEditedRef.current = false;
    resetDraft();
  }, [onboardingVisible, resetDraft]);
  if (shouldWaitForOccupationOnboardingSettings({ settingsLoaded: settings !== null, requested })) {
    return showChildrenWhileLoading ? <>{children}</> : null;
  }
  if (!settings) return showChildrenWhileLoading ? <>{children}</> : null;
  if (!onboardingVisible) return <>{children}</>;
  const save = async (skip = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    try {
      if (mode) setInterfaceMode(mode);
      logger.info("[occupation-onboarding] 保存偏好", { interfaceMode: mode });
      await update({
        // 跳过沿用既有保守默认值（职业 other / Memory 与主动推荐关闭）。
        onboardingOccupation: occupation ?? "other",
        // 首次引导与显式快捷键重开走同一设置路径；完成时只写本地去重位。
        occupationOnboardingDismissed: true,
        memoryEnabled: skip ? false : memory,
        proactiveSuggestionsEnabled: !skip && mode === "office" && suggestions,
      });
      // AppSettings 本地写入成功就是引导完成边界；不再派生账号/设备关联记录或上报状态。
      setStep(0);
      setLocallyClosed(true);
      setRequested(false);
      if (!skip && migration) requestOnboardingDialog("migration");
      logger.info("[occupation-onboarding] 偏好保存完成", { interfaceMode: mode });
    } catch (cause) {
      logger.warn("[occupation-onboarding] 保存偏好失败", { error: String(cause) });
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <main
      aria-label={t("title")}
      data-testid="onboarding-page"
      className="relative flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 [app-region:drag]" />
      {/* 与 Settings 相同，计入 Workspace 的 4px 外层留白、1px 边框和 8px 内边距。 */}
      {showWindowControls ? (
        <div className="absolute right-1 top-1 z-30 mt-px mr-px flex h-12 items-center px-2">
          <DesktopWindowControls />
        </div>
      ) : null}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2 lg:gap-1 lg:p-1">
        <div className="flex min-h-0 flex-col pt-12 [@media(max-height:740px)]:pt-10">
          <OnboardingHeader
            step={step}
            saving={saving}
            t={t}
            onBack={() => setStep(step === 2 ? 1 : 0)}
            onClose={closeOnboarding}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 sm:px-10">
            {/* 自动外边距让短内容居中，长内容从顶部正常滚动，不影响固定导航。 */}
            <div className="mx-auto my-auto w-full max-w-lg shrink-0">
              <section className="flex w-full flex-col">
                <div className="w-full">
                  <h1 className="text-ui-xl font-semibold tracking-tight text-center">
                    {t(preferences ? "preferences" : step === 1 ? "modeTitle" : "title")}
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-center text-ui-base leading-relaxed text-foreground-subtle">
                    {t(
                      preferences
                        ? "preferencesDescription"
                        : step === 1
                          ? "modeDescription"
                          : "description",
                    )}
                  </p>
                  {step === 1 ? (
                    <OnboardingModeSelector
                      mode={mode}
                      saving={saving}
                      onSelect={(value) => {
                        markUserEdited();
                        // 重选当前编程模式也应清除旧记录带来的默认勾选。
                        setMemory(value === "office");
                        if (value !== mode) {
                          if (value === "office" && !suggestionsEditedRef.current)
                            setSuggestions(true);
                        }
                        setMode(value);
                      }}
                      label={t("modeTitle")}
                      formatLabel={(key) => t(key)}
                    />
                  ) : preferences ? (
                    <div className="mt-8 space-y-3">
                      {(["suggestions", "memory", "migration"] as const)
                        .filter((key) => key !== "suggestions" || mode === "office")
                        .map((key) => (
                          <label
                            key={key}
                            className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-card dark:bg-surface/40 p-5 text-ui-base transition-colors hover:bg-surface-hover"
                          >
                            <Checkbox
                              checked={
                                key === "migration"
                                  ? migration
                                  : key === "memory"
                                    ? memory
                                    : suggestions
                              }
                              disabled={saving}
                              onCheckedChange={(checked) => {
                                markUserEdited();
                                if (key === "migration") setMigration(checked === true);
                                else if (key === "memory") setMemory(checked === true);
                                else {
                                  suggestionsEditedRef.current = true;
                                  setSuggestions(checked === true);
                                }
                              }}
                            />
                            <span className="font-medium">{t(key)}</span>
                            <span className="col-start-2 text-ui-sm font-normal text-foreground-subtle">
                              {t(`${key}Description`)}
                            </span>
                          </label>
                        ))}
                    </div>
                  ) : (
                    <OnboardingOccupationGrid
                      occupation={occupation}
                      saving={saving}
                      onSelect={(value) => {
                        markUserEdited();
                        setOccupation(value);
                      }}
                      label={t("title")}
                      formatLabel={(value) => t(value)}
                    />
                  )}
                  {error ? (
                    <p role="alert" className="mt-4 text-ui-sm text-destructive">
                      {t("error")}
                    </p>
                  ) : null}
                </div>
                <footer className="mt-6 flex flex-col gap-3 [@media(max-height:740px)]:mt-4 [@media(max-height:740px)]:gap-1">
                  <Button
                    variant="link"
                    disabled={saving}
                    className="order-2 h-9 self-center rounded-xl px-3 text-ui-base text-foreground-subtle"
                    onClick={() => {
                      markUserEdited();
                      if (preferences) void save(true);
                      else {
                        if (step === 0) setOccupation(null);
                        else setMode(null);
                        setStep(step === 0 ? 1 : 2);
                      }
                    }}
                  >
                    {t("skip")}
                  </Button>
                  <div className="flex w-full gap-3">
                    <Button
                      disabled={saving || (step === 0 && !occupation)}
                      className="h-11 flex-1 rounded-xl px-5 text-ui-base"
                      onClick={() => {
                        if (!preferences) setStep(step === 0 ? 1 : 2);
                        else void save();
                      }}
                    >
                      {t(saving ? "saving" : preferences ? "start" : "continue")}
                    </Button>
                  </div>
                </footer>
              </section>
            </div>
          </div>
        </div>
        <OccupationOnboardingVisual
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
        />
      </div>
    </main>
  );
}
