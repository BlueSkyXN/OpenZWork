import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_MARKETPLACES, isPublicStoreMarketplaceId } from "../src/index.js";

describe("DEFAULT_PLUGIN_MARKETPLACES", () => {
  it("starts without implicit official marketplace sources", () => {
    expect(DEFAULT_PLUGIN_MARKETPLACES).toEqual([]);
  });

  it("classifies only the ZCode-operated channels as public store marketplaces", () => {
    expect(isPublicStoreMarketplaceId("zcode-plugins-official")).toBe(true);
    expect(isPublicStoreMarketplaceId("zcode-plugins")).toBe(false);
    // Claude 官方市场受信但不属于「公开」分段（归个人），见 CONTEXT.md 术语表。
    expect(isPublicStoreMarketplaceId("claude-plugins-official")).toBe(false);
    expect(isPublicStoreMarketplaceId("inline")).toBe(false);
  });
});
