import type { DataRelocationPlan } from "@zcode/shared/data-directory";
import type { CliStorageRelocationContract } from "./contract.js";

export async function relocateCopiedCli(
  port: CliStorageRelocationContract,
  plan: DataRelocationPlan,
) {
  await port.relocate(plan);
}
