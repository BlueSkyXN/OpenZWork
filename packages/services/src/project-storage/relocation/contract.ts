/**
 * host-storage-relocation 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 */
import type { AppSettings } from "@zcode/shared";
import type { DataRelocationPlan } from "@zcode/shared/data-directory";

export interface HostStorageRelocationContract {
  /** 转换未发布副本；冲突与坏数据抛错，不改变源库和稳定业务 ID。 */
  relocate(plan: DataRelocationPlan): Promise<void>;
  /** 返回本地工作区路径已转换的设置；由设置 owner 与启动指针一起提交。 */
  settings(settings: AppSettings, plan: DataRelocationPlan): AppSettings;
}
