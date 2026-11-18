/**
 * workflow-query 模块清单（architecture-governance managed 模块）。
 * 范围：已保存工作流两项读取共用的独立查询 lane——共享资格判定、manager 工厂与
 * 载体选择。层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const workflowQueryModule = {
  id: "workflow-query",
  requires: ["shared", "services"],
  provides: ["workflow-query"],
  publicEntrypoints: ["contract.ts", "workflowQueryRuntime.ts"],
} as const;
