export interface OccupationOnboardingVisibilityInput {
  requested: boolean;
  hasStoredOccupation: boolean;
  dismissed: boolean;
  closedThisSession: boolean;
}

/** 只依据本地 AppSettings 与当前 UI 请求决定首次引导展示，不读取设备/账号身份。 */
export function shouldShowOccupationOnboarding(
  input: OccupationOnboardingVisibilityInput,
): boolean {
  return (
    input.requested || (!input.hasStoredOccupation && !input.dismissed && !input.closedThisSession)
  );
}

/** AppSettings 异步装载前等待首屏判定；显式快捷键打开时允许不等设置请求。 */
export function shouldWaitForOccupationOnboardingSettings(input: {
  settingsLoaded: boolean;
  requested: boolean;
}): boolean {
  return !input.settingsLoaded && !input.requested;
}
