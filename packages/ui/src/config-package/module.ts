/**
 * config-package-ui 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const configPackageUiModule = {
  id: "config-package-ui",
  requires: ["ui", "services", "shared", "config-package-contract", "config-package-service"],
  provides: ["config-package-ui"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
