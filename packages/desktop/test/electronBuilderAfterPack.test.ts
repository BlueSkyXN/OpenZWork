import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { afterEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.fn();

// 此回归只检查最终包的 native 边界与 afterSign 签名校验装配；依赖注入的闭包收集有独立工程测试。
// asar 读写、真实 afterPack 与资源策略均保持实际实现。
vi.mock("../scripts/runtime-dependency-closure.mjs", () => ({
  collectRuntimeModuleClosureEntries: () => [],
}));
vi.mock("../../../scripts/spawn-command.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../scripts/spawn-command.mjs")>();
  return {
    ...actual,
    runCommand: (...args: Parameters<typeof actual.runCommand>) => runCommandMock(...args),
  };
});

const temporaryRoots: string[] = [];

afterEach(async () => {
  runCommandMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.each([
  { os: "darwin", arch: "arm64", builderArch: 3 },
  { os: "win32", arch: "x64", builderArch: 1 },
  { os: "win32", arch: "arm64", builderArch: 3 },
  { os: "linux", arch: "x64", builderArch: 1 },
])("electron-builder afterPack ($os-$arch)", ({ os, arch, builderArch }) => {
  it.each(["valid", "wrong-platform", "packed"] as const)(
    "执行最终包 native 检查：%s",
    async (scenario) => {
      vi.stubEnv("ZCODE_TARGET_OS", os);
      vi.stubEnv("ZCODE_TARGET_ARCH", arch);
      vi.stubEnv("ZCODE_ENV", "test");
      const { default: config } = await import("../electron-builder.config.js");
      const root = await mkdtemp(resolve(tmpdir(), "openzwork-after-pack-"));
      temporaryRoots.push(root);
      const sourceDir = resolve(root, "source");
      const appOutDir = resolve(root, "app");
      const resourcesDir =
        os === "darwin"
          ? resolve(appOutDir, "Fixture.app", "Contents", "Resources")
          : resolve(appOutDir, "resources");
      const targetKey = `${os}-${arch}`;
      const prebuild = resolve(sourceDir, "node_modules/node-pty/prebuilds", targetKey, "pty.node");
      await mkdir(dirname(prebuild), { recursive: true });
      await mkdir(resourcesDir, { recursive: true });
      await writeFile(prebuild, "fixture-native-file");
      // 上游 v3.18.1 / v4.0.0：win32 afterPack 会校验 installer process helper 与 preinstalled entry shim。
      // valid 场景需在夹具中放置这两个二进制；缺失即拒 pack（真实构建由对应脚本产出）。
      if (os === "win32") {
        const helper = resolve(
          resourcesDir,
          "tools/runtime-host/zcode-installer-process-helper.exe",
        );
        const preinstalledShim = resolve(
          resourcesDir,
          "preinstalled-entry-shim/zcode-preinstalled-entry-shim.exe",
        );
        await mkdir(dirname(helper), { recursive: true });
        await mkdir(dirname(preinstalledShim), { recursive: true });
        await writeFile(helper, "fixture-installer-helper");
        await writeFile(preinstalledShim, "fixture-preinstalled-entry-shim");
      }

      if (scenario === "wrong-platform") {
        const foreignKey = os === "win32" ? "darwin-arm64" : "win32-x64";
        const foreign = resolve(
          sourceDir,
          "node_modules/node-pty/prebuilds",
          foreignKey,
          "pty.node",
        );
        await mkdir(dirname(foreign), { recursive: true });
        await writeFile(foreign, "fixture-foreign-native-file");
      }

      await createPackageWithOptions(
        sourceDir,
        resolve(resourcesDir, "app.asar"),
        scenario === "packed" ? {} : { unpack: "*.node" },
      );

      // 3.17.1 整合曾只删掉策略函数的 import，工具函数测试仍绿；必须调用真正的 hook 才能发现遗漏。
      const buildResourcesDir = resolve(root, "build");
      const result = config.afterPack({
        appOutDir,
        electronPlatformName: os,
        arch: builderArch,
        packager: { appInfo: { productFilename: "Fixture" }, buildResourcesDir },
      });
      if (scenario === "valid") {
        await expect(result).resolves.toBeUndefined();
        if (os === "win32") {
          // NSIS 按架构名 include；实际 runner 传入的是 electron-builder 的数字枚举。
          const define = resolve(
            buildResourcesDir,
            "generated",
            `zcode-process-helper-${arch}.nsh`,
          );
          const helper = resolve(
            resourcesDir,
            "tools/runtime-host/zcode-installer-process-helper.exe",
          );
          expect(await readFile(define, "utf8")).toContain(
            `ZCODE_INSTALLER_PROCESS_HELPER "${helper}"`,
          );
        }
      } else {
        await expect(result).rejects.toThrow(
          scenario === "wrong-platform"
            ? "node-pty 包含非目标平台 prebuild"
            : "native 文件仍作为 packed payload 留在 app.asar",
        );
      }
    },
  );
});

describe("electron-builder afterSign (win32)", () => {
  it("开启 ZCODE_ENABLE_WINDOWS_SIGN=1 时校验原生 helper 签名且不调用已裁剪的更新发布器", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      vi.stubEnv("ZCODE_TARGET_OS", "win32");
      vi.stubEnv("ZCODE_TARGET_ARCH", "x64");
      vi.stubEnv("ZCODE_ENV", "test");
      vi.stubEnv("ZCODE_ENABLE_WINDOWS_SIGN", "1");
      runCommandMock.mockImplementation(() => undefined);

      const { default: config } = await import("../electron-builder.config.js");
      const appOutDir = await mkdtemp(resolve(tmpdir(), "openzwork-after-sign-"));
      temporaryRoots.push(appOutDir);

      await expect(
        config.afterSign({
          appOutDir,
          electronPlatformName: "win32",
          arch: 1,
          packager: { appInfo: { productFilename: "Fixture" } },
        }),
      ).resolves.toBeUndefined();

      expect(runCommandMock).toHaveBeenCalledTimes(3);
      for (const [command, args] of runCommandMock.mock.calls) {
        expect(command).toBe("powershell.exe");
        expect(args).toEqual([
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          expect.any(String),
        ]);
      }
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });
});
