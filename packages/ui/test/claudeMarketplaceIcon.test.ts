// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginIcon } from "../src/components/PluginIcon.js";
import { isTrustedPluginIconSource, resolvePluginIconSource } from "../src/lib/pluginIconSource.js";

afterEach(cleanup);

describe("Claude Code 公开市场的插件图标", () => {
  it("清单内的 HTTPS 图标优先；历史映射或缺失图标使用已随桌面和 Web 交付的素材", () => {
    const id = "figma@claude-plugins-official";
    const own = "https://example.invalid/declared.png";
    expect(resolvePluginIconSource(id, own)).toBe(own);
    const bundled = resolvePluginIconSource(id, "assets/figma/icon.png");
    expect(bundled).toMatch(/\/material-icons\/figma\.svg$/);
    expect(resolvePluginIconSource(id)).toBe(bundled);
    expect(isTrustedPluginIconSource(bundled)).toBe(true);
    for (const directory of ["../../desktop/src/renderer/public", "../../web/public"]) {
      expect(existsSync(new URL(directory + "/material-icons/figma.svg", import.meta.url))).toBe(
        true,
      );
    }
  });

  it("同名的其他市场和没有匹配素材的插件沿用默认图标", () => {
    expect(resolvePluginIconSource("figma@other-market", "assets/figma/icon.png")).toBeUndefined();
    expect(
      resolvePluginIconSource("not-bundled@claude-plugins-official", "assets/other/icon.png"),
    ).toBeUndefined();
    expect(isTrustedPluginIconSource("assets/figma/icon.png")).toBe(false);
  });

  it("HTTPS 失败后只试一次随包图标，切换来源或市场时重新加载", () => {
    const id = "figma@claude-plugins-official";
    const src = "https://example.invalid/missing.png";
    const el = (pluginId: string, url: string) =>
      createElement(PluginIcon, { pluginId, src: url, fallbackIcon: "通用图标" });
    const view = render(el(id, src));
    const image = () => view.container.querySelector("img")!;
    expect(image().getAttribute("src")).toBe(src);
    fireEvent.error(image());
    expect(image().getAttribute("src")).toBe(resolvePluginIconSource(id));
    fireEvent.error(image());
    expect(view.queryByText("通用图标")).toBeTruthy();
    const replacement = "https://example.invalid/replacement.png";
    view.rerender(el(id, replacement));
    expect(image().getAttribute("src")).toBe(replacement);
    view.rerender(el("figma@other-market", replacement));
    fireEvent.error(image());
    expect(view.queryByText("通用图标")).toBeTruthy();
    view.rerender(el(id, "assets/figma/icon.png"));
    expect(image().getAttribute("src")).toBe(resolvePluginIconSource(id));
    fireEvent.error(image());
    expect(view.queryByText("通用图标")).toBeTruthy();
  });
});
