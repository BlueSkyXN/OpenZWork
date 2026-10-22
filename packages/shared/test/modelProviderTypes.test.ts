import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDER_TEMPLATE_IDS } from "../src/model-provider-types.js";

describe("model provider identities", () => {
  it("不再把已退出产品的 ZAPI 识别为 Built-in Provider", () => {
    expect(Object.values(BUILTIN_PROVIDER_TEMPLATE_IDS)).not.toContain("builtin:zapi");
  });
});
