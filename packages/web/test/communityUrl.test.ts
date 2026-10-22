import { describe, expect, it, vi } from "vitest";
import { resolveWebCommunityUrl, resolveWebHelpConfig } from "../src/communityUrl.js";

const localConfig = { community_urls: { "zh-CN": "https://example.test/community", "en-US": "https://example.test/discussions" } };

describe("本地帮助配置", () => {
  it("按语言读取打包配置，不发起远端拉取", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await resolveWebCommunityUrl("zh-CN", { localConfig })).toBe(localConfig.community_urls["zh-CN"]);
      expect(await resolveWebCommunityUrl("en-US", { localConfig })).toBe(localConfig.community_urls["en-US"]);
      expect(await resolveWebHelpConfig({ localConfig })).toMatchObject(localConfig);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("未配置的语言不拼造地址", async () => {
    expect(await resolveWebCommunityUrl("en-US", { localConfig: { community_urls: { "zh-CN": "https://example.test/community" } } })).toBeUndefined();
  });
});
