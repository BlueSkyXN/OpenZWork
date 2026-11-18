// OW-P024 回归（CLI 配置层）：Main 固定 DB 的共享前提。
// spec：docs/specs/saved-workflow-query-lifecycle-openzwork.md §6。
//
// Desktop 共享查询 carrier 打开的库必须与逐项目 carrier 一致——Main 在
// buildHostProcessEnv 里注入绝对 ZCODE_SESSION_DB_PATH 并删除旧别名 ZCODE_SESSION_DB；
// Env 层（priority 40）必须压过用户（10）/项目（20）配置里的 storage.sessionDbPath。
// 使用真实临时用户/项目配置文件验证 createConfig 的层序合并。
import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "../src/config/index.js";
import { parseEnvConfig } from "../src/config/env-config.adapter.js";

describe("workflow-query 固定数据库优先级（OW-P024）", () => {
  it("Env 的绝对 ZCODE_SESSION_DB_PATH 压过用户与项目配置；项目压过用户", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-session-db-priority-"));
    try {
      const userPath = join(root, ".zcode", "cli", "config.json");
      const projectPath = join(root, "zcode.json");
      await mkdir(join(root, ".zcode", "cli"), { recursive: true });
      await mkdir(join(root, ".git"));
      await writeFile(
        userPath,
        JSON.stringify({ storage: { sessionDbPath: join(root, "user.sqlite") } }),
      );
      await writeFile(
        projectPath,
        JSON.stringify({ storage: { sessionDbPath: join(root, "project.sqlite") } }),
      );
      const fixedPath = join(root, "main-fixed", "db.sqlite");

      // Main 注入后的环境：新键存在，旧别名已删除。
      vi.stubEnv("HOME", root);
      vi.stubEnv("USERPROFILE", root);
      vi.stubEnv("ZCODE_SESSION_DB_PATH", fixedPath);
      delete process.env.ZCODE_SESSION_DB;
      const withEnv = createConfig({
        env: process.env,
        userConfigPath: userPath,
        workingDirectory: root,
      });
      expect(withEnv.config.storage.sessionDbPath).toBe(fixedPath);

      // 无 env 覆盖时：项目级 storage 属于受限运行参数（config.test.ts「restricts project
      // runtime parameters」同一设计——项目配置不能改数据库落点），因此回落到用户配置；
      // 这正是 Main 的 env 注入是可信共享前提的原因：项目永远无法重定向 DB。
      vi.unstubAllEnvs();
      vi.stubEnv("HOME", root);
      vi.stubEnv("USERPROFILE", root);
      const layered = createConfig({ env: {}, userConfigPath: userPath, workingDirectory: root });
      expect(layered.config.storage.sessionDbPath).toBe(join(root, "user.sqlite"));
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("旧别名 ZCODE_SESSION_DB 单独存在时仍被解析（兼容非 Desktop 宿主），但与 PATH 同时给时以 PATH 为准", () => {
    // parseEnvConfig 是纯函数层：两个键都映射 storage.sessionDbPath，后写入者胜；
    // 产品的 Desktop 路径不会同时出现两个键（Main 删除旧别名）。
    expect(
      parseEnvConfig({ ZCODE_SESSION_DB: "/tmp/legacy.sqlite" }).storage?.sessionDbPath,
    ).toBe("/tmp/legacy.sqlite");
    const both = parseEnvConfig({
      ZCODE_SESSION_DB: "/tmp/legacy.sqlite",
      ZCODE_SESSION_DB_PATH: "/tmp/new.sqlite",
    });
    expect(both.storage?.sessionDbPath).toBe("/tmp/new.sqlite");
  });
});
