import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  isRealComputerUseProducerInstalled,
  readComputerUseProducer,
} from "../scripts/computer-use-producer.mjs";
import { stageDevCuaPluginRuntime } from "../../../scripts/stage-dev-cua-plugin-runtime.mjs";
import { resolveDevDesktopWindowsCuaEnv } from "../../../scripts/dev-desktop-cua-env.mjs";

const roots: string[] = [];
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

function createWorkspace(cuaManifest: Record<string, unknown> | string | null) {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-producer-"));
  roots.push(root);
  const desktopRoot = join(root, "packages", "desktop");
  mkdirSync(desktopRoot, { recursive: true });
  if (cuaManifest) {
    const cuaDir = join(root, "node_modules", "@zcode", "zcode-cua");
    mkdirSync(cuaDir, { recursive: true });
    writeFileSync(
      join(cuaDir, "package.json"),
      typeof cuaManifest === "string" ? cuaManifest : JSON.stringify(cuaManifest),
    );
  }
  return desktopRoot;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("OpenZWork CUA 空占位边界", () => {
  it.each([
    ["真实 producer", { name: "@zcode/zcode-cua", version: "0.6.5" }],
    ["上游占位包", { name: "@zcode/zcode-cua", zcodeCuaPlaceholder: true }],
    ["未安装", null],
    ["损坏清单", "{broken-manifest"],
  ])("CUA-001：%s 均不读取或接入后端", (_label, manifest) => {
    const desktopRoot = createWorkspace(manifest as Record<string, unknown> | string | null);
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot })).toEqual({
      installed: false,
      placeholder: true,
    });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("CUA-002：真实 producer 与旧 dev 开关也不能触发插件暂存", () => {
    const desktopRoot = createWorkspace({
      name: "@zcode/zcode-cua",
      dependencies: { sharp: "^0.34.0" },
    });
    const before = readdirSync(desktopRoot, { recursive: true });
    expect(
      stageDevCuaPluginRuntime({
        env: { ZCODE_CUA_DEV_MODE: "1" },
        desktopPackageRoot: desktopRoot,
        pluginRoot: join(desktopRoot, "missing-plugin"),
      }),
    ).toEqual([]);
    expect(readdirSync(desktopRoot, { recursive: true })).toEqual(before);
  });

  it.each(["darwin", "win32", "linux"])(
    "CUA-002：%s 不派生 CUA 环境变量或改写调用方 env",
    (platform) => {
      for (const env of [
        {},
        { ZCODE_CUA_DEV_MODE: "1" },
        { ZCODE_CUA_DEV_MODE: "1", ZCODE_CUA_DEV_ROOT: "legacy-producer" },
      ]) {
        const before = { ...env };
        expect(resolveDevDesktopWindowsCuaEnv({ platform, repoRoot: "unused", env })).toEqual({});
        expect(env).toEqual(before);
      }
    },
  );

  it.each([
    "packages/desktop/scripts/build-macos-window-bounds.mjs",
    "packages/desktop/scripts/prepare-windows-cua-helper.mjs",
  ])("CUA-003：%s 保留空命令，不生成文件", (script) => {
    const desktopRoot = createWorkspace(null);
    const output = execFileSync(process.execPath, [resolve(repositoryRoot, script)], {
      cwd: desktopRoot,
      env: { ...process.env, PATH: "", ZCODE_CUA_DEV_ROOT: desktopRoot },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(output).toContain("OpenZWork");
    expect(readdirSync(desktopRoot)).toEqual([]);
  });

  it("CUA-004：开发和资源准备入口不依赖 CUA 或权限浮窗辅助程序", () => {
    for (const file of [
      "scripts/dev-desktop-env.mjs",
      "packages/desktop/scripts/prepare-runtime-assets.mjs",
      "packages/desktop/scripts/ensure-local-runtime-assets.mjs",
    ]) {
      const source = readFileSync(resolve(repositoryRoot, file), "utf8");
      expect(source, file).not.toMatch(
        /@zcode\/zcode-cua|ZCODE_CUA_|prepare:windows-cua-helper|prepare:macos-window-bounds|macos-window-bounds/,
      );
    }
  });

  it("CUA-005：打包不携带 CUA 资源或其专属签名例外", async () => {
    const { default: config } = await import("../electron-builder.config.js");
    expect(JSON.stringify(config.extraResources)).not.toMatch(/cua-helper|macos-window-bounds/);
    expect(JSON.stringify(config.mac.signIgnore)).not.toContain("cua-helper");
    expect(JSON.stringify(config.extraResources)).toContain("glm");
    expect(JSON.stringify(config.mac.signIgnore)).toContain("glm");
  });

  it("CUA-006：UI 无 CUA 产品入口或支持声明，Browser Use 仍保留", () => {
    for (const file of [
      "packages/ui/src/SettingsPage.tsx",
      "packages/ui/src/v4/composer/V4ComposerToolbar.tsx",
      "packages/ui/src/settings/PluginsSection.tsx",
    ]) {
      const source = readFileSync(resolve(repositoryRoot, file), "utf8");
      expect(source, file).not.toMatch(
        /import\b[^;]*(?:ComputerUse|CuaEntry|CuaPermission|CuaSettings)|<(?:V4ComposerCuaEntry|ComputerUseUnavailable|CuaPermission)/,
      );
    }
    for (const locale of ["en-US", "zh-CN"]) {
      const source = readFileSync(
        resolve(repositoryRoot, `packages/ui/src/i18n/locales/${locale}.ts`),
        "utf8",
      );
      const description = source.match(
        /"resourceManager\.storage\.categoryDescription\.runtimes":\s*"([^"]+)"/,
      )?.[1];
      expect(description).toBeTruthy();
      expect(description).not.toMatch(/Computer Use|CUA/i);
    }
    const definitions = readFileSync(
      resolve(
        repositoryRoot,
        "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
      ),
      "utf8",
    );
    expect(definitions).not.toMatch(/name:\s*["']computer-use["']/);
    expect(definitions).toContain('const OFFICIAL_BROWSER_USE_PLUGIN_NAME = "browser-use"');
    expect(existsSync(resolve(repositoryRoot, "packages/zcode-cua"))).toBe(false);
    expect(
      readFileSync(resolve(repositoryRoot, "packages/shared/src/browser-use/commands.ts"), "utf8"),
    ).toContain("cuaKeypress");
  });
});
