import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeZCodeEndpointOrigin } from "@zcode/shared";
import {
  buildAgentCaCertEnv,
  buildAgentEndpointOriginEnv,
  buildAgentNoProxyEnv,
  buildAgentProxyEnv,
  buildAgentRuntimeEnv,
  buildAgentWorkspaceIdentityEnv,
} from "../src/runtime-tools/agentProxyEnv.js";

describe("buildAgentProxyEnv", () => {
  it("returns an empty patch when no proxy is configured", () => {
    expect(buildAgentProxyEnv(undefined)).toEqual({});
    expect(buildAgentProxyEnv("")).toEqual({});
    expect(buildAgentProxyEnv("   ")).toEqual({});
  });

  it("sets the standard uppercase proxy keys plus ZCODE_HTTP_PROXY", () => {
    expect(buildAgentProxyEnv("http://127.0.0.1:7890")).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      ZCODE_HTTP_PROXY: "http://127.0.0.1:7890",
    });
  });

  it("prepends http:// to a bare host:port", () => {
    expect(buildAgentProxyEnv("127.0.0.1:7890").HTTP_PROXY).toBe("http://127.0.0.1:7890");
  });

  it("preserves an explicit scheme such as socks5", () => {
    expect(buildAgentProxyEnv("socks5://127.0.0.1:1080").ALL_PROXY).toBe("socks5://127.0.0.1:1080");
  });
});

describe("buildAgentCaCertEnv", () => {
  it("returns an empty patch without a cert path", () => {
    expect(buildAgentCaCertEnv(undefined)).toEqual({});
    expect(buildAgentCaCertEnv("  ")).toEqual({});
  });

  it("sets NODE_EXTRA_CA_CERTS and ZCODE_AGENT_CA_CERT to the cert path", () => {
    expect(buildAgentCaCertEnv("/tmp/zcode-network-ca.pem")).toEqual({
      NODE_EXTRA_CA_CERTS: "/tmp/zcode-network-ca.pem",
      ZCODE_AGENT_CA_CERT: "/tmp/zcode-network-ca.pem",
    });
  });
});

describe("buildAgentNoProxyEnv", () => {
  it("returns an empty patch without bypass rules", () => {
    expect(buildAgentNoProxyEnv(undefined)).toEqual({});
    expect(buildAgentNoProxyEnv("  ")).toEqual({});
  });

  it("sets standard no-proxy keys plus ZCODE_NO_PROXY", () => {
    expect(buildAgentNoProxyEnv(" localhost, 127.0.0.1 ,.example.com ")).toEqual({
      NO_PROXY: "localhost,127.0.0.1,.example.com",
      no_proxy: "localhost,127.0.0.1,.example.com",
      ZCODE_NO_PROXY: "localhost,127.0.0.1,.example.com",
    });
  });
});

describe("buildAgentRuntimeEnv", () => {
  it("merges proxy, no-proxy and the configured CA cert", () => {
    expect(
      buildAgentRuntimeEnv({
        httpProxy: "http://127.0.0.1:7890",
        noProxy: "localhost,127.0.0.1",
        caCertPath: "/tmp/root-ca.pem",
      }),
    ).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      ZCODE_HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
      no_proxy: "localhost,127.0.0.1",
      ZCODE_NO_PROXY: "localhost,127.0.0.1",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      ZCODE_AGENT_CA_CERT: "/tmp/root-ca.pem",
    });
  });

  it("injects no CA when the setting is empty, even if proxy is configured", () => {
    expect(buildAgentRuntimeEnv({ httpProxy: "http://127.0.0.1:7890" })).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      ZCODE_HTTP_PROXY: "http://127.0.0.1:7890",
    });
  });

  it("injects the configured CA even without a proxy", () => {
    expect(
      buildAgentRuntimeEnv({ httpProxy: undefined, caCertPath: " /tmp/root-ca.pem " }),
    ).toEqual({
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      ZCODE_AGENT_CA_CERT: "/tmp/root-ca.pem",
    });
  });
});

/* CR-01：官方 MCP 信任判定的单源不变量。
   两侧共用 @zcode/shared 的同一份实现，但只有"输入也相同"时结论才必然一致。
   host 的输入是 env + settings 覆盖，agent 的输入只有 env——因此必须把 host 解析出的
   权威 origin 通过 ZCODE_BASE_URL 下发，否则 test env + 自定义端点时两侧必然分叉。 */
describe("buildAgentEndpointOriginEnv", () => {
  it("returns an empty patch when the origin is missing or blank", () => {
    expect(buildAgentEndpointOriginEnv(undefined)).toEqual({});
    expect(buildAgentEndpointOriginEnv("")).toEqual({});
    expect(buildAgentEndpointOriginEnv("   ")).toEqual({});
  });

  it("pins the resolved origin onto ZCODE_BASE_URL", () => {
    expect(buildAgentEndpointOriginEnv("https://config.example.test")).toEqual({
      ZCODE_BASE_URL: "https://config.example.test",
    });
  });

  it("outranks the inherited endpoint keys it must override", () => {
    // ZCODE_BASE_URL 必须压过继承来的 ZCODE_ENDPOINT_ORIGIN / ZCODE_TEST_BASE_URL，
    // 否则注入了也不生效。
    const hostEnv = {
      ZCODE_ENDPOINT_ORIGIN: "https://inherited-endpoint.example",
      ZCODE_ENV: "test",
      ZCODE_TEST_BASE_URL: "https://inherited-test.example",
    };
    const agentEnv = {
      ...hostEnv,
      ...buildAgentEndpointOriginEnv("https://authoritative.example"),
    };

    expect(resolveRuntimeZCodeEndpointOrigin(agentEnv)).toBe("https://authoritative.example");
  });
});

describe("buildAgentWorkspaceIdentityEnv", () => {
  it("injects only a trimmed remote workspace identity", () => {
    expect(buildAgentWorkspaceIdentityEnv(" remote:ssh:host:/repo ")).toEqual({
      ZCODE_WORKSPACE_IDENTITY: "remote:ssh:host:/repo",
    });
    expect(buildAgentWorkspaceIdentityEnv("   ")).toEqual({});
    expect(buildAgentWorkspaceIdentityEnv(undefined)).toEqual({});
  });
});

/* 上面的用例证明"注入之后两侧一致"，但证明不了 node.ts 真的注入了。
   createNodeServices 是 1200+ 行、107 个 import 的容器，resolveSpawnEnv 又是其中的内联闭包，
   为它搭 mock 不划算；这里退而对接线做源码断言，至少能挡住"整行被删/被接错解析器"。 */
describe("node.ts wires the authoritative origin into resolveSpawnEnv", () => {
  const source = readFileSync(resolve(process.cwd(), "packages/services/src/node.ts"), "utf8");
  // 以实际闭包和下一项配置为边界，避免错误起点静默产生空片段。
  const spawnEnvStart = source.indexOf("resolveSpawnEnv: async (");
  const spawnEnvBlock = source.slice(
    spawnEnvStart,
    source.indexOf("    ...(!isDesktopAttachedRemote", spawnEnvStart),
  );

  it("feeds it the settings-aware resolver, not the env-only one", () => {
    // 承重项：必须用 resolveCurrentZCodeEndpointOrigin（含 settings 覆盖）。
    // 接成 resolveRuntimeZCodeEndpointOrigin(process.env) 会让这次修复完全失效，
    // 而两侧仍然"看起来"都在解析 origin。
    expect(spawnEnvStart).toBeGreaterThanOrEqual(0);
    expect(spawnEnvBlock).toContain(
      "buildAgentEndpointOriginEnv(await resolveCurrentZCodeEndpointOrigin())",
    );
  });
});
