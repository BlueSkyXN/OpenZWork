import { describe, expect, expectTypeOf, it } from "vitest";
import { migrateLegacyModelProviderId } from "../src/legacy-model-provider-identity.js";

describe("旧 Provider 身份仅在升级边界静态转换", () => {
  it("迁移接口不接受账号或 Registry 上下文", () => {
    expectTypeOf(migrateLegacyModelProviderId).parameters.toEqualTypeOf<[providerId: string]>();
  });
  for (const family of ["bigmodel", "zai"] as const) {
    it(`${family} 只转换旧 API 模板，保留已退役账号身份`, () => {
      const pairs = [[`builtin:${family}`, `${family}-api`]];
      expect(migrateLegacyModelProviderId(`builtin:${family}-start-plan`)).toBeUndefined();
      expect(migrateLegacyModelProviderId(`builtin:${family}-coding-plan`)).toBeUndefined();
      for (const [oldId, currentId] of pairs) {
        expect(migrateLegacyModelProviderId(oldId!)).toBe(currentId);
        expect(migrateLegacyModelProviderId(currentId!)).toBe(currentId);
      }
    });
  }
  it("退役内置留空，普通未知 ID 不被当成旧格式或按模型名替换", () => {
    expect(migrateLegacyModelProviderId("builtin:zapi")).toBeUndefined();
    expect(migrateLegacyModelProviderId("builtin:unknown")).toBeUndefined();
    expect(migrateLegacyModelProviderId("user-proxy")).toBe("user-proxy");
    expect(migrateLegacyModelProviderId("account:bigmodel-team-coding-plan")).toBe(
      "account:bigmodel-team-coding-plan",
    );
  });
});
