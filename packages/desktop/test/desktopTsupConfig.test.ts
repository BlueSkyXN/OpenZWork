import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("loads all desktop build targets with shared defines and no telemetry injection", async () => {
  vi.stubEnv("ZCODE_ENV", "test");
  const config = await import("../tsup.config.js");
  expect(Array.isArray(config.default)).toBe(true);
  if (!Array.isArray(config.default)) throw new Error("Expected desktop build targets");
  expect(config.default.map((target) => target.name)).toEqual([
    "main",
    "preload",
    "plugin-sandbox-alias",
    "host",
    "scheduler",
  ]);
  for (const target of config.default) {
    expect(target.define).toHaveProperty("__ZCODE_VERSION__");
    expect(target.define).not.toHaveProperty("__ZCODE_PACKAGED_AGENT_TELEMETRY_ENV__");
  }
});

it("keeps production minification and E2E coverage source maps separate", async () => {
  const { resolveDesktopTsupBundleSecurityOptions } = await import("../tsup.config.js");
  expect(resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "production" })).toEqual({
    keepNames: true,
    minify: true,
    sourcemap: false,
  });
  expect(
    resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "production", ZCODE_E2E_COVERAGE: "1" }),
  ).toEqual({
    keepNames: false,
    minify: false,
    sourcemap: true,
  });
});
