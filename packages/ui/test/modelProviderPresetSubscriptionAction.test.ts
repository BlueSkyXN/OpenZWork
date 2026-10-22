import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("API Key 配置页保持自有 Provider 编辑入口，去除官方订阅登录动作", () => {
  const source = readFileSync(new URL("../src/settings/ModelProviderSection.tsx", import.meta.url), "utf8");
  expect(source).toContain("ModelProviderSectionDetail");
  expect(source).not.toMatch(/onPresetSubscriptionLogin|onCodingPlanLogin|useCodingPlanEntitlements|startOAuth/u);
});
