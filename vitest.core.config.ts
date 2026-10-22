import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";
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
      const forkIsolated = project.test.name === "fork-isolated";
      return {
        ...project,
        test: {
          ...project.test,
          include: forkIsolated
            ? (project.test.include ?? []).filter((file) => selected.has(file))
            : files,
        },
      };
    }),
  },
});
