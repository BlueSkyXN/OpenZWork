import type { IAppUsageService, IServiceAccessor } from "@zcode/services";
import { isLocalBaseWorkspaceServices } from "../store/remoteWorkspaceSessionStore.js";

/** 只有 Desktop 显式注册的可信本地 base accessor 可用于本机 App Usage。 */
export function getLocalAppUsageService(services: IServiceAccessor): IAppUsageService | undefined {
  return isLocalBaseWorkspaceServices(services) ? services.appUsageService : undefined;
}
