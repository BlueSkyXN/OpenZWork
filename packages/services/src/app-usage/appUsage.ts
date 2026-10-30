import type { ProjectTree } from "../project/contract.js";
import type {
  AppUsageRange,
  AppUsageSnapshot,
  AppUsageSessionsPage,
  ServiceAuthorityMode,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";

export interface AppUsageStatsParams {
  range: AppUsageRange;
  timeZone?: string;
  until?: number;
  projectId?: string | null;
  includeProjects?: boolean;
  /** 仅由 Host 权威归属解析后传入 CLI。 */
  sessionIds?: readonly string[];
}
export interface AppUsageSessionsParams extends AppUsageStatsParams {
  offset: number;
  limit: number;
}
export interface CreateAppUsageServiceOptions {
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats"> &
    Partial<Pick<IZCodeAgentService, "getAppUsageSessions">>;
  readProjectTree?: () => Promise<ProjectTree>;
  runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  serviceAuthorityMode?: ServiceAuthorityMode;
}
export interface IAppUsageService {
  getAppUsageStats(params: AppUsageStatsParams): Promise<AppUsageSnapshot>;
  getAppUsageSessions(params: AppUsageSessionsParams): Promise<AppUsageSessionsPage>;
}
export const IAppUsageService = createServiceDescriptor<IAppUsageService>("app-usage");
