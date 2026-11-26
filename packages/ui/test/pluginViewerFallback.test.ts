import { expect, it } from "vitest";
import {
  getActiveSidePaneTab,
  openCodeViewerSidePane,
  setActiveSidePaneTab,
  stampSidePaneTabsOwnership,
} from "../src/lib/workspaceSidePane.js";
import { openFilePreviewAfterPluginFailure } from "../src/plugin-ui/officeViewerOpen.js";
import { openPluginUiSidePane } from "../src/plugin-ui/sidePane/pluginUiSidePaneTab.js";

// OW-P047：从文件树打开的查看器失败时，用户应看到当前文件的内容。
const source = {
  type: "file" as const,
  path: "report.xlsx",
  title: "report.xlsx",
  workspacePath: "/project",
};
const scope = { workspaceKey: "/project", ownerTaskId: "session-1" };
const panel = openPluginUiSidePane(null, {
  workspacePath: "/project",
  workspaceKey: "/project",
  parentSessionId: "session-1",
  pluginId: "spreadsheets@zcode-plugins-official",
  surfaceId: "spreadsheets",
  resourceUri: "ui://spreadsheets/panel.html",
  title: source.title,
  instanceId: "file:report.xlsx",
});

it("打开并聚焦原文件的预览，保留插件标签，再次失败时复用预览", () => {
  const next = stampSidePaneTabsOwnership(
    openFilePreviewAfterPluginFailure(panel, panel.activeTabId, source, scope),
    scope,
  );
  expect(getActiveSidePaneTab(next)).toMatchObject({
    type: "code-viewer",
    source,
    ownerTaskId: "session-1",
  });
  const refocused = setActiveSidePaneTab(next, panel.activeTabId);
  const repeated = openFilePreviewAfterPluginFailure(refocused, panel.activeTabId, source, scope);
  expect(repeated?.tabs).toHaveLength(2);
  expect(repeated?.activeTabId).toBe(next?.activeTabId);
});

it("迟到的失败不会抢占另一个文件或重新打开已关闭的面板", () => {
  const other = openCodeViewerSidePane(
    panel,
    { ...source, path: "other.xlsx", title: "other.xlsx" },
    "session-1",
  );
  expect(openFilePreviewAfterPluginFailure(other, panel.activeTabId, source, scope)).toBe(other);
  expect(
    openFilePreviewAfterPluginFailure(panel, panel.activeTabId, source, {
      ...scope,
      ownerTaskId: "session-2",
    }),
  ).toBe(panel);
  expect(openFilePreviewAfterPluginFailure(null, panel.activeTabId, source, scope)).toBeNull();
});
