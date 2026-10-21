/** WDIO 入口维护隔离测试环境，不持有产品运行时状态。 */
export const desktopE2ERunnerModule = {
  id: "desktop-e2e-runner",
  requires: [],
  provides: ["desktop-e2e-config"],
  publicEntrypoints: [
    "packages/desktop/wdio.conf.ts",
    "packages/desktop/test/e2e/runner/contract.ts",
  ],
} as const;
