import type { AppSettings } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** Host 私有装配端口：只读取本机已提交目录，禁止递归读取设置或网络。 */
export type WorkspaceSettingsProjection = Pick<
  AppSettings,
  "lastActiveWorkspace" | "lastWorkspaceSession" | "recentProjects" | "lastActiveTabIndex"
>;

export interface ISettingService {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<void>;
  /** Change the data base directory: copy data from old → new location, then persist the setting. */
  updateDataBaseDir(newDir: string | undefined): Promise<void>;
}

export const ISettingService = createServiceDescriptor<ISettingService>(ServiceChannels.Setting);
