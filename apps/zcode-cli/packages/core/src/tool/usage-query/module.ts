/**
 * usage-query-tool 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const usageQueryToolModule = {
  id: "usage-query-tool",
  requires: ["shared", "zcode-cli"],
  provides: ["usage-query-tool"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
