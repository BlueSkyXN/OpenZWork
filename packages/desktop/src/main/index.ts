// Modified for the private fork, 2026-09-21: remove product/telemetry wiring in this file.

/* eslint-disable max-lines */
import "./desktopEarlyDataBaseDirBootstrap.js";
import "./desktopEarlyChromiumHardwareAccelerationBootstrap.js";
import { powerSaveBlocker } from "electron";
import "./appCrashCaptureBootstrap.js";
import {
  onLocalDatabaseStartupReady,
  configureDatabaseStartupQuit,
} from "./databaseStartupRelay.js";
import { ensureDesktopDeviceMidSync } from "./desktopDeviceMid.js";
import { buildBrowserViewCloseTabNotification } from "./browserView/browserCloseTabNotification.js";
import { BrowserGuestManager } from "./browserView/browserGuestManager.js";
import { createElectronBrowserWebmRecorder } from "./browserView/electronBrowserWebmRecorder.js";
import { installBrowserRestoreBootstrapProtocol } from "./browserView/browserRestoreBootstrapProtocol.js";
import {
  createLocalMediaPreviewPathRegistry,
  installLocalMediaPreviewProtocol,
  registerLocalMediaPreviewScheme,
} from "./localMediaPreviewProtocol.js";
import { createDesktopBrowserScreenshotSurfaceCoordinator } from "./browserView/browserScreenshotSurfaceCoordinatorWiring.js";
import { EMBEDDED_BROWSER_PARTITION } from "./browserDataManager.js";
import { EmbeddedBrowserJavaScriptDialogController } from "./embeddedBrowserJavaScriptDialog.js";
import {
  browserOperationResetsResizeBaseline,
  resolveBrowserOperationTabId,
} from "./browserView/browserOperationIndicator.js";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
  webContents,
} from "electron";
import type { UtilityProcess as ElectronUtilityProcess } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createSettingService,
  buildRuntimeProcessEnvPatch,
  captureLoginShellEnvSnapshot,
  getConversationWorkspaceDir,
  normalizeRuntimeProcessEnv,
  setDataBaseDir,
} from "@zcode/services/node";
import { DEFAULT_LOCALE, DEFAULT_ZCODE_ENDPOINT_ORIGIN, OPENZWORK_DATA_DIR_NAME, PlatformChannels, ZCODE_ENV, ZCODE_PRODUCT_FLAVOR, desktopMenuMessageIds, resolveZCodeEndpointOrigin, type AppSettings, type Locale } from "@zcode/shared";
import { logger } from "./logger.js";
import { markMainLaunchAppReady } from "./desktopLaunchMarks.js";
import { BroadcastHub } from "./broadcastHub.js";
import { TaskRealtimeBus } from "./taskRealtimeBus.js";
import {
  resolveAppShutdownPolicy,
  selectAppShutdownPolicy,
  type AppShutdownKind,
} from "./appShutdownPolicy.js";
import { createPrimaryWindowCoordinator } from "./primaryWindowCoordinator.js";
import { flushMainE2ECoverage } from "./e2eCoverage.js";
import { resolveStartupWindowBootstrap, type StartupWindowBootstrap } from "./startupWorkspace.js";
import {
  createStartupDeepLinkConsumptionGate,
  type ExplicitStartupWorkspaceRequest,
  resolveExplicitStartupWorkspaceBootstrap,
} from "./startupWorkspaceDeepLinkGate.js";
import { executeDesktopCommand } from "./desktopCommandHandlers.js";
import { clampDesktopZoomLevel, resolveDesktopZoomLevelFromFactor } from "./desktopZoom.js";
import {
  getDesktopMenuLabel as getDesktopMenuLabelByLocale,
  rebuildApplicationMenu,
  resolveSystemApplicationLocale,
  updateZCodeStdioTapDevMenuState,
} from "./desktopApplicationMenu.js";
import { applyAppIcon } from "./desktopWindowChrome.js";
import { resolveWindowsAppUserModelIdForFlavor } from "../../scripts/desktop-product-identity.mjs";
import type { DesktopWindowSize } from "./desktopWindowSize.js";
import { maybeWarnArchitectureMismatch } from "./desktopArchitectureGuard.js";
import { createWindowsDesktopTray, updateWindowsDesktopTrayMenu } from "./desktopTray.js";
import {
  configureDockMenu,
  createWindow,
  focusWorkspaceInExistingWindow,
  showCurrentWindowFromDock,
  syncApplicationUnreadBadge,
  handleDesktopWindowCloseRequest,
} from "./desktopWindowLifecycle.js";
import { resolveZCodeBuiltinProviderConfigFilePath } from "./desktopProviderConfig.js";
import {
  getCredentialsDir,
  isDockerDaemonAvailable,
  listSSHConfigAliases,
  listAvailableDockerContainers,
  listAvailableWSLDistros,
  loadHostProcessEnvFromLocalFiles,
  resolveRemoteAssetDirs,
  resolveZCodeEndpointEnvBaseOrigin,
  runtimeApplicationName,
  runtimeHomePath,
  runtimeSessionDataPath,
  runtimeUserDataPath,
  shouldUseElectronDefaultUserDataPath,
} from "./desktopRuntimeEnv.js";
import {
  disposeHostProcess,
  disposeHostProcessAndWait,
  listDisposingHostProcesses,
  spawnHostProcess,
} from "./desktopHostProcess.js";
import { spawnCronScheduler, type CronSchedulerHandle } from "./desktopCronScheduler.js";
import {
  clearDeepLinkRoutesForWindow,
  handleDeepLink,
  handleOpenWorkspacePath,
  registerDeepLinkProtocol,
  resolveExternalWorkspaceOpenDialogCopy,
} from "./desktopOAuthDeepLink.js";
import { handleSecondInstanceWorkspaceRequest } from "./desktopSecondInstanceDeepLink.js";
import { installFinderOpenFolderWorkflow } from "./desktopFinderOpenFolderWorkflow.js";
import { installWindowsOpenFolderContextMenu } from "./desktopWindowsOpenFolderContextMenu.js";
import {
  createDeepLinkSingleInstanceData,
  extractWorkspaceOpenPath,
  extractDeepLinkUrlFromArgs,
  extractOpenWorkspacePathFromArgs,
  isWorkspaceOpenUrl,
} from "./desktopDeepLinkUrl.js";
import { createRemoteWorkspaceSessionManager } from "./desktopRemoteSessions.js";
import { resolveCanonicalWslTarget } from "./desktopWslTargetResolver.js";
import {
  setBrowserUseGuestWebContentsIdsProvider,
} from "./resourceManagerWindow.js";
import { registerPlatformIpcHandlers } from "./desktopMainIpcPlatform.js";
import { registerRemoteIpcHandlers } from "./desktopMainIpcRemote.js";
import { applyDesktopChromiumNetworkPolicies } from "./desktopNetworkPolicy.js";
import { mainMemoryDiagnosticsRegistry } from "./mainMemoryDiagnostics.js";

registerLocalMediaPreviewScheme(protocol);
const localMediaPreviewPathRegistry = createLocalMediaPreviewPathRegistry();

// e2e 由 Chromedriver 管理远程调试端口；如果这里继续固定到 9229，
// 会和开发态已打开的 ZCode Dev 抢端口，导致 WebDriver session 创建前白屏超时。
// 仅本地开发运行默认开启远程调试端口，并允许 e2e 通过环境变量交给 Chromedriver 接管。
if (!app.isPackaged && process.env.ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT !== "1") {
  app.commandLine.appendSwitch("remote-debugging-port", "9229");
}

app.setName(runtimeApplicationName);
if (runtimeHomePath) {
  app.setPath("home", runtimeHomePath);
}
if (!shouldUseElectronDefaultUserDataPath) {
  if (!runtimeUserDataPath || !runtimeSessionDataPath) {
    throw new Error(
      "Desktop runtime data paths are required when Electron default userData is disabled",
    );
  }
  app.setPath("userData", runtimeUserDataPath);
  app.setPath("sessionData", runtimeSessionDataPath);
}
process.title = runtimeApplicationName;

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection:", reason);
});

const iconPath =
  process.platform === "win32"
    ? app.isPackaged
      ? join(process.resourcesPath, "icon_windows.png")
      : join(import.meta.dirname, "../../build/icon_windows.png")
    : app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(import.meta.dirname, "../../build/icon.png");
const linuxDesktopIntegrationIconPath =
  process.platform === "linux"
    ? app.isPackaged
      ? join(process.resourcesPath, "icon_512x512.png")
      : join(import.meta.dirname, "../../build/icons/512x512.png")
    : iconPath;
let currentApplicationLocale: Locale = DEFAULT_LOCALE;
let closeToTrayOnWindows = true;
// keep-awake：全局开关 keepAwakeWhileRunning。打开后主进程持有
// powerSaveBlocker("prevent-app-suspension")，阻止系统闲置休眠（防不了合盖/手动睡眠）。
// 不再绑定闲时任务活跃计数——设置页「常规」与 Automations 入口镜像同一配置。
let keepAwakeWhileRunning = false;
let powerSaveBlockerId: number | null = null;
function reconcileKeepAwakeBlocker(): void {
  const shouldBlock = keepAwakeWhileRunning;
  if (shouldBlock && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    logger.info(`[keep-awake] powerSaveBlocker started id=${powerSaveBlockerId}`);
  } else if (!shouldBlock && powerSaveBlockerId !== null) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId);
    } catch {
      // 忽略：id 可能已失效。
    }
    logger.info(`[keep-awake] powerSaveBlocker stopped id=${powerSaveBlockerId}`);
    powerSaveBlockerId = null;
  }
}

const embeddedBrowserDialogController = new EmbeddedBrowserJavaScriptDialogController({
  iconPath,
  getLocale: () => currentApplicationLocale,
  logger,
});
ipcMain.on(PlatformChannels.EmbeddedBrowserJavaScriptDialog, (event, payload: unknown) => {
  event.returnValue = embeddedBrowserDialogController.handleDialogRequest(
    event.sender.id,
    event.senderFrame?.url ?? "",
    payload,
  );
});
// browser-use CDP-on-guest pivot：main 进程按 key 管理 `<webview>` guest 的
// webContents + CDP，为 executor 提供 ControlledView。所有 execute/attach 出口都走这里。
// BrowserGuestManager 虽是 main singleton，但 tab owner 带 window/workspace/session/generation；
// create/close 只投递到 owner window，禁止旧的全窗口广播造成跨窗口 attach。
const browserScreenshotSurfaceCoordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
  fromId: (windowId) => BrowserWindow.fromId(windowId),
  fromWebContentsId: (webContentsId) => webContents.fromId(webContentsId) ?? null,
  log: (message) => logger.debug(message),
  warn: (message) => logger.warn(message),
});
const browserGuestManager = new BrowserGuestManager(
  (msg) => logger.debug(msg),
  undefined,
  (tabId, owner) => {
    const win = owner ? BrowserWindow.fromId(owner.windowId) : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(
        PlatformChannels.BrowserViewCloseTab,
        buildBrowserViewCloseTabNotification(tabId, owner),
      );
    }
  },
  (tabId, owner) => {
    const win = BrowserWindow.fromId(owner.windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send(PlatformChannels.BrowserViewReady, {
        workspaceKey: owner.workspaceKey,
        ...(owner.remoteSessionId ? { remoteSessionId: owner.remoteSessionId } : {}),
        sessionId: owner.sessionId,
        tabId,
        browserId: owner.browserId,
        browserGeneration: owner.browserGeneration,
      });
    }
  },
  (visible, owner, tabId) => {
    const win = BrowserWindow.fromId(owner.windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send(PlatformChannels.BrowserViewVisibility, {
        visible,
        workspaceKey: owner.workspaceKey,
        remoteSessionId: owner.remoteSessionId,
        sessionId: owner.sessionId,
        ...(tabId ? { tabId } : {}),
        browserId: owner.browserId,
        browserGeneration: owner.browserGeneration,
      });
    }
  },
  (viewport, owner, tabId) => {
    const win = BrowserWindow.fromId(owner.windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send(PlatformChannels.BrowserViewViewportChanged, {
        workspaceKey: owner.workspaceKey,
        ...(owner.remoteSessionId ? { remoteSessionId: owner.remoteSessionId } : {}),
        sessionId: owner.sessionId,
        tabId,
        browserId: owner.browserId,
        browserGeneration: owner.browserGeneration,
        viewport,
      });
    }
  },
  (base64Png, target) => {
    const source = nativeImage.createFromBuffer(Buffer.from(base64Png, "base64"));
    if (source.isEmpty()) return undefined;
    const resized = source.resize({
      width: target.width,
      height: target.height,
      quality: "best",
    });
    if (resized.isEmpty()) return undefined;
    return resized.toPNG().toString("base64");
  },
  browserScreenshotSurfaceCoordinator,
  {
    // Browser shell/pageState 不跨进程恢复，以保持“完整退出即清空”的语义，
    // 并避免恢复的 shell 与新 webview 重复 attach。因此不注入 recoveryStore；
    // 进程内 residency 事件仍保留给现有 IPC 兼容层。
    onSuspendTabRequested: (payload) => {
      const tabOwner = browserGuestManager.getTabOwner(payload.tabId);
      const win = tabOwner ? BrowserWindow.fromId(tabOwner.windowId) : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send(PlatformChannels.BrowserViewSuspend, payload);
      }
    },
    onRestoreTabRequested: (payload) => {
      const tabOwner = browserGuestManager.getTabOwner(payload.tabId);
      const win = tabOwner ? BrowserWindow.fromId(tabOwner.windowId) : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send(PlatformChannels.BrowserViewRestore, payload);
      }
    },
    onResidencyChanged: (payload) => {
      const tabOwner = browserGuestManager.getTabOwner(payload.tabId);
      const win = tabOwner ? BrowserWindow.fromId(tabOwner.windowId) : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send(PlatformChannels.BrowserViewRestore, payload);
      }
    },
    onRecoveryOrphanCloseRequested: ({ tabId, reason }) => {
      const tabOwner = browserGuestManager.getTabOwner(tabId);
      const win = tabOwner ? BrowserWindow.fromId(tabOwner.windowId) : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send(PlatformChannels.BrowserViewCloseTab, {
          tabId,
          reason,
        });
      }
    },
    warn: (message) => logger.warn(message),
    recording: {
      createRecorder: (input) =>
        createElectronBrowserWebmRecorder(input, (message) => logger.debug(message)),
    },
  },
  // 隐藏窗口截图的透明 presentation：capture 期间 showInactive + opacity 0 主动要帧。
  (windowId) => BrowserWindow.fromId(windowId),
);
setBrowserUseGuestWebContentsIdsProvider(() => browserGuestManager.listGuestWebContentsIds());

// browser-use：带诊断日志地执行 browser 命令（两处 spawnHostProcess wiring 共用）。
// 打入口/出口便于定位卡点（如 navigate loadURL 挂起、CDP 报错等）。
// CDP-on-guest pivot：execute 走 browserGuestManager（不再传 win —— guest 已由 attachGuest 关联）。
async function runBrowserCommandOnView(params: {
  win: BrowserWindow;
  requestId: string;
  browserId?: string;
  browserGeneration?: number;
  sessionId: string;
  turnId?: string;
  workspaceKey?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  clientMode?: "desktop-continuous" | "web-remote-replayable";
  sessionContext?: "live" | "cached";
  command: unknown;
}): Promise<{ ok: boolean; [k: string]: unknown }> {
  const endDialogAutomation = embeddedBrowserDialogController.beginAutomation(params.win.id);
  const command = params.command as { method?: string; tabId?: unknown } | null;
  const method = command?.method ?? "?";
  const workspaceKey =
    params.workspaceIdentity?.trim() ||
    params.workspaceKey ||
    params.workspacePath ||
    params.sessionId;
  const requestedTabId = resolveBrowserOperationTabId(command);
  const resetsResizeBaseline = browserOperationResetsResizeBaseline(command);
  const sendOperation = (tabId: string) => {
    if (params.win.isDestroyed()) return;
    params.win.webContents.send(PlatformChannels.BrowserViewOperation, {
      workspaceKey,
      ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
      sessionId: params.sessionId,
      tabId,
      browserId: params.browserId ?? "legacy-iab",
      browserGeneration: params.browserGeneration ?? 0,
      resetsResizeBaseline,
    });
  };
  // 交互说明：绝大多数 Tab API 都显式携带 tabId，可在命令真正执行前亮起操作图标；
  // newTab / default-tab 兼容调用要等 manager 返回真实 meta.tabId 后再补发，避免猜 tab identity。
  if (requestedTabId) sendOperation(requestedTabId);
  logger.debug(
    `[browser-use] execute start browserId=${params.browserId ?? "legacy-iab"} sessionId=${params.sessionId} method=${method}`,
  );
  try {
    const result = await browserGuestManager.execute(
      {
        requestId: params.requestId,
        browserId: params.browserId ?? "legacy-iab",
        browserGeneration: params.browserGeneration ?? 0,
        windowId: params.win.id,
        workspaceKey,
        sessionId: params.sessionId,
        ...(params.turnId ? { turnId: params.turnId } : {}),
        ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
        clientMode: params.clientMode ?? "desktop-continuous",
      },
      params.command as Parameters<typeof browserGuestManager.execute>[1],
    );
    logger.debug(
      `[browser-use] execute done sessionId=${params.sessionId} method=${method} ok=${result.ok} elapsedMs=${(result as { elapsedMs?: number }).elapsedMs ?? "?"}`,
    );
    if (!requestedTabId) {
      const resolvedTabId = resolveBrowserOperationTabId(command, result);
      if (resolvedTabId) sendOperation(resolvedTabId);
    }
    return result;
  } catch (error) {
    logger.error(
      `[browser-use] execute threw sessionId=${params.sessionId} method=${method}:`,
      error,
    );
    throw error;
  } finally {
    endDialogAutomation();
  }
}
let currentDesktopZoomLevel = 0;
let currentDesktopWindowSize: DesktopWindowSize | undefined;
const preloadPath = join(import.meta.dirname, "../preload/index.cjs");
const settingsFile = join(homedir(), OPENZWORK_DATA_DIR_NAME, "v2", "setting.json");
let activeAppShutdownPolicy = resolveAppShutdownPolicy("normal", process.platform);
let activeAppShutdownKind: AppShutdownKind | null = null;

const broadcastHub = new BroadcastHub();
const taskRealtimeBus = new TaskRealtimeBus({ logger });
// 内存诊断计数器：desktopResourceTelemetry 每 60s collect
// 一次写主日志。will-download 监听数用于观察关窗后 defaultSession 是否残留监听。
mainMemoryDiagnosticsRegistry.register("taskBus", () => taskRealtimeBus.collectMemoryDiagnostics());
mainMemoryDiagnosticsRegistry.register("broadcast", () => broadcastHub.collectMemoryDiagnostics());
mainMemoryDiagnosticsRegistry.register("guest", () =>
  browserGuestManager.collectMemoryDiagnostics(),
);
mainMemoryDiagnosticsRegistry.register("app", () => ({
  windows: BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length,
  willDownloadListeners: session.defaultSession.listenerCount("will-download"),
}));
const hostProcessLocalEnv = loadHostProcessEnvFromLocalFiles();
interface RuntimeProcessEnvPreparation {
  patchPromise: Promise<Record<string, string>>;
  fallbackPatch: Record<string, string>;
}

let runtimeProcessEnvPrewarmSequence = 0;
function createRuntimeProcessEnvPreparation(): RuntimeProcessEnvPreparation {
  const prewarmId = ++runtimeProcessEnvPrewarmSequence;
  const startedAt = Date.now();
  // Windows process.env 保留 Path 的原始大小写，展开到普通对象后不再大小写不敏感。
  // dotenv 先合并、真实进程环境后合并，再统一成唯一 PATH，保持旧 Host 继承的优先级语义。
  const baseEnv = normalizeRuntimeProcessEnv(
    {
      ...hostProcessLocalEnv,
      ...process.env,
    },
    process.platform,
  );
  const fallbackPatch = buildRuntimeProcessEnvPatch(baseEnv, null, {
    platform: process.platform,
  });
  const patchPromise = captureLoginShellEnvSnapshot({
    baseEnv,
    platform: process.platform,
  }).then(
    (snapshot) => {
      const patch = buildRuntimeProcessEnvPatch(baseEnv, snapshot, {
        platform: process.platform,
      });
      if (process.platform !== "win32" && !snapshot) {
        logger.warn(
          `[startup] login shell env unavailable id=${prewarmId}; using shell-free fallback after ${Date.now() - startedAt}ms`,
        );
        return patch;
      }
      logger.info(
        `[startup] runtime process env prepared asynchronously id=${prewarmId} in ${Date.now() - startedAt}ms`,
      );
      return patch;
    },
    (error) => {
      logger.warn(
        `[startup] runtime process env prewarm failed id=${prewarmId}; using shell-free fallback`,
        error,
      );
      return fallbackPatch;
    },
  );
  return { patchPromise, fallbackPatch };
}

// 首窗在 Main import 时就开始采集；后续窗口各自刷新，避免永久复用进程启动时的 shell snapshot。
let initialRuntimeProcessEnvPreparation: RuntimeProcessEnvPreparation | null =
  createRuntimeProcessEnvPreparation();
function takeRuntimeProcessEnvPreparation(): RuntimeProcessEnvPreparation {
  const initialPreparation = initialRuntimeProcessEnvPreparation;
  if (initialPreparation) {
    initialRuntimeProcessEnvPreparation = null;
    return initialPreparation;
  }
  return createRuntimeProcessEnvPreparation();
}
const forceQuitRef = { current: false };
const explicitQuitRef = { current: false };
let appQuitPreparationInFlight: Promise<void> | null = null;
let hasPreparedAppQuit = false;
const windowWorkspaceMap = new Map<number, Set<string>>();
const windowTaskRealtimeHostIdMap = new Map<number, string>();
const windowUnreadCountMap = new Map<number, number>();
const windowHostProcessMap = new Map<number, ElectronUtilityProcess>();
const hostRunningTaskCountMap = new Map<ElectronUtilityProcess, number>();

// 常驻 cron scheduler 进程句柄；app ready 后拉起，退出前销毁。
let cronScheduler: CronSchedulerHandle | null = null;
// host → main 的定时任务派发结果，转交给 scheduler 结算。经模块变量转发以避免 spawn 顺序耦合。
function forwardCronRunResult(
  result: Parameters<CronSchedulerHandle["handleCronRunResult"]>[0],
): void {
  cronScheduler?.handleCronRunResult(result);
}
function forwardOffPeakRunResult(
  result: Parameters<CronSchedulerHandle["handleOffPeakRunResult"]>[0],
): void {
  cronScheduler?.handleOffPeakRunResult(result);
}
function wakeCronScheduler(automationId: string): void {
  cronScheduler?.wake(automationId);
}
function wakeOffPeakScheduler(offPeakTaskId?: string): void {
  // 复用同一条 scheduler-wake 通道（tick 同时覆盖 cron 与 off-peak 分支），仅日志标签区分。
  cronScheduler?.wake(`offpeak:${offPeakTaskId ?? "sync"}`);
}
// 选一个本地 host 执行派发：本期本地 workspace 由任一本地窗口 host 的 createTask 按 path 拉起/复用 agent。
function resolveCronDispatchHost(): ElectronUtilityProcess | null {
  const first = windowHostProcessMap.values().next();
  return first.done ? null : first.value;
}
const disposingHostProcessTimers = new WeakMap<
  ElectronUtilityProcess,
  ReturnType<typeof setTimeout>
>();
const mainSettingService = createSettingService();
async function resolveCurrentZCodeEndpointOrigin() {
  return resolveZCodeEndpointOrigin({
    env: ZCODE_ENV,
    envBaseOrigin: resolveZCodeEndpointEnvBaseOrigin(hostProcessLocalEnv),
    overrideOrigin: (await mainSettingService.get()).zcodeEndpointOrigin,
  });
}

app.on("browser-window-focus", () => {
  rebuildMenu();
});

const remoteSessionManager = createRemoteWorkspaceSessionManager({
  logger,
  windowHostProcessMap,
  resolveRemoteAssetDirs: () =>
    resolveRemoteAssetDirs({ locale: currentApplicationLocale }, hostProcessLocalEnv),
  resolveWslTarget: resolveCanonicalWslTarget,
});

const deviceMid = ensureDesktopDeviceMidSync();

function extractOpenWorkspacePathFromDeepLinkUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    return isWorkspaceOpenUrl(parsedUrl) ? extractWorkspaceOpenPath(parsedUrl) : null;
  } catch {
    return null;
  }
}

const startupOpenWorkspaceArgPath = extractOpenWorkspacePathFromArgs(process.argv);
const startupProtocolUrl = extractDeepLinkUrlFromArgs(process.argv);
const startupDeepLinkWorkspacePath = startupOpenWorkspaceArgPath
  ? null
  : extractOpenWorkspacePathFromDeepLinkUrl(startupProtocolUrl ?? "");
const startupDeepLinkConsumptionGate = createStartupDeepLinkConsumptionGate(startupProtocolUrl);
let startupOpenWorkspaceRequest: ExplicitStartupWorkspaceRequest | null =
  startupOpenWorkspaceArgPath
    ? { path: startupOpenWorkspaceArgPath, source: "open-workspace-arg" }
    : startupDeepLinkWorkspacePath
      ? { path: startupDeepLinkWorkspacePath, source: "deep-link" }
      : null;

function resolveExternalWorkspaceConfirmationCopy() {
  const effectiveLocale =
    currentApplicationLocale === DEFAULT_LOCALE && app.isReady()
      ? resolveSystemApplicationLocale()
      : currentApplicationLocale;
  return resolveExternalWorkspaceOpenDialogCopy(effectiveLocale);
}

const primaryWindowCoordinator = createPrimaryWindowCoordinator({
  listWindows: getApplicationWindows,
  resolveStartupWindowBootstrap: () => {
    if (startupOpenWorkspaceRequest) {
      const request = startupOpenWorkspaceRequest;
      startupOpenWorkspaceRequest = null;
      startupDeepLinkConsumptionGate.markStartupRequestConsumed(request);
      const explicitBootstrap = resolveExplicitStartupWorkspaceBootstrap(request, {
        confirmationCopy: resolveExternalWorkspaceConfirmationCopy(),
        logger,
      });
      if (explicitBootstrap) {
        return Promise.resolve(explicitBootstrap);
      }
    }

    return resolveStartupWindowBootstrap({
      settingsFile,
      // dataBaseDir 可能在 bootstrap 设置阶段被覆盖，必须在真正解析启动工作区时再取值。
      conversationWorkspaceDir: getConversationWorkspaceDir(),
      logger,
    });
  },
  createWindow: (startupBootstrap) => {
    createWindowInstance(startupBootstrap);
  },
  logger,
});

function markForceQuit(reason: string) {
  if (forceQuitRef.current) {
    return;
  }

  forceQuitRef.current = true;
  logger.info(`[app-quit] forceQuit enabled (${reason})`);
}

function markExplicitQuit(reason: string) {
  explicitQuitRef.current = true;
  logger.info(`[app-quit] explicit quit requested (${reason})`);
}

function syncCloseToTrayOnWindows(value: unknown) {
  if (typeof value !== "boolean") {
    return;
  }

  closeToTrayOnWindows = value;
  logger.info(`[settings] closeToTrayOnWindows=${value}`);
}

function syncImmediateAppSettings(patch: Partial<AppSettings>) {
  syncCloseToTrayOnWindows(patch.closeToTrayOnWindows);

  if (typeof patch.keepAwakeWhileRunning === "boolean") {
    keepAwakeWhileRunning = patch.keepAwakeWhileRunning;
    reconcileKeepAwakeBlocker();
  }

  if (patch.shortcutBindings !== undefined) {
    // 快捷键改绑：
    // 落盘已完成（useSettings.update 先 await settingService.update 再走本通道），
    // 这里重建应用菜单 accelerator，并通知所有窗口刷新设置快照 —— 其他窗口的
    // useAppKeyboard 生效表与设置页跟随更新。
    rebuildMenu();
    for (const win of getApplicationWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(PlatformChannels.SettingsChanged);
      }
    }
  }
}

async function prepareAppQuit(reason: string, kind: AppShutdownKind = "normal"): Promise<void> {
  const selection = selectAppShutdownPolicy(activeAppShutdownKind, kind, process.platform);
  activeAppShutdownKind = selection.kind;
  activeAppShutdownPolicy = selection.policy;
  if (hasPreparedAppQuit) {
    return;
  }
  if (appQuitPreparationInFlight) {
    await appQuitPreparationInFlight;
    return;
  }

  markForceQuit(reason);
  browserScreenshotSurfaceCoordinator.dispose();

  const cronSchedulerToDispose = cronScheduler;
  cronScheduler = null;

  const hostProcesses = [
    ...new Set([...windowHostProcessMap.values(), ...listDisposingHostProcesses()]),
  ];
  logger.info(
    `[app-quit] waiting for host process cleanup (${reason}), kind=${activeAppShutdownKind}, hosts=${hostProcesses.length}, forceKillDelayMs=${activeAppShutdownPolicy.forceKillDelayMs}, waitTimeoutMs=${activeAppShutdownPolicy.waitTimeoutMs}`,
  );

  appQuitPreparationInFlight = Promise.all([
    // 退出屏障结束后再启动窗口尺寸写入，可能在 app.exit 前留下 setting.json.lock。
    // 尺寸已在 resize 防抖或最大化状态变化时保存，退出屏障不再创建新的尺寸写入。
    // 旧流程先等待 Cron 的 1.5s deadline，再启动 Host timer，导致声明的
    // 4.5s/9s 退出总预算被串行放大。两类 owner 无关闭依赖，统一并行进入同一屏障。
    (async () => {
      try {
        await cronSchedulerToDispose?.dispose();
      } catch (error) {
        logger.warn(`[app-quit] cron scheduler dispose failed (${reason}):`, error);
      }
    })(),
    // remote session、attachment 和 transport 都由窗口 Host 持有；这里先清理
    // Main 的请求关联，再由下方每窗口唯一 Host 的 shutdown barrier 释放真实连接与 Agent。
    remoteSessionManager.disposeAllAndWaitForAppShutdown(reason),
    ...hostProcesses.map((child, index) =>
      disposeHostProcessAndWait(
        child,
        `${reason}-${index + 1}`,
        disposingHostProcessTimers,
        logger,
        {
          forceKillDelayMs: activeAppShutdownPolicy.forceKillDelayMs,
          waitTimeoutMs: activeAppShutdownPolicy.waitTimeoutMs,
        },
      ),
    ),
  ])
    .then(() => {
      logger.info(`[app-quit] host process cleanup completed (${reason})`);
    })
    .catch((error) => {
      logger.error(`[app-quit] host process cleanup failed (${reason}):`, error);
    })
    .finally(() => {
      // before-quit 是同步事件。只发 Dispose 就继续退出 main 的话，
      // host 还没等到 agent 进程树的 SIGTERM/SIGKILL 兜底完成就被带走，zcode-cli 会被 init 接管成残留进程。
      // 这里先拦截第一次退出，等待 host 清理完成后再放行第二次 app.quit。
      hasPreparedAppQuit = true;
      appQuitPreparationInFlight = null;
    });

  await appQuitPreparationInFlight;
}

function exitPreparedApp(reason: string): never | void {
  logger.info(`[app-quit] exiting prepared app (${reason})`);
  if (process.env.ZCODE_E2E_RUN_ID?.trim()) {
    flushMainE2ECoverage((error) => {
      logger.warn("[e2e-coverage] main coverage flush failed", error);
    });
    // ChromeDriver 正在执行 deleteSession 时，Electron app.exit(0)
    // 和进程内的 process.kill 都可能被 Electron 生命周期吞掉。这里只在 E2E
    // run 身份明确、且 prepareAppQuit 已完成 host/agent 回收之后，启动独立系统
    // 命令终止当前 PID；不按名称扫描，也不会影响产品退出或下一轮 session。
    const killer =
      process.platform === "win32"
        ? spawn("taskkill", ["/PID", String(process.pid), "/F"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn("kill", ["-9", String(process.pid)], {
            detached: true,
            stdio: "ignore",
          });
    killer.unref();
    return;
  }
  app.exit(0);
}

function getRunningAgentSessionCount() {
  return [...hostRunningTaskCountMap.values()].reduce((total, count) => total + count, 0);
}


function shouldConfirmAppQuit() {
  // 开发环境里的普通会话经常需要重启 Electron，只在 production 下拦截，避免打断调试。
  return ZCODE_ENV === "production" && getRunningAgentSessionCount() > 0;
}

function confirmAppQuit(originWindow?: BrowserWindow | null) {
  if (!shouldConfirmAppQuit()) {
    logger.info(`[app-quit] quit confirmation skipped in ${ZCODE_ENV}`);
    return true;
  }

  const isZh = currentApplicationLocale === "zh-CN";
  const runningAgentSessionCount = getRunningAgentSessionCount();
  const detailLines = [
    runningAgentSessionCount > 0
      ? isZh
        ? `正在进行的会话：${runningAgentSessionCount} 个，退出后会被中断。`
        : `In-progress sessions: ${runningAgentSessionCount}. They will be interrupted after quitting.`
      : null,
  ].filter((line): line is string => line !== null);
  const targetWindow =
    originWindow && !originWindow.isDestroyed()
      ? originWindow
      : (BrowserWindow.getFocusedWindow() ??
        getApplicationWindows()[0] ??
        null);
  const dialogOptions = {
    type: "question" as const,
    buttons: isZh ? ["退出", "取消"] : ["Quit", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: isZh ? "退出确认" : "Confirm Quit",
    message: isZh ? "确认退出 Z Code?" : "Quit Z Code?",
    detail: detailLines.join("\n"),
    icon: nativeImage.createFromPath(iconPath),
  };

  const result = targetWindow
    ? dialog.showMessageBoxSync(targetWindow, dialogOptions)
    : dialog.showMessageBoxSync(dialogOptions);
  return result === 0;
}

async function executeDesktopCommandForApp(
  command: Parameters<typeof executeDesktopCommand>[0]["command"],
  senderWindow?: BrowserWindow | null,
) {
  return executeDesktopCommand({
    command,
    senderWindow,
    logger,
    updateZCodeStdioTapDevMenuState,
    onDesktopZoomChanged: (zoomLevel) => {
      currentDesktopZoomLevel = clampDesktopZoomLevel(zoomLevel);
      rebuildMenu();
    },
    settingService: mainSettingService,
    onZCodeEndpointChanged: handleZCodeEndpointChanged,
    zcodeEndpointEnvBaseOrigin: resolveZCodeEndpointEnvBaseOrigin(hostProcessLocalEnv),
    onRelaunchApp: async () => {
      await prepareAppQuit("desktop-command-relaunch");
      app.relaunch();
      app.quit();
    },
    credentialsDir: getCredentialsDir(),
    currentApplicationLocale,
  });
}

async function resolveZCodeEndpointSelection(): Promise<"production" | "test" | "custom"> {
  if (ZCODE_ENV === "production") {
    return "production";
  }
  const origin = await resolveCurrentZCodeEndpointOrigin();
  if (origin === DEFAULT_ZCODE_ENDPOINT_ORIGIN) {
    return "production";
  }
  return "custom";
}

async function handleZCodeEndpointChanged() {
  rebuildMenu();
}

/** 快捷键设置页录制态（renderer 经 SetShortcutRecordingActive 同步）；true 时菜单摘除可配置 accelerator。 */
let shortcutRecordingActive = false;
/** 发起录制的 webContents id；窗口关闭/崩溃时 renderer 不会发复位 IPC，main 侧据此收口。 */
let shortcutRecordingOwnerWebContentsId: number | null = null;

function setShortcutRecordingActive(active: boolean, ownerWebContentsId: number | null = null) {
  if (active) {
    shortcutRecordingOwnerWebContentsId = ownerWebContentsId;
  }
  if (shortcutRecordingActive === active) {
    return;
  }
  shortcutRecordingActive = active;
  if (!active) {
    shortcutRecordingOwnerWebContentsId = null;
  }
  rebuildMenu();
}

/**
 * 录制态是跨进程的临时全局状态，收口不能依赖 renderer 合作——录制中关窗
 * 或渲染进程崩溃时 React cleanup 与复位 IPC 都不会执行，标志会永久为 true，之后所有
 * rebuildMenu（切语言/zoom/设置同步）都建出无 accelerator 的菜单且波及全部窗口。
 * 在既有窗口销毁清理里按发起 webContents 复位。
 */
function resetShortcutRecordingForWebContents(webContentsId: number) {
  if (!shortcutRecordingActive || shortcutRecordingOwnerWebContentsId !== webContentsId) {
    return;
  }
  shortcutRecordingOwnerWebContentsId = null;
  shortcutRecordingActive = false;
  rebuildMenu();
}

function rebuildMenu() {
  void Promise.all([resolveZCodeEndpointSelection(), mainSettingService.get()]).then(
    ([zcodeEndpointSelection, settings]) => {
      rebuildApplicationMenu({
        currentApplicationLocale,
        zcodeEndpointSelection,
        executeDesktopCommand: executeDesktopCommandForApp,
        currentZoomLevel: resolveFocusedDesktopZoomLevel(),
        // 菜单 accelerator 跟随用户快捷键设置（shortcutBindings 用户覆盖）
        shortcutBindings: settings.shortcutBindings,
        // 快捷键录制态：摘掉可配置 accelerator，防止录制 menu 通道命令时按键直接触发原命令
        // （macOS 系统菜单先于 renderer 吃掉按键，renderer 侧 preventDefault 拦不住）。
        disableShortcutAccelerators: shortcutRecordingActive,
      });
    },
  );
  updateWindowsDesktopTrayMenu();
}

function resolveFocusedDesktopZoomLevel(): number {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow || focusedWindow.isDestroyed()) {
    return 0;
  }
  return resolveDesktopZoomLevelFromFactor(focusedWindow.webContents.getZoomFactor());
}

function getApplicationWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
}

function getMainApplicationWindows(): BrowserWindow[] {
  return getApplicationWindows();
}


function createWindowInstance(startupBootstrap: StartupWindowBootstrap = {}) {
  const runtimeProcessEnvPreparation = takeRuntimeProcessEnvPreparation();
  const win = createWindow({
    iconPath,
    preloadPath,
    logger,
    forceQuitRef,
    handleBeforeClose: (win, label) =>
      handleDesktopWindowCloseRequest({
        platform: process.platform,
        forceQuit: forceQuitRef.current,
        explicitQuitRequested: explicitQuitRef.current,
        closeToTrayOnWindows,
        isLastWindow: getMainApplicationWindows().length === 1,
        label,
        logger,
        shouldConfirmQuit: shouldConfirmAppQuit(),
        confirmQuit: () => confirmAppQuit(win),
        requestQuit: () => {
          markForceQuit(`last-window-close:${label}`);
          app.quit();
        },
        hideWindow: () => win.hide(),
      }),
    windowHostProcessMap,
    spawnHostProcess: (win, label, initMessage) =>
      spawnHostProcess(
        win,
        label,
        {
          ...initMessage,
          zcodeBuiltinProviderConfigFilePath: resolveZCodeBuiltinProviderConfigFilePath({
            env: { ...hostProcessLocalEnv, ...process.env },
          }),
        },
        {
          hostProcessLocalEnv,
          logger,
          broadcastHub,
          taskRealtimeBus,
          windowHostProcessMap,
          hostRunningTaskCountMap,
          onCronRunResult: forwardCronRunResult,
          onOffPeakRunResult: forwardOffPeakRunResult,
          onCronSchedulerWakeRequested: wakeCronScheduler,
          onOffPeakSchedulerWakeRequested: wakeOffPeakScheduler,
          authorizeLocalMediaPreviewPath: localMediaPreviewPathRegistry.authorize,
          // browser-use：main 用 WebContentsView+CDP 执行命令。
          handleBrowserExecuteRequest: ({ win: browserWin, ...request }) =>
            runBrowserCommandOnView({ win: browserWin, ...request }),
        },
        {
          taskRealtime: {
            workspaceKeys: windowWorkspaceMap.get(win.id) ?? [],
            onHostId: (hostId) => {
              windowTaskRealtimeHostIdMap.set(win.id, hostId);
            },
          },
        },
      ),
    disposeHostProcess: (child, label, forceKillDelayMs) =>
      disposeHostProcess(
        child,
        label,
        disposingHostProcessTimers,
        logger,
        label.includes("window-closed")
          ? activeAppShutdownPolicy.forceKillDelayMs
          : forceKillDelayMs,
      ),
    disposeRemoteWorkspaceSessionsForWindow:
      remoteSessionManager.disposeRemoteWorkspaceSessionsForWindow,
    reattachRemoteWorkspaceSessionsForWindow:
      remoteSessionManager.reattachRemoteWorkspaceSessionsForWindow,
    bootstrap: {
      restoreSession: startupBootstrap.restoreSession,
      initialWorkspacePath: startupBootstrap.initialWorkspacePath,
      initialWorkspacePurpose: startupBootstrap.initialWorkspacePurpose,
      unavailableWorkspacePath: startupBootstrap.unavailableWorkspacePath,
    },
    agentWarmupTargets: startupBootstrap.agentWarmupTargets,
    // startupBootstrap 只标记 active workspace 是否不可用，但 local Host 会为所有
    // 已恢复 workspace 建立后台索引。始终注入 canonical fallback，才能覆盖非 active 历史目录已删除的情况。
    agentSpawnFallbackCwd: getConversationWorkspaceDir(),
    deviceMid,
    runtimeProcessEnvPatchPromise: runtimeProcessEnvPreparation.patchPromise,
    runtimeProcessEnvFallbackPatch: runtimeProcessEnvPreparation.fallbackPatch,
    initialDesktopZoomLevel: currentDesktopZoomLevel,
    initialWindowSize: currentDesktopWindowSize,
    currentApplicationLocale: () => currentApplicationLocale,
    resolveBrowserViewOwner: (webContentsId) =>
      browserGuestManager.getTabOwnerByWebContentsId(webContentsId),
    persistWindowSize: async (state) => {
      currentDesktopWindowSize = state;
      await mainSettingService.update({ desktopWindowSize: state });
    },
  });
  return win;
}

registerDeepLinkProtocol(logger, { iconPath: linuxDesktopIntegrationIconPath });
app.on("open-url", (event, url) => {
  event.preventDefault();
  const workspacePath = extractOpenWorkspacePathFromDeepLinkUrl(url);
  if (workspacePath && getApplicationWindows().length === 0) {
    // macOS 冷启动 Finder Service 会先触发 open-url，再创建首窗。
    // 把目标目录按 deep link 来源记录，首窗 bootstrap 前仍要走确认 gate。
    startupOpenWorkspaceRequest = { path: workspacePath, source: "deep-link" };
    if (app.isReady()) {
      void primaryWindowCoordinator.ensurePrimaryWindow("open-url-workspace");
    }
    return;
  }
  handleDeepLink(url, logger, {
    confirmationCopy: resolveExternalWorkspaceConfirmationCopy(),
    resolveApplicationWindow: () => getApplicationWindows()[0] ?? null,
  });
});
const gotTheLock = app.requestSingleInstanceLock(createDeepLinkSingleInstanceData(process.argv));
if (!gotTheLock) {
  app.quit();
}
app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
  if (
    handleSecondInstanceWorkspaceRequest({
      additionalData,
      argv,
      handleDeepLink: (url, options) => handleDeepLink(url, logger, options),
      handleOpenWorkspacePath: (path, options) =>
        handleOpenWorkspacePath(path, logger, {
          allowWithoutReadyWindow: true,
          ...options,
          resolveApplicationWindow:
            options?.resolveApplicationWindow ??
            (() => getApplicationWindows()[0] ?? null),
        }),
      resolveApplicationWindow: () => getApplicationWindows()[0] ?? null,
      logger,
      workspaceConfirmationCopy: resolveExternalWorkspaceConfirmationCopy(),
    })
  ) {
    return;
  }

  const win = getApplicationWindows()[0];
  if (win) {
    if (win.isMinimized()) {
      win.restore();
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.focus();
  }
});

app.whenReady().then(async () => {
  markMainLaunchAppReady();
  installLocalMediaPreviewProtocol(session.defaultSession.protocol, {
    isPathAuthorized: localMediaPreviewPathRegistry.isAuthorized,
  });
  installBrowserRestoreBootstrapProtocol(
    session.fromPartition(EMBEDDED_BROWSER_PARTITION).protocol,
  );
  // Bootstrap: 从设置文件读取自定义数据目录，在所有 host 进程启动前生效
  let loadedBootstrapLocale = false;
  let bootstrapSettings: AppSettings | undefined;
  try {
    bootstrapSettings = await mainSettingService.get();
    if (bootstrapSettings.dataBaseDir) {
      setDataBaseDir(bootstrapSettings.dataBaseDir);
    }
    if (bootstrapSettings.locale) {
      loadedBootstrapLocale = true;
      currentApplicationLocale = bootstrapSettings.locale;
    }
    closeToTrayOnWindows = bootstrapSettings.closeToTrayOnWindows ?? true;
    keepAwakeWhileRunning = bootstrapSettings.keepAwakeWhileRunning ?? false;
    currentDesktopZoomLevel = clampDesktopZoomLevel(bootstrapSettings.desktopZoomLevel ?? 0);
    currentDesktopWindowSize = bootstrapSettings.desktopWindowSize;
    // 全局 keep-awake：启动时若设置已开，立刻持有 powerSaveBlocker，不必等设置变更事件。
    reconcileKeepAwakeBlocker();
  } catch {
    // 读取失败不影响启动，使用默认 homedir
  }

  // scheduler 也会打开 tasks-index；等 Host 完成统一准备，避免在启动页出现前抢先迁移。
  configureDatabaseStartupQuit(() => {
    markExplicitQuit("database-startup-exit");
    app.quit();
  });
  onLocalDatabaseStartupReady(() => {
    try {
      cronScheduler = spawnCronScheduler({
        hostProcessLocalEnv,
        logger,
        resolveDispatchHost: resolveCronDispatchHost,
        // keep-awake 已改为纯设置驱动；计数上报保留给后续诊断/配额用途，不再联动 blocker。
        onOffPeakActiveCountChanged: () => {},
      });
    } catch (error) {
      logger.error("[cron-scheduler] failed to spawn scheduler process:", error);
    }
  });

  if (process.platform === "win32") {
    // 打包态必须与 NSIS 快捷方式使用同一 AUMID，否则 Shell 把它们当成不同应用。
    // 使用构建期产品身份，不依赖用户机器环境；开发态继续保持独立身份。
    app.setAppUserModelId(
      resolveWindowsAppUserModelIdForFlavor(ZCODE_PRODUCT_FLAVOR, { isPackaged: app.isPackaged }),
    );
  }

  applyAppIcon(iconPath);
  if (!loadedBootstrapLocale) {
    currentApplicationLocale = resolveSystemApplicationLocale();
  }
  installFinderOpenFolderWorkflow({
    platform: process.platform,
    locale: currentApplicationLocale,
    homeDir: app.getPath("home"),
    logger,
  });
  await installWindowsOpenFolderContextMenu({
    platform: process.platform,
    executablePath: process.execPath,
    argv: process.argv,
    isDefaultApp: Boolean(process.defaultApp),
    locale: currentApplicationLocale,
    logger,
  });
  try {
    await applyDesktopChromiumNetworkPolicies(session, bootstrapSettings ?? {}, logger);
  } catch (error) {
    logger.warn("[desktop-network] Chromium network policy bootstrap failed:", error);
  }

  if (process.platform === "darwin" || process.platform === "win32") {
    app.clearRecentDocuments();
  }

  rebuildMenu();
  configureDockMenu(
    () =>
      getDesktopMenuLabelByLocale(
        currentApplicationLocale,
        desktopMenuMessageIds.dockShowCurrentWindow,
      ),
    () => showCurrentWindowFromDock(primaryWindowCoordinator),
  );
  createWindowsDesktopTray({
    getLocale: () => currentApplicationLocale,
    showCurrentWindow: () =>
      primaryWindowCoordinator.ensurePrimaryWindow("tray-show-current-window"),
    executeDesktopCommand: executeDesktopCommandForApp,
    quitApp: () => {
      markExplicitQuit("tray-quit");
      app.quit();
    },
    logger,
  });

  registerPlatformIpcHandlers({
    logger,
    // CDP-on-guest pivot：renderer `<webview>` dom-ready 上报 guest webContentsId → attach。
    attachBrowserGuest: (key, webContentsId, options) => {
      const result = browserGuestManager.attachGuest(key, webContentsId, options);
      if (result.ok && options?.windowId !== undefined) {
        embeddedBrowserDialogController.bindGuest(key, webContentsId, options.windowId);
      }
      return result;
    },
    updateBrowserGuestViewport: (tabId, viewport, windowId, desktopZoomFactor) =>
      browserGuestManager.updateViewportFromRenderer(tabId, viewport, windowId, desktopZoomFactor),
    reportBrowserScreenshotSurfaceReady: (windowId, senderWebContentsId, payload) => {
      logger.debug("[browser-screenshot-surface] renderer ready", {
        windowId,
        senderWebContentsId,
        requestId: payload.requestId,
        tabId: payload.tabId,
        webContentsId: payload.webContentsId,
        viewport: payload.viewport,
        surfaceScale: payload.surfaceScale,
      });
      browserScreenshotSurfaceCoordinator.handleReady({
        windowId,
        senderWebContentsId,
        payload,
      });
    },
    browserViewResidencyHandlers: {
      detachBrowserGuest: (key, webContentsId, windowId) =>
        browserGuestManager.detachGuestBeforeReplacement(key, webContentsId, windowId),
      closeBrowserTab: (payload) => browserGuestManager.closeTabFromRenderer(payload),
      reportBrowserTabResidency: (payload) => browserGuestManager.reportResidency(payload),
      acknowledgeBrowserTabSuspend: (payload) => browserGuestManager.acknowledgeSuspend(payload),
      ensureBrowserTabResident: (payload) =>
        browserGuestManager.ensureResidentFromRenderer(payload),
      restoreBrowserTabs: (payload) => browserGuestManager.restoreTabs(payload),
    },
    applyApplicationLocale: async (locale) => {
      currentApplicationLocale = locale;
      rebuildMenu();
      for (const win of getApplicationWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(PlatformChannels.ApplicationLocaleChanged, currentApplicationLocale);
        }
      }
      installFinderOpenFolderWorkflow({
        platform: process.platform,
        locale: currentApplicationLocale,
        homeDir: app.getPath("home"),
        logger,
      });
      // Windows Explorer 右键菜单是注册表持久项，renderer 切换语言不会自动刷新。
      // 这里跟 macOS Finder Service 一样在 locale 变化时重写菜单文案，避免继续显示旧语言。
      await installWindowsOpenFolderContextMenu({
        platform: process.platform,
        executablePath: process.execPath,
        argv: process.argv,
        isDefaultApp: Boolean(process.defaultApp),
        locale: currentApplicationLocale,
        logger,
      });
      configureDockMenu(
        () =>
          getDesktopMenuLabelByLocale(
            currentApplicationLocale,
            desktopMenuMessageIds.dockShowCurrentWindow,
          ),
        () => showCurrentWindowFromDock(primaryWindowCoordinator),
      );
    },
    focusWorkspaceInExistingWindow: (path, extra) =>
      focusWorkspaceInExistingWindow(path, windowWorkspaceMap, extra),
    windowWorkspaceMap,
    windowUnreadCountMap,
    resolveSystemLocale: resolveSystemApplicationLocale,
    currentApplicationLocale: () => currentApplicationLocale,
    executeDesktopCommand: executeDesktopCommandForApp,
    syncTaskRealtimeWorkspaceKeys: (windowId, workspaceKeys) => {
      const hostId = windowTaskRealtimeHostIdMap.get(windowId);
      if (hostId) {
        taskRealtimeBus.updateHostWorkspaceKeys(hostId, workspaceKeys);
      }
    },
    getDesktopSessionActivity: () => ({
      runningAgentSessionCount: getRunningAgentSessionCount(),
    }),
    syncAppSettings: syncImmediateAppSettings,
    setShortcutRecordingActive,
    deviceMid,
  });

  registerRemoteIpcHandlers({
    logger,
    createRemoteWorkspaceSession: remoteSessionManager.createRemoteWorkspaceSession,
    disposeRemoteWorkspaceSession: remoteSessionManager.disposeRemoteWorkspaceSession,
    cancelPendingRemoteWorkspaceSessionsForWindow:
      remoteSessionManager.cancelPendingRemoteWorkspaceSessionsForWindow,
    bindRemoteWorkspaceSessionContext: remoteSessionManager.bindRemoteWorkspaceSessionContext,
    confirmRendererAttachmentReady: remoteSessionManager.confirmRendererAttachmentReady,
    isDockerDaemonAvailable,
    listAvailableWSLDistros,
    listAvailableDockerContainers,
    listSSHConfigAliases,
  });

  logger.info("[startup] 创建主窗口");
  await primaryWindowCoordinator.ensurePrimaryWindow("app-ready");

  // 启动后检测 CPU 架构是否匹配（如 Apple 芯片误装 x64 版本经 Rosetta 转译运行），
  // 命中后异步弹框提示安装原生架构版本，不阻塞主界面。
  void maybeWarnArchitectureMismatch({
    locale: currentApplicationLocale,
    logger,
    parentWindow: getApplicationWindows()[0] ?? null,
    icon: nativeImage.createFromPath(iconPath),
  }).catch((error) => {
    logger.warn("[architecture] 架构检测弹框失败:", error);
  });

  const protocolUrl = extractDeepLinkUrlFromArgs(process.argv);
  if (startupDeepLinkConsumptionGate.shouldHandleReadyProtocolUrl(protocolUrl)) {
    handleDeepLink(protocolUrl, logger, {
      confirmationCopy: resolveExternalWorkspaceConfirmationCopy(),
      resolveApplicationWindow: () => getApplicationWindows()[0] ?? null,
    });
  }
});

app.on("browser-window-created", (_, win) => {
  const windowWebContentsId = win.webContents.id;
  win.on("closed", () => {
    browserScreenshotSurfaceCoordinator.handleWindowDestroyed(win.id);
    browserGuestManager.closeWindow(win.id);
    windowWorkspaceMap.delete(win.id);
    windowTaskRealtimeHostIdMap.delete(win.id);
    if (windowUnreadCountMap.delete(win.id)) {
      syncApplicationUnreadBadge(windowUnreadCountMap);
    }
    // Electron 进入 closed 回调时，win.webContents 可能已经被销毁。
    // 之前这里现取 win.webContents.id，会在关窗收尾阶段抛出 "Object has been destroyed"。
    // 改为在窗口创建时缓存 webContents id，确保清理 OAuth 路由时不再访问已销毁对象。
    clearDeepLinkRoutesForWindow(windowWebContentsId);
    // 录制中关窗/崩溃时 renderer 不会发复位 IPC，这里按发起 webContents 复位录制态，
    // 防止菜单 accelerator 被永久摘除。
    resetShortcutRecordingForWebContents(windowWebContentsId);
  });
  // 渲染进程崩溃但窗口存活时 closed 不会触发，崩溃路径同样按 owner 复位
  // （owner 不匹配时天然幂等）。
  win.webContents.on("render-process-gone", () => {
    resetShortcutRecordingForWebContents(windowWebContentsId);
  });
});
app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    // macOS: keep app running when all windows are closed
    return;
  }

  app.quit();
});
app.on("before-quit", (event) => {
  // Windows 最后窗口关闭会在 close 阶段提前确认并标记 forceQuit；
  // macOS 的 Cmd+Q / 菜单退出不会走该窗口关闭确认，必须在 before-quit 保留应用级确认兜底。
  if (!forceQuitRef.current && shouldConfirmAppQuit() && !confirmAppQuit()) {
    event.preventDefault();
    // 托盘退出等显式退出如果被确认框取消，不能继续保留 explicitQuit。
    // 否则用户下一次点 Windows 关闭按钮会绕过“隐藏到托盘”设置，误触发完整退出路径。
    explicitQuitRef.current = false;
    return;
  }

  if (!hasPreparedAppQuit) {
    localMediaPreviewPathRegistry.clear();
    event.preventDefault();
    void prepareAppQuit("app-before-quit").finally(() => {
      const remainingWindows = getApplicationWindows();
      logger.info(
        `[app-quit] preparation finished, resuming quit with windows=${remainingWindows.length}`,
      );
      // ChromeDriver 关闭最后一个 renderer 后才触发 app.quit 时，
      // 第一次 before-quit 会被异步 host 清理拦截；清理完成时窗口可能仍处于
      // closing 状态，此时重入 app.quit 会被 Electron 忽略，ChromeDriver 会等待
      // 约 70 秒。这里把最后一次退出绑定到真实 closed 事件，不依赖超时猜测。
      if (remainingWindows.length === 0) {
        exitPreparedApp("no-windows-after-preparation");
        return;
      }

      let exitRequested = false;
      const exitAfterLastWindowClosed = () => {
        if (exitRequested || getApplicationWindows().length > 0) {
          return;
        }
        exitRequested = true;
        logger.info("[app-quit] all windows closed after preparation, exiting app");
        exitPreparedApp("all-windows-closed-after-preparation");
      };
      for (const win of remainingWindows) {
        win.once("closed", exitAfterLastWindowClosed);
      }
      app.quit();
    });
  }
});
app.on("activate", () => {
  void primaryWindowCoordinator.ensurePrimaryWindow("app-activate");
});
