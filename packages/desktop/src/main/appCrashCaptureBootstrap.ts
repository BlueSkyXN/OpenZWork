import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 须在 early bootstrap 之后完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// 私有化分支无远端 crash 上报，本地 crashReporter 始终启动（uploadToServer:false）。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
