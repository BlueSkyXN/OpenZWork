import type {
  AppUsageStatsParams,
  CreateAppUsageServiceOptions,
  IAppUsageService,
} from "./appUsage.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("app-usage-service");

/** 仅把请求转给 Agent service 的本机管理进程，不保存快照或维护缓存。 */
export function createAppUsageService(options: CreateAppUsageServiceOptions): IAppUsageService {
  const isConfirmedDesktopLocalHost =
    options.runtimeSurface === "desktop_local_host" &&
    options.serviceAuthorityMode === "desktop-local";

  return {
    async getAppUsageStats(params: AppUsageStatsParams) {
      if (!isConfirmedDesktopLocalHost) {
        throw new Error("本地 App Usage 仅支持 Desktop 本地 Host");
      }
      try {
        return await options.zcodeAgentService.getAppUsageStats(params);
      } catch (error) {
        logger.warn("读取 App Usage 快照失败", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}
