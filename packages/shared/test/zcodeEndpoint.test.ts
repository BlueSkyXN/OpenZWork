import { describe, expect, it } from "vitest";
import {
  normalizeZCodeEndpointOrigin,
  pickProductEndpointEnv,
  resolveRuntimeZCodeEndpointOrigin,
  resolveRuntimeZCodeEnv,
  resolveZCodeEndpointOrigin,
} from "../src/zcodeEndpoint.js";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";

// 同步修复：端点解析仍供显式 relay 配置使用，测试按现有的缺配置语义恢复。
describe("explicit product endpoint configuration", () => {
  it.each(["test", "production"] as const)("%s 未配置时返回 undefined", (env) => {
    expect(resolveZCodeEndpointOrigin({ env })).toBeUndefined();
    expect(resolveRuntimeZCodeEndpointOrigin({ ZCODE_ENV: env })).toBeUndefined();
  });

  it("显式覆盖优先于环境地址，并只保留 origin", () => {
    expect(
      resolveZCodeEndpointOrigin({
        env: "production",
        envBaseOrigin: "https://relay.example.test",
        overrideOrigin: " http://localhost:3030/api/v1?key=value ",
      }),
    ).toBe("http://localhost:3030");
  });

  it("空白覆盖使用显式环境地址", () => {
    expect(
      resolveZCodeEndpointOrigin({
        envBaseOrigin: "https://relay.example.test/api/v1",
        overrideOrigin: " ",
      }),
    ).toBe("https://relay.example.test");
  });

  it("环境地址遵循统一、origin 和当前环境作用域的优先级", () => {
    const env = {
      ZCODE_ENV: "test",
      ZCODE_BASE_URL: "https://base.example.test/path",
      ZCODE_ENDPOINT_ORIGIN: "https://origin.example.test/path",
      ZCODE_TEST_BASE_URL: "https://test.example.test/path",
      ZCODE_PRODUCTION_BASE_URL: "https://prod.example.test/path",
    };
    expect(resolveRuntimeZCodeEndpointOrigin(env)).toBe("https://base.example.test");
    expect(resolveRuntimeZCodeEndpointOrigin({ ...env, ZCODE_BASE_URL: " " })).toBe(
      "https://origin.example.test",
    );
    expect(
      resolveRuntimeZCodeEndpointOrigin({ ...env, ZCODE_BASE_URL: " ", ZCODE_ENDPOINT_ORIGIN: "" }),
    ).toBe("https://test.example.test");
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "production",
        ZCODE_PRODUCTION_BASE_URL: env.ZCODE_PRODUCTION_BASE_URL,
      }),
    ).toBe("https://prod.example.test");
    expect(
      resolveRuntimeZCodeEndpointOrigin(env, {
        overrideOrigin: "https://override.example.test/path",
      }),
    ).toBe("https://override.example.test");
  });

  it("忽略空白地址且不使用另一个环境的地址", () => {
    expect(
      resolveRuntimeZCodeEndpointOrigin({
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: " ",
        ZCODE_ENDPOINT_ORIGIN: "\t",
        ZCODE_TEST_BASE_URL: "",
        ZCODE_PRODUCTION_BASE_URL: "https://prod.example.test",
      }),
    ).toBeUndefined();
  });

  it.each(["file:///tmp/example", "ws://localhost:3000", "invalid", " "])(
    "拒绝非法 origin: %s",
    (value) => {
      expect(() => normalizeZCodeEndpointOrigin(value)).toThrow();
    },
  );

  it("仅挑选非空的公开端点变量", () => {
    expect(
      pickProductEndpointEnv({
        ZCODE_BASE_URL: " https://relay.example.test/path ",
        ZCODE_ENDPOINT_ORIGIN: " ",
        UNRELATED_API_KEY: "test-fixture",
      }),
    ).toEqual({ ZCODE_BASE_URL: "https://relay.example.test/path" });
  });

  it("运行环境标识独立于端点配置", () => {
    expect(resolveRuntimeZCodeEnv({})).toBe("production");
    expect(resolveRuntimeZCodeEnv({ ZCODE_ENV: " TEST " })).toBe("test");
    expect(resolveRuntimeZCodeEnv({ ZCODE_ENV: "unknown" })).toBe("production");
  });

  it("设置与补丁都保留并规范化显式端点", () => {
    expect(
      appSettingsSchema.parse({ zcodeEndpointOrigin: "https://relay.example.test/path" })
        .zcodeEndpointOrigin,
    ).toBe("https://relay.example.test");
    expect(
      appSettingsPatchSchema.parse({ zcodeEndpointOrigin: "http://localhost:3030/foo" })
        .zcodeEndpointOrigin,
    ).toBe("http://localhost:3030");
  });
});
