import { getPluginSandboxHost } from "./pluginSandbox/index.js";
/* eslint-disable max-lines -- 桌面命令分发需要共享窗口与平台上下文，集中维护更便于一致性 */
import { readZCodeStdioTapDevState, setZCodeStdioTapDevEnabled } from "@zcode/services/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import type { MessageBoxOptions } from "electron";
import {
  DesktopCommandIds,
  OPENZWORK_APP_NAME,
  getCommunityUrlFromConfigs,
  normalizeZCodeEndpointOrigin,
  PlatformChannels,
  ZCODE_ENV,
  type AppSettings,
  type DesktopCommandId,
  type Locale,
  resolveRuntimeZCodeEndpointOrigin,
} from "@zcode/shared";
import { showAboutDialog } from "./about.js";
import { exportLogs } from "./exportLogs.js";
import { openResourceManager } from "./resourceManagerWindow.js";
import { syncWindowControlsOverlayForZoomLevel } from "./desktopWindowButtonPosition.js";
import {
  DEFAULT_DESKTOP_WINDOW_HEIGHT,
  DEFAULT_DESKTOP_WINDOW_WIDTH,
} from "./desktopWindowSize.js";
import {
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "./desktopZoom.js";

export const HELP_TOGGLE_DEV_TOOLS_MENU_ID = "help.toggle-dev-tools";
export const HELP_TOGGLE_ZCODE_STDIO_TAP_MENU_ID = "help.toggle-zcode-stdio-tap";
const ZCODE_ENDPOINT_PROMPT_WIDTH = 460;
const ZCODE_ENDPOINT_PROMPT_HEIGHT = 210;

let crashRestartRequested = false;
let crashRecoveryDialogOpen = false;

const CRASH_RECOVERY_MESSAGES: Record<
  Locale,
  { message: string; detail: string; restart: string; later: string }
> = {
  "zh-CN": {
    message: "应用界面已崩溃",
    detail: "可以重启 OpenZWork 继续使用。所有应用窗口将关闭，未保存的内容可能丢失。",
    restart: "重启应用",
    later: "稍后",
  },
  "en-US": {
    message: "The app window has crashed",
    detail: "Restart OpenZWork to continue. All app windows will close. Unsaved changes may be lost.",
    restart: "Restart app",
    later: "Later",
  },
  "ja-JP": {
    message: "アプリ画面がクラッシュしました",
    detail:
      "OpenZWork を再起動して続行できます。すべてのアプリウィンドウが閉じ、未保存の内容が失われる場合があります。",
    restart: "アプリを再起動",
    later: "後で",
  },
  "ru-RU": {
    message: "Окно приложения аварийно завершило работу",
    detail:
      "Перезапустите OpenZWork, чтобы продолжить. Все окна приложения будут закрыты. Несохранённые изменения могут быть потеряны.",
    restart: "Перезапустить приложение",
    later: "Позже",
  },
  "ko-KR": {
    message: "앱 화면이 비정상 종료되었습니다",
    detail:
      "OpenZWork를 다시 시작하여 계속할 수 있습니다. 모든 앱 창이 닫히며 저장하지 않은 내용이 손실될 수 있습니다.",
    restart: "앱 다시 시작",
    later: "나중에",
  },
};

export function restartAppAfterCrash(logger: { info: (...args: unknown[]) => void }) {
  if (crashRestartRequested) return;
  crashRestartRequested = true;
  try {
    logger.info("[crash-recovery] restarting application");
    // 崩溃后 renderer 或 Host 可能无法完成退出屏障；用户选择紧急重启时直接退出，
    // 不再走普通 quit 的确认和清理等待，否则重启按钮仍可能卡住。
    app.relaunch();
    app.exit(0);
  } catch (error) {
    crashRestartRequested = false;
    throw error;
  }
}

export async function showRendererCrashDialog(options: {
  window: BrowserWindow;
  locale: Locale;
  isQuitting: () => boolean;
  logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}): Promise<void> {
  const { window: win, logger } = options;
  if (crashRecoveryDialogOpen || crashRestartRequested || win.isDestroyed() || options.isQuitting())
    return;
  crashRecoveryDialogOpen = true;
  try {
    const messages = CRASH_RECOVERY_MESSAGES[options.locale];
    if (win.isMinimized()) win.restore();
    win.show();
    const result = await dialog.showMessageBox(win, {
      type: "error",
      title: OPENZWORK_APP_NAME,
      message: messages.message,
      detail: messages.detail,
      buttons: [messages.restart, messages.later],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    // 弹窗等待期间用户可能已关窗、刷新或退出；旧响应不能再重启一个已恢复的实例。
    if (
      result.response === 0 &&
      !win.isDestroyed() &&
      win.webContents.isCrashed() &&
      !options.isQuitting()
    ) {
      restartAppAfterCrash(logger);
    }
  } catch (error) {
    logger.error("[crash-recovery] recovery dialog failed:", error);
  } finally {
    crashRecoveryDialogOpen = false;
  }
}

function resolveTargetWindow(senderWindow?: BrowserWindow | null) {
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }

  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
export function updateDesktopZoomLevel(
  targetWindow: BrowserWindow | null | undefined,
  action: "reset" | "in" | "out",
) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const currentLevel = resolveDesktopZoomLevelFromFactor(targetWindow.webContents.getZoomFactor());
  const nextLevel =
    action === "reset" ? 0 : clampDesktopZoomLevel(currentLevel + (action === "in" ? 1 : -1));

  // 系统缩放快捷键需要可用，但不能无限放大/缩小导致界面失控。
  // Electron zoomLevel 的真实比例是 1.2^level；这里改用 zoomFactor，保证每档统一为 1.1。
  targetWindow.webContents.setZoomFactor(resolveDesktopZoomFactorForLevel(nextLevel));
  syncWindowControlsOverlayForZoomLevel(targetWindow, nextLevel);
  targetWindow.webContents.send(PlatformChannels.DesktopZoomLevelChanged, { zoomLevel: nextLevel });
  return nextLevel;
}

function showMessageBoxWithOptionalParent(
  parentWindow: BrowserWindow | null | undefined,
  options: MessageBoxOptions,
) {
  return parentWindow
    ? dialog.showMessageBox(parentWindow, options)
    : dialog.showMessageBox(options);
}
async function clearAllDataAndRelaunch(options: {
  locale: Locale;
  credentialsDir: string;
  beforeClearAllData: () => Promise<void>;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}) {
  const zh = options.locale === "zh-CN";
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: zh ? ["取消", "清除数据"] : ["Cancel", "Clear Data"],
    defaultId: 0,
    cancelId: 0,
    title: zh ? "清除应用数据" : "Clear app data",
    message: zh ? "永久删除配置、凭据、日志和浏览器缓存？" : "Permanently delete settings, credentials, logs and browser storage?",
    detail: (zh ? "清除以下目录后应用将重启。" : "The app will restart after clearing this directory.") + "\n" + options.credentialsDir,
  });
  if (response !== 1) {
    return;
  }

  // 旧入口直接 exit 会跳过预装进程收尾；先停掉写入方，再清除 v2，避免退出时晚写。
  await options.beforeClearAllData();
  await getPluginSandboxHost()?.clearBrowserData();
  const { rm } = await import("node:fs/promises");
  try {
    await rm(options.credentialsDir, { recursive: true, force: true });
    options.logger.info("[clear-all-data] cleared app data directory");
  } catch (error) {
    options.logger.error("[clear-all-data] failed to clear app data directory:", error);
  }

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      await win.webContents.executeJavaScript("localStorage.clear()");
    } catch {
      // 窗口可能已经销毁，忽略
    }
  }

  try {
    const session = BrowserWindow.getAllWindows()[0]?.webContents.session;
    if (session) {
      await session.clearStorageData();
      options.logger.info("[clear-all-data] cleared session storage data");
    }
  } catch (error) {
    options.logger.error("[clear-all-data] failed to clear session data:", error);
  }

  app.relaunch();
  app.exit(0);
}

export function resolveLocalAppConfigPath(options?: {
  appPath?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
}): string {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  if (isPackaged) {
    // app.getAppPath() 在正式包中指向 resources/app.asar，向上两级后会误读
    // Contents/config。内置配置由 electron-builder 放在 resources/config，必须从 resourcesPath 解析。
    return join(options?.resourcesPath ?? process.resourcesPath, "config/default.json");
  }
  return join(options?.appPath ?? app.getAppPath(), "../../config/default.json");
}

async function readLocalAppConfig(readLocalConfig?: () => unknown): Promise<unknown> {
  const localConfigPath = resolveLocalAppConfigPath();
  return readLocalConfig?.() ?? JSON.parse(await readFile(localConfigPath, "utf-8"));
}

export async function resolveCommunityUrl(options: {
  locale: Locale;
  readLocalConfig?: () => unknown;
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): Promise<string | undefined> {
  let localConfig: unknown;
  try {
    localConfig = await readLocalAppConfig(options.readLocalConfig);
  } catch (error) {
    options.logger.warn("[community] failed to read local config:", error);
  }

  return getCommunityUrlFromConfigs(undefined, localConfig, options.locale);
}

async function openCommunity(
  locale: Locale,
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  },
) {
  const communityUrl = await resolveCommunityUrl({ locale, logger });
  if (!communityUrl) {
    logger.warn("[community] community_urls is missing from local config");
    return;
  }
  await shell.openExternal(communityUrl);
}

async function promptCustomZCodeEndpoint(
  targetWindow: BrowserWindow | null | undefined,
  currentValue: string,
): Promise<string | undefined> {
  return showZCodeEndpointPromptWindow({
    currentValue,
    parentWindow: targetWindow && !targetWindow.isDestroyed() ? targetWindow : undefined,
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildZCodeEndpointPromptHtml(currentValue: string): string {
  const value = escapeHtmlAttribute(currentValue);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ZCode Endpoint</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; height: 34px; padding: 6px 8px; font: inherit; }
      .hint { margin-top: 8px; color: #6b7280; font-size: 12px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      button { min-width: 78px; height: 30px; font: inherit; }
    </style>
  </head>
  <body>
    <form id="form">
      <label for="endpoint">ZCode endpoint origin</label>
      <input id="endpoint" value="${value}" placeholder="https://your-zcode-server.example.com" spellcheck="false" />
      <div class="hint">Use an http or https origin, for example https://your-zcode-server.example.com.</div>
      <div class="actions">
        <button id="cancel" type="button">Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
    <script>
      const input = document.getElementById("endpoint");
      const submit = (value) => { document.title = "zcode-endpoint-submit:" + encodeURIComponent(value); };
      document.getElementById("form").addEventListener("submit", (event) => {
        event.preventDefault();
        submit(input.value);
      });
      document.getElementById("cancel").addEventListener("click", () => {
        document.title = "zcode-endpoint-cancel";
      });
      input.focus();
      input.select();
    </script>
  </body>
</html>`;
}

function showZCodeEndpointPromptWindow(options: {
  currentValue: string;
  parentWindow?: BrowserWindow;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const promptWindow = new BrowserWindow({
      width: ZCODE_ENDPOINT_PROMPT_WIDTH,
      height: ZCODE_ENDPOINT_PROMPT_HEIGHT,
      parent: options.parentWindow,
      modal: Boolean(options.parentWindow),
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "ZCode Endpoint",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = (value: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
      if (!promptWindow.isDestroyed()) {
        promptWindow.close();
      }
    };

    promptWindow.on("closed", () => finish(undefined));
    promptWindow.on("page-title-updated", (event, title) => {
      if (title === "zcode-endpoint-cancel") {
        event.preventDefault();
        finish(undefined);
        return;
      }
      if (!title.startsWith("zcode-endpoint-submit:")) {
        return;
      }
      event.preventDefault();
      finish(decodeURIComponent(title.slice("zcode-endpoint-submit:".length)));
    });

    // Electron 菜单命令在主进程触发，调用 renderer 的 window.prompt 可能被禁用或没有焦点，表现为点击无反应。
    // 这里改为主进程创建受控 modal 输入窗，确保 Custom... 始终有可见交互入口。
    void promptWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        buildZCodeEndpointPromptHtml(options.currentValue),
      )}`,
    );
  });
}

async function setZCodeEndpointOverride(options: {
  value: string | undefined;
  settingService: { update(patch: { zcodeEndpointOrigin?: string | undefined }): Promise<void> };
  onZCodeEndpointChanged: () => Promise<void> | void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  if (ZCODE_ENV === "production") {
    return;
  }
  const normalized = options.value ? normalizeZCodeEndpointOrigin(options.value) : undefined;
  await options.settingService.update({ zcodeEndpointOrigin: normalized });
  await options.onZCodeEndpointChanged();
}

async function persistDesktopZoomLevel(options: {
  zoomLevel: number;
  logger: { warn: (...args: unknown[]) => void };
  settingService: { update(patch: Pick<AppSettings, "desktopZoomLevel">): Promise<void> };
}) {
  try {
    // 桌面缩放命令原本只改当前 BrowserWindow，重启后没有任何恢复来源。
    // 这里在命令成功后把夹取后的档位写入 setting.json，让快捷键、View 菜单和侧边栏菜单共享同一持久化事实源。
    await options.settingService.update({ desktopZoomLevel: options.zoomLevel });
  } catch (error) {
    options.logger.warn("[desktop-zoom] persist zoom level failed:", error);
  }
}

function toggleZCodeStdioTapDevProxy(options: {
  logger: { info: (...args: unknown[]) => void };
  updateZCodeStdioTapDevMenuState: () => void;
}) {
  const current = readZCodeStdioTapDevState();
  const next = setZCodeStdioTapDevEnabled(!current.enabled);
  options.updateZCodeStdioTapDevMenuState();
  options.logger.info("[stdio-tap] dev proxy toggled", {
    enabled: next.enabled,
    visible: next.visible,
    logDir: next.logDir,
  });
}

export async function executeDesktopCommand(options: {
  command: DesktopCommandId;
  senderWindow?: BrowserWindow | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  updateZCodeStdioTapDevMenuState: () => void;
  onDesktopZoomChanged?: (zoomLevel: number) => Promise<void> | void;
  onZCodeEndpointChanged: () => Promise<void> | void;
  onRelaunchApp: () => Promise<void>;
  beforeClearAllData: () => Promise<void>;
  settingService: {
    get(): Promise<Pick<AppSettings, "zcodeEndpointOrigin" | "desktopZoomLevel">>;
    update(
      patch: Partial<Pick<AppSettings, "zcodeEndpointOrigin" | "desktopZoomLevel">>,
    ): Promise<void>;
  };
  zcodeEndpointEnvBaseOrigin?: string | null;
  credentialsDir: string;
  currentApplicationLocale: Locale;
  /** 远控诊断：向已配对手机拉取日志并导出（窗口 id 为命令来源窗口）。 */
  pullMobileLogs?: (windowId: number | undefined) => Promise<unknown>;
}) {
  const targetWindow = resolveTargetWindow(options.senderWindow);
  options.logger.info(
    `[desktop-command] execute ${options.command} windowId=${targetWindow?.id ?? "<none>"}`,
  );

  switch (options.command) {
    case DesktopCommandIds.NewTask:
      targetWindow?.webContents.send(PlatformChannels.NewTask);
      return;
    case DesktopCommandIds.OpenWorkspace:
      targetWindow?.webContents.send(PlatformChannels.OpenWorkspace);
      return;
    case DesktopCommandIds.CloseActiveContext:
      targetWindow?.webContents.send(PlatformChannels.CloseActiveContextRequest);
      return;
    case DesktopCommandIds.CloseWindow:
      targetWindow?.close();
      return;
    case DesktopCommandIds.MinimizeWindow:
      targetWindow?.minimize();
      return;
    case DesktopCommandIds.ToggleMaximizeWindow:
      if (targetWindow?.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow?.maximize();
      }
      return;
    case DesktopCommandIds.ToggleFullScreen:
      if (targetWindow) {
        targetWindow.setFullScreen(!targetWindow.isFullScreen());
      }
      return;
    case DesktopCommandIds.ResetWindowSize:
      if (targetWindow) {
        if (targetWindow.isFullScreen()) targetWindow.setFullScreen(false);
        if (targetWindow.isMaximized()) targetWindow.unmaximize();
        targetWindow.setSize(DEFAULT_DESKTOP_WINDOW_WIDTH, DEFAULT_DESKTOP_WINDOW_HEIGHT, true);
      }
      return;
    case DesktopCommandIds.ResetZoom:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "reset");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomIn:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "in");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomOut:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "out");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ShowAbout:
      await showAboutDialog(targetWindow ?? undefined, options.currentApplicationLocale);
      return;
    case DesktopCommandIds.RelaunchApp:
      await options.onRelaunchApp();
      return;
    case DesktopCommandIds.RestartAfterCrash:
      restartAppAfterCrash(options.logger);
      return;
    case DesktopCommandIds.OpenCommunity:
      await openCommunity(options.currentApplicationLocale, options.logger);
      return;
    case DesktopCommandIds.ExportLogs:
      await exportLogs();
      return;
    case DesktopCommandIds.PullMobileLogs:
      await options.pullMobileLogs?.(targetWindow?.id);
      return;
    case DesktopCommandIds.ToggleDevTools:
      targetWindow?.webContents.toggleDevTools();
      return;
    case DesktopCommandIds.OpenResourceManager:
      openResourceManager();
      return;
    case DesktopCommandIds.ToggleZCodeStdioTapDevProxy:
      toggleZCodeStdioTapDevProxy({
        logger: options.logger,
        updateZCodeStdioTapDevMenuState: options.updateZCodeStdioTapDevMenuState,
      });
      return;
    case DesktopCommandIds.SetZCodeEndpointTest:
      await setZCodeEndpointOverride({
        value:
          options.zcodeEndpointEnvBaseOrigin ?? resolveRuntimeZCodeEndpointOrigin() ?? undefined,
        settingService: options.settingService,
        onZCodeEndpointChanged: options.onZCodeEndpointChanged,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.SetZCodeEndpointCustom: {
      const current = (await options.settingService.get()).zcodeEndpointOrigin ?? "";
      const value = await promptCustomZCodeEndpoint(targetWindow, current);
      if (!value) {
        return;
      }
      try {
        await setZCodeEndpointOverride({
          value,
          settingService: options.settingService,
          onZCodeEndpointChanged: options.onZCodeEndpointChanged,
          logger: options.logger,
        });
      } catch (error) {
        await showMessageBoxWithOptionalParent(targetWindow, {
          type: "error",
          title: "ZCode Endpoint",
          message: "Endpoint 无效",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    case DesktopCommandIds.ResetZCodeEndpoint:
      await setZCodeEndpointOverride({
        value: undefined,
        settingService: options.settingService,
        onZCodeEndpointChanged: options.onZCodeEndpointChanged,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.ClearAllData:
      await clearAllDataAndRelaunch({
        locale: options.currentApplicationLocale,
        credentialsDir: options.credentialsDir,
        beforeClearAllData: options.beforeClearAllData,
        logger: options.logger,
      });
      return;
  }
}
