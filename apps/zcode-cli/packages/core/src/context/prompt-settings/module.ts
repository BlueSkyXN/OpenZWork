/**
 * system-prompt-context 模块清单（architecture-governance managed 模块）。
 * 层：domain。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const systemPromptContextModule = {
  id: "system-prompt-context",
  requires: ["shared", "system-prompt-contract", "zcode-cli"],
  provides: ["system-prompt-context"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
