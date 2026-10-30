import { expect, it, vi } from "vitest";
import { queryUsageToolEntry } from "./contract.js";
import type { ToolHandlerContext } from "../types.js";
it("queries the Host port with strict input and preserves scope information", async () => {
  const signal = new AbortController().signal;
  const query = vi.fn(async () =>
    JSON.stringify({ projectId: "project-a", summary: { totalTokens: 120 } }),
  );
  const context = {
    abortSignal: signal,
    usageQueryPort: { query },
  } as unknown as ToolHandlerContext;
  const result = await queryUsageToolEntry.handler({ projectId: "project-a" }, context);
  expect(query).toHaveBeenCalledWith({ range: "30d", projectId: "project-a" }, signal);
  expect(result).toEqual({
    report: JSON.stringify({ projectId: "project-a", summary: { totalTokens: 120 } }),
  });
  expect(queryUsageToolEntry.metadata.readOnly).toBe(true);
  await expect(
    queryUsageToolEntry.handler({ sessionIds: ["untrusted"] }, context),
  ).rejects.toThrow();
});
it("reports missing capability rather than returning zero usage", async () => {
  await expect(queryUsageToolEntry.handler({}, {} as ToolHandlerContext)).rejects.toThrow(
    /unavailable/,
  );
});
