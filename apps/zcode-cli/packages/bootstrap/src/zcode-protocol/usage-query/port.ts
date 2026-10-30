import type { UsageQueryPort } from "@zcode/contracts";
import {
  appUsageToolParamsSchema,
  appUsageToolResultSchema,
  zcodeProtocolMethods,
} from "@zcode/shared";
import type { ZCodeProtocolAgentServerContext } from "../server-types.js";

export function createProtocolUsageQueryPort(
  context: ZCodeProtocolAgentServerContext,
): UsageQueryPort {
  return {
    async query(input, signal) {
      signal.throwIfAborted();
      const result = await context.requestClient(
        zcodeProtocolMethods.appUsageQuery,
        appUsageToolParamsSchema.parse(input),
        appUsageToolResultSchema,
        { signal, timeoutMs: 30_000 },
      );
      signal.throwIfAborted();
      return result.report;
    },
  };
}
