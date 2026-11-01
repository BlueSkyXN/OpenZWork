import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { afterEach, describe, expect, it, vi } from "vitest";

// 此回归只检查最终包的 native 边界；依赖注入的闭包收集有独立工程测试。
// asar 读写、真实 afterPack 与资源策略均保持实际实现。
vi.mock("../scripts/runtime-dependency-closure.mjs", () => ({
  collectRuntimeModuleClosureEntries: () => [],
}));

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.each([
  { os: "darwin", arch: "arm64", builderArch: 3 },
  { os: "win32", arch: "x64", builderArch: 1 },
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
      const result = config.afterPack({
        appOutDir,
        electronPlatformName: os,
        arch: builderArch,
        packager: { appInfo: { productFilename: "Fixture" } },
      });
      if (scenario === "valid") {
        await expect(result).resolves.toBeUndefined();
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
