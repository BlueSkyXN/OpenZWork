import { describe, expect, it } from "vitest";
import {
  shouldBlockRootRender,
  shouldShowRootStartupLoading,
  shouldOpenFallbackWorkspaceAfterCreate,
} from "@/lib/rootStartupGate.js";

const ready = {
  isResolvingProviderStartupState: false,
  isRestoring: false,
  isBootstrappingInitialWorkspace: false,
};

describe("Root startup gate", () => {
  it.each(Object.keys(ready))("%s 未完成时阻塞首屏", (key) => {
    expect(shouldBlockRootRender({ ...ready, [key]: true })).toBe(true);
  });

  it("所有保留的启动检查完成后放行首屏", () => {
    expect(shouldBlockRootRender(ready)).toBe(false);
  });

  it("桌面显示启动 loading，Web 使用自身连接状态", () => {
    const pending = { ...ready, isRestoring: true };
    expect(shouldShowRootStartupLoading({ ...pending, isDesktop: true })).toBe(true);
    expect(shouldShowRootStartupLoading({ ...pending, isDesktop: false })).toBe(false);
    expect(shouldShowRootStartupLoading({ ...ready, isDesktop: true })).toBe(false);
  });

  it("兜底工作区只在组件仍挂载且尚未恢复活动工作区时打开", () => {
    expect(shouldOpenFallbackWorkspaceAfterCreate({ isMounted: true, activeWorkspacePath: null })).toBe(true);
    expect(shouldOpenFallbackWorkspaceAfterCreate({ isMounted: true, activeWorkspacePath: "/fixture/workspace" })).toBe(false);
    expect(shouldOpenFallbackWorkspaceAfterCreate({ isMounted: false, activeWorkspacePath: null })).toBe(false);
  });
});
