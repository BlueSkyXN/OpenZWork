/**
 * host-storage-relocation 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { HostStorageRelocationContract } from "./contract.js";
import type { DataRelocationPlan } from "@zcode/shared/data-directory";

export async function relocateCopiedHost(
  contract: HostStorageRelocationContract,
  plan: DataRelocationPlan,
): Promise<void> {
  await contract.relocate(plan);
}
