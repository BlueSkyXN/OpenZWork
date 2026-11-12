export type AppShutdownKind = "normal";

export interface AppShutdownPolicy {
  forceKillDelayMs: number;
  waitTimeoutMs: number;
}

export interface AppShutdownPolicySelection {
  kind: AppShutdownKind;
  policy: AppShutdownPolicy;
  upgraded: boolean;
}

const STRICT_SHUTDOWN_POLICY: AppShutdownPolicy = {
  forceKillDelayMs: 7_500,
  waitTimeoutMs: 9_000,
};

export function resolveAppShutdownPolicy(
  _kind: AppShutdownKind,
  _platform: NodeJS.Platform,
): AppShutdownPolicy {
  return STRICT_SHUTDOWN_POLICY;
}

export function selectAppShutdownPolicy(
  activeKind: AppShutdownKind | null,
  requestedKind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicySelection {
  const kind = requestedKind;
  return {
    kind,
    policy: resolveAppShutdownPolicy(kind, platform),
    upgraded: false,
  };
}
