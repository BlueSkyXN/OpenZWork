// @vitest-environment jsdom
// OW-P025 回归：插件市场已是主视图时，从设置层再次进入市场必须置 preserve 标记，
// 否则设置退出流程会把市场切回对话（上游同缺陷，顺序执行
// plugin-localization-creator 两用例时复现：run 155209494 case2 openPluginSettings 超时）。

import { createElement, useState } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceMainViewSettingsExit } from "@/app-shell/useWorkspaceMainViewSettingsExit.js";

function SettingsExitHarness({
  onExitSettings,
  onPreserve,
}: {
  onExitSettings: () => void;
  onPreserve: (preserve: () => void) => void;
}) {
  // workspaceVisible=false 对应设置层打开（workspace 不可见）；主视图初始为 plugin-store。
  const [workspaceVisible, setWorkspaceVisible] = useState(false);
  const [mainView, setMainView] = useState<"plugin-store" | "chat">("plugin-store");
  const { preserveNextSettingsExit } = useWorkspaceMainViewSettingsExit({
    isWorkspaceVisible: workspaceVisible,
    workspaceMainView: mainView,
    onExitSettings,
  });
  onPreserve(preserveNextSettingsExit);
  return createElement(
    "div",
    null,
    createElement("button", {
      type: "button",
      "data-testid": "open-settings",
      onClick: () => setWorkspaceVisible(false),
    }),
    createElement("button", {
      type: "button",
      "data-testid": "close-settings",
      onClick: () => setWorkspaceVisible(true),
    }),
    createElement("button", {
      type: "button",
      "data-testid": "go-chat",
      onClick: () => setMainView("chat"),
    }),
    createElement("span", { "data-testid": "main-view" }, mainView),
  );
}

afterEach(cleanup);

describe("useWorkspaceMainViewSettingsExit 插件市场保留（OW-P025）", () => {
  it("设置层打开时 preserve 后关闭设置不退出市场视图", () => {
    const onExitSettings = vi.fn();
    let preserve: (() => void) | null = null;
    render(
      createElement(SettingsExitHarness, {
        onExitSettings,
        onPreserve: (p) => {
          preserve = p;
        },
      }),
    );

    // 设置层打开（workspace 不可见）时置标记：对应从设置页再次点击“浏览插件商店”。
    act(() => {
      preserve?.();
    });

    // 关闭设置：主视图未变化且已 consume preserve 标记，不得触发退出导航。
    const closeSettings = document.querySelector('[data-testid="close-settings"]')!;
    act(() => {
      closeSettings.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onExitSettings).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="main-view"]')!.textContent).toBe("plugin-store");
  });

  it("未 preserve 时关闭设置回到对话视图（既有语义不回归）", () => {
    const onExitSettings = vi.fn();
    render(
      createElement(SettingsExitHarness, { onExitSettings, onPreserve: () => {} }),
    );

    const closeSettings = document.querySelector('[data-testid="close-settings"]')!;
    act(() => {
      closeSettings.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onExitSettings).toHaveBeenCalledTimes(1);
  });

  it("workspace 可见时 preserve 写入被守卫拒绝，不吞掉后续真实退出", () => {
    const onExitSettings = vi.fn();
    let preserve: (() => void) | null = null;
    const view = render(
      createElement(SettingsExitHarness, {
        onExitSettings,
        onPreserve: (p) => {
          preserve = p;
        },
      }),
    );

    // 关闭设置（workspace 可见）后市场内重复打开：preserve 不得写入。
    const closeSettings = view.container.querySelector('[data-testid="close-settings"]')!;
    act(() => {
      closeSettings.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      preserve?.();
    });
    expect(onExitSettings).toHaveBeenCalledTimes(1);

    // 再次打开设置并直接关闭：没有残留 preserve 标记，退出语义正常。
    const openSettings = view.container.querySelector('[data-testid="open-settings"]')!;
    act(() => {
      openSettings.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      closeSettings.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExitSettings).toHaveBeenCalledTimes(2);
  });
});
