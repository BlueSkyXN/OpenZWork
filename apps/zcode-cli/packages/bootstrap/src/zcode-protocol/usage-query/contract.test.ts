import { expect, it, vi } from "vitest";
import { createProtocolUsageQueryPort } from "./contract.js";
import type { ZCodeProtocolAgentServerContext } from "../server-types.js";
it("uses the existing Host request channel and honors cancellation", async () => {
  const requestClient = vi.fn(async () => ({ report: "fixture-report" }));
  const port = createProtocolUsageQueryPort({
    requestClient,
  } as unknown as ZCodeProtocolAgentServerContext);
  const control = new AbortController();
  expect(await port.query({ range: "7d", projectId: null }, control.signal)).toBe("fixture-report");
  expect(requestClient).toHaveBeenCalledWith(
    "app/usage/query",
    { range: "7d", projectId: null },
    expect.anything(),
    expect.objectContaining({ signal: control.signal }),
  );
  control.abort();
  await expect(port.query({ range: "7d" }, control.signal)).rejects.toThrow();
  expect(requestClient).toHaveBeenCalledTimes(1);
});
