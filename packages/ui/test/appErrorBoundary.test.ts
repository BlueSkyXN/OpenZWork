import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
// 同步修复：错误边界仍保留 fallback 与宿主回调，测试不再依赖已移除的遥测模块。
import { AppErrorBoundary, ScopedErrorBoundary } from "@/ErrorBoundary.js";
afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("出错后会渲染 fallback，而不是返回空白内容", () => {
    const boundary = new AppErrorBoundary({
      children: createElement("div", null, "ok"),
    });

    boundary.state = {
      error: new Error("boom"),
      componentStack: "\n    at BrokenPanel",
    };

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toMatch(/应用界面出了点问题|The app ran into a problem/);
    expect(html).toMatch(/重试|Try again/);
    expect(html).toMatch(/刷新应用|Reload app/);
    expect(html).toContain("boom");
    expect(html).toContain("BrokenPanel");
  });

  it("会把非 Error 抛出值包装成 Error 对象", () => {
    const state = AppErrorBoundary.getDerivedStateFromError("plain text failure");

    expect(state.error?.message).toBe("plain text failure");
    expect(state.componentStack).toBe("");
  });

  it("局部边界出错后只渲染区域 fallback", () => {
    const boundary = new ScopedErrorBoundary({
      children: createElement("div", null, "ok"),
      scope: "workspace-chat",
      resetKeys: ["workspace-a", "task-a"],
    });

    boundary.state = {
      error: new Error("chat exploded"),
      componentStack: "\n    at ChatView",
    };

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toMatch(/这块界面出了点问题|This section ran into a problem/);
    expect(html).toMatch(/重试此区域|Try this section again/);
    expect(html).toContain("chat exploded");
    expect(html).toContain("ChatView");
  });

  it("静默局部边界可以隐藏非关键浮层 fallback", () => {
    const boundary = new ScopedErrorBoundary({
      children: createElement("div", null, "ok"),
      scope: "desktop-top-overlay",
      variant: "silent",
    });

    boundary.state = {
      error: new Error("overlay exploded"),
      componentStack: "\n    at DesktopTopOverlay",
    };

    expect(renderToStaticMarkup(boundary.render())).toBe("");
  });

  it("根级边界记录异常并通知宿主回调", () => {
    const onCaughtReactError = vi.fn();
    const boundary = new AppErrorBoundary({
      children: createElement("div", null, "ok"),
      onCaughtReactError,
    });
    boundary.setState = vi.fn();
    const error = new Error("root boom");
    const errorInfo = { componentStack: "\n    at Root" };

    boundary.componentDidCatch(error, errorInfo);

    expect(onCaughtReactError).toHaveBeenCalledExactlyOnceWith(error, errorInfo);
    expect(boundary.setState).toHaveBeenCalledWith({ componentStack: errorInfo.componentStack });
  });

  it("局部边界保留 scope 并通知宿主回调", () => {
    const onCaughtReactError = vi.fn();
    const boundary = new ScopedErrorBoundary({
      children: createElement("div", null, "ok"),
      scope: "workspace-chat",
      onCaughtReactError,
    });
    boundary.setState = vi.fn();
    const errorInfo = { componentStack: "\n    at ChatView" };

    boundary.componentDidCatch("chat boom", errorInfo);

    expect(onCaughtReactError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "chat boom" }),
      errorInfo,
      "workspace-chat",
    );
    expect(boundary.setState).toHaveBeenCalledWith({ componentStack: errorInfo.componentStack });
  });
});
