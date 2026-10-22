import { describe, expect, it } from "vitest";
import {
  getE2EProviderEndpointEnv,
  shouldUseProductionE2EProviderEndpoint,
} from "#e2e/helpers/e2e-provider-endpoint";

describe("E2E provider endpoint ownership", () => {
  it.each([
    ["deepseek", "replay"],
    ["example-preset", "capture"],
    ["api-key", "replay"],
  ])("普通 %s/%s fixture不注入产品控制面", (preset, mode) => {
    const specs = ["conversation-session-v4-sendnow.test.ts"];
    expect(getE2EProviderEndpointEnv(specs, preset, mode)).toEqual({});
    expect(shouldUseProductionE2EProviderEndpoint(specs, preset, mode)).toBe(false);
  });
});
