export type AppShutdownKind = "normal";

interface AppShutdownPolicy {
  forceKillDelayMs: number;
  waitTimeoutMs: number;
}

interface AppShutdownPolicySelection {
  kind: AppShutdownKind;
  policy: AppShutdownPolicy;
  upgraded: boolean;
}

const STRICT_SHUTDOWN_POLICY: AppShutdownPolicy = {
  forceKillDelayMs: 7_500,
  waitTimeoutMs: 9_000,
};

const WINDOWS_NORMAL_SHUTDOWN_POLICY: AppShutdownPolicy = {
  // 普通退出仍给 Host 内部 3.5 秒进程树兜底留出执行时间，
  // 但不再承担更新前资源锁扫描所需的额外余量。
  forceKillDelayMs: 4_000,
  waitTimeoutMs: 4_500,
};

export function resolveAppShutdownPolicy(
  kind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicy {
  if (platform === "win32" && kind === "normal") {
    return WINDOWS_NORMAL_SHUTDOWN_POLICY;
  }
  return STRICT_SHUTDOWN_POLICY;
}

export function selectAppShutdownPolicy(
  activeKind: AppShutdownKind | null,
  requestedKind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicySelection {
  // 更新安装的升级融合逻辑已随强更/更新链移除；退出策略只保留普通退出一种。
  const kind: AppShutdownKind = "normal";
  return {
    kind,
    policy: resolveAppShutdownPolicy(kind, platform),
    upgraded: false,
  };
}
