import type { AppUsageRange, AppUsageSnapshot, ServiceAuthorityMode } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";

export interface AppUsageStatsParams {
  range: AppUsageRange;
  timeZone?: string;
}

export interface CreateAppUsageServiceOptions {
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
  runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  serviceAuthorityMode?: ServiceAuthorityMode;
}

export interface IAppUsageService {
  getAppUsageStats(params: AppUsageStatsParams): Promise<AppUsageSnapshot>;
}

export const IAppUsageService = createServiceDescriptor<IAppUsageService>("app-usage");
