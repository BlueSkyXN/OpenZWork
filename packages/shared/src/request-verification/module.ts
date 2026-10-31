/** 发行策略边界；请求状态与异步编排仍由调用方持有。 */
export const requestVerificationModule = {
  id: "request-verification",
  requires: ["shared"],
  provides: ["request-verification"],
  publicEntrypoints: ["index.ts", "policy.ts", "verification-policy.ts", "contract.ts"],
} as const;
