import { usePaneRuntimeIdentityE2E } from "./contract.js";

/**
 * SessionPane 在 E2E 构建下用自身注入服务独立查询 runtime identity 的用法（组件形态示例）。
 * hook 只能在组件内调用；本示例同时固定 paneKey/active 的合同取值。
 */
export function ExamplePaneRuntimeIdentityE2E({ sessionId }: { sessionId: string | null }) {
  usePaneRuntimeIdentityE2E({
    paneKey: "v4-session-pane-workspace-main",
    workspacePath: "/repo/project",
    workspaceIdentity: null,
    remoteSessionId: null,
    active: Boolean(sessionId),
  });
  return null;
}
