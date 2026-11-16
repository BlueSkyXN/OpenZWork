/** 被测 pane 的 runtime identity 独立查询诊断（E2E 构建才启用，随 pane 生命周期清理）。 */
export const paneRuntimeIdentityE2EModule = {
  id: "pane-runtime-identity-e2e",
  requires: ["shared", "ui"],
  provides: ["pane-runtime-identity-e2e"],
  publicEntrypoints: ["index.ts"],
} as const;
