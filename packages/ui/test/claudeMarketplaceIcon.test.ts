import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTrustedPluginIconSource, resolvePluginIconSource } from "../src/lib/pluginIconSource.js";

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
});
