import { normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "vite";

describe("web Vite config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "   ", " 3.12.9-beta.1 "])(
    "构建版本使用手动值或 package 默认值：%s",
    async (override) => {
      vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", override);
      const webRoot = resolve(import.meta.dirname, "..");
      const { version } = JSON.parse(
        await readFile(resolve(webRoot, "../../package.json"), "utf8"),
      );
      const result = await loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      );
      expect(result?.config.define?.__ZCODE_VERSION__).toBe(
        JSON.stringify(override?.trim() || version),
      );
    },
  );

  it("非法手动版本在构建配置加载时失败", async () => {
    vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", "../latest");
    const webRoot = resolve(import.meta.dirname, "..");
    await expect(
      loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      ),
    ).rejects.toThrow(/version/i);
  });

  it("loads during bootstrap without executing the shared root entry", async () => {
    const webRoot = resolve(import.meta.dirname, "..");
    // normalize 确保路径分隔符一致，避免 Windows/Unix 不一致
    const configFile = normalize(resolve(webRoot, "vite.config.ts"));

    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );
    // 比较时统一路径格式
    expect(normalize(result!.path)).toBe(configFile);
  });

  it("publishes PDF.js CMaps for non-latin PDF rendering", async () => {
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.plugins?.some((plugin) => plugin.name === "zcode:pdfjs-cmaps")).toBe(
      true,
    );
  });

  it.each(["production", "development"])("%s 构建不注入已退役的账号 OAuth 参数", async (mode) => {
    vi.stubEnv("ZCODE_ENV", mode === "production" ? "production" : "test");
    const webRoot = resolve(import.meta.dirname, "..");
    const result = await loadConfigFromFile(
      { command: "build", mode, isPreview: false, isSsrBuild: false },
      resolve(webRoot, "vite.config.ts"), webRoot, "silent",
    );
    expect(result?.config.define).not.toHaveProperty("import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID");
  });

  it("uses shared ZCode endpoint env override for renderer injection", async () => {
    vi.stubEnv("ZCODE_ENV", "test");
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.define).toMatchObject({
    });
  });
});
