import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFICIAL_DESIGN_REQUIRED_SEED_PATHS } from "../../../apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.js";
import {
  REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
} from "../src/remote/zcodeAgentOfficialPluginAssets.js";

// design 的规则文件与脚本是会话里按需读取/执行的，远端缺一份只会在用到时失败；远端部署前的必需路径
// 因此要覆盖本地 seed 的全部必需路径。server 运行时不依赖 bootstrap，这里机械对照两份清单。
describe("remote official plugin required paths", () => {
  it("design 覆盖本地 seed 的全部必需路径（references 与磁盘一致、7 个运行时脚本、hook）", () => {
    const remote = new Set<string>(REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS);
    const missing = OFFICIAL_DESIGN_REQUIRED_SEED_PATHS.map((path) => `design-plugin/${path}`).filter(
      (path) => !remote.has(path),
    );
    expect(missing).toEqual([]);
    const seeds: readonly string[] = OFFICIAL_DESIGN_REQUIRED_SEED_PATHS;
    // 规则文件按需读取，少登记一份只会在用到时才报错：seed 清单必须等于随包 references 目录。
    const referencesDir = fileURLToPath(
      new URL("../../../apps/zcode-cli/packages/design-plugin/skills/design/references/", import.meta.url),
    );
    expect(seeds.filter((path) => path.startsWith("skills/design/references/")).sort()).toEqual(
      readdirSync(referencesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => `skills/design/references/${name}`)
        .sort(),
    );
    // build-catalog.mjs / frontmatter.mjs 只在开发时生成目录，不随包；其余脚本会话里会执行。
    expect(seeds.filter((path) => path.startsWith("skills/design/scripts/"))).toHaveLength(7);
  });

  // OpenZWork(OZ-D005, OZ-D006, OZ-D009): 远端官方插件清单不得残留已删除插件或幽灵文件路径。
  it("所有远端官方插件包与必需相对路径均对应 apps/zcode-cli/packages 中的真实源码或可构建产物", () => {
    const cliPackagesDir = fileURLToPath(
      new URL("../../../apps/zcode-cli/packages/", import.meta.url),
    );
    const deletedPlugins = ["zcode-cua-plugin", "zcode-site-plugin", "image-search-plugin"];
    for (const deleted of deletedPlugins) {
      expect(REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES).not.toContain(deleted);
      expect(
        REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.filter((entry) =>
          entry.startsWith(`${deleted}/`),
        ),
      ).toEqual([]);
    }

    const allowedPackages = new Set<string>([
      "bundled-skills",
      ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES,
    ]);
    for (const packageName of REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES) {
      expect(existsSync(join(cliPackagesDir, packageName, "package.json"))).toBe(true);
      expect(existsSync(join(cliPackagesDir, packageName, ".zcode-plugin", "plugin.json"))).toBe(
        true,
      );
    }

    const officeViewerDistPattern =
      /^(documents|pdf|presentations|spreadsheets)-plugin\/dist\/(server\.mjs|ui\/assets\.json|ui\/panel\.html)$/;
    const officeBuilderExists = existsSync(
      join(cliPackagesDir, "office-runtime", "scripts", "build.mjs"),
    );
    expect(officeBuilderExists).toBe(true);

    const missingPaths = REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.filter(
      (relativePath) => {
        const [packageName] = relativePath.split("/");
        if (!packageName || !allowedPackages.has(packageName)) return true;
        if (officeViewerDistPattern.test(relativePath)) {
          return !existsSync(join(cliPackagesDir, packageName, "package.json"));
        }
        return !existsSync(join(cliPackagesDir, ...relativePath.split("/")));
      },
    );
    expect(missingPaths).toEqual([]);
  });
});
