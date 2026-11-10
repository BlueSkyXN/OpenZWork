import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import baseConfig, { engineeringTestFiles, forkIsolatedTests } from "./vitest.config";
import policy from "./tests/ci/core-tests.json";

// 完整历史套件继续使用原配置；核心入口只改变发现范围，复用别名、setup 和进程隔离规则。
const files = policy.suites.flatMap((suite) => suite.files);
if (files.length === 0 || new Set(files).size !== files.length) {
  throw new Error("Core test policy must contain unique test files");
}
await Promise.all(files.map((file) => access(resolve(process.cwd(), file))));
const selected = new Set(files);
const projects = baseConfig.test?.projects;
if (!projects) throw new Error("Base test projects are required");

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    projects: projects.map((project) => {
      if (typeof project !== "object" || !project.test) {
        throw new Error("Core scope expects inline base test projects");
      }
      // OpenZWork(OW-P023) 修复：project 对同一 selected 集分区认领（engineering→fork→其余 project 依次扣除），
      // 避免 unit/engineering 都收全量造成同文件双 project 双计（core-scope 守护测试断言唯一性）。
      // dev-docs project 只认领自己的清单文件；其余 project 的兜底分支排除 dev-docs 路径。
      const engineering = new Set(engineeringTestFiles);
      const forkSet = new Set(forkIsolatedTests);
      const projectName = project.test.name;
      const include =
        projectName === "fork-isolated"
          ? files.filter((file) => forkSet.has(file))
          : projectName === "engineering"
            ? files.filter((file) => engineering.has(file) && !forkSet.has(file))
            : projectName === "dev-docs"
              ? files.filter((file) => file.startsWith("apps/dev-docs/"))
              : files.filter(
                  (file) =>
                    !engineering.has(file) &&
                    !forkSet.has(file) &&
                    !file.startsWith("apps/dev-docs/"),
                );
      return { ...project, test: { ...project.test, include } };
    }),
  },
});
