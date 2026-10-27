import type { DataDirectoryContract } from "./contract.js";

export async function useBusinessRoot(
  port: DataDirectoryContract,
  root: string,
  run: () => Promise<void>,
) {
  const release = await port.acquireUse(root);
  try {
    await run();
  } finally {
    await release();
  }
}
