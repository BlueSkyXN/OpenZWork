import { describe, expect, it } from "vitest";
import {
  ZCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY,
  ZCODE_REMOTE_HTTP_PROXY_ENV_KEY,
  ZCODE_REMOTE_NO_PROXY_ENV_KEY,
  ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  buildZCodeToolEnvPassthroughEnv,
  readZCodeToolEnvPassthroughEnv,
  sanitizeZCodeRuntimeEnv,
} from "../src/runtimeEnv.js";

describe("runtimeEnv", () => {
  it("sanitizes runtime env while sealing user network env for tools", () => {
    const sourceEnv = {
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_ENV: "development",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      PATH: "/usr/bin:/bin",
      npm_config_proxy: "http://npm-proxy.example:8080",
    };

    const sanitized = sanitizeZCodeRuntimeEnv(sourceEnv);
    const passthroughEnv = buildZCodeToolEnvPassthroughEnv(sourceEnv);
    const captured = readZCodeToolEnvPassthroughEnv(passthroughEnv);

    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });
    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      npm_config_proxy: "http://npm-proxy.example:8080",
    });
  });

  it("ignores invalid passthrough JSON and non-network keys", () => {
    const captured = readZCodeToolEnvPassthroughEnv({
      [ZCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY]: JSON.stringify({
        HTTP_PROXY: "http://proxy.example:8080",
        NODE_ENV: "production",
        PATH: "/tmp/bin",
      }),
    });

    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
    });
    expect(
      readZCodeToolEnvPassthroughEnv({
        [ZCODE_TOOL_ENV_PASSTHROUGH_ENV_KEY]: "not-json",
      }),
    ).toEqual({});
  });

  it("strips desktop-to-remote network handoff values after stdio bootstrap", () => {
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      [ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]: "1",
      [ZCODE_REMOTE_HTTP_PROXY_ENV_KEY]: "http://172.21.240.1:7890",
      [ZCODE_REMOTE_NO_PROXY_ENV_KEY]: "localhost,127.0.0.1",
    };

    expect(sanitizeZCodeRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(readZCodeToolEnvPassthroughEnv(buildZCodeToolEnvPassthroughEnv(sourceEnv))).toEqual({});
  });
});
