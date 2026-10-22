import { describe, expect, it } from "vitest";
import { resolveHelpAppConfig } from "../src/helpAppConfig.js";

describe("本地帮助配置", () => {
  it("读取打包的社区链接并按语言回退，忽略已退役反馈配置", () => {
    expect(
      resolveHelpAppConfig({
        community_urls: {
          "zh-CN": "https://community.example/zh",
          "en-US": "https://community.example/en",
        },
        feedback_url: "https://retired.example",
      }),
    ).toEqual({
      community_urls: {
        "zh-CN": "https://community.example/zh",
        "en-US": "https://community.example/en",
      },
    });
  });
  it("缺少或损坏本地配置时不恢复官方默认地址", () => {
    expect(resolveHelpAppConfig({})).toEqual({
      community_urls: { "zh-CN": undefined, "en-US": undefined },
    });
    expect(resolveHelpAppConfig({ community_urls: 123 })).toEqual(resolveHelpAppConfig({}));
  });
});
