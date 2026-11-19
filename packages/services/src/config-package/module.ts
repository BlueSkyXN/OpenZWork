/**
 * config-package-service 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const configPackageServiceModule = {
  id: "config-package-service",
  requires: [
    "shared",
    "services",
    "config-package-contract",
    "data-sync-service",
    "provider-node",
    "provider",
  ],
  provides: ["config-package-service"],
  publicEntrypoints: ["index.ts", "contract.ts", "node.ts"],
} as const;
