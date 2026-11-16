import { usePaneRuntimeIdentityE2E } from "./contract.js";

/** SessionPane 在 E2E 构建下用自身注入服务独立查询 runtime identity 的用法。 */
export function exampleUsePaneRuntimeIdentityE2E(sessionId: string | null) {
  usePaneRuntimeIdentityE2E({
    paneKey: "v4-session-pane-workspace-main",
    workspacePath: "/repo/project",
    workspaceIdentity: null,
    remoteSessionId: null,
    active: Boolean(sessionId),
  });
}
