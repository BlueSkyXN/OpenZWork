import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createConfig } from "../src/config/index.js";
import { loadProjectConfigs } from "../src/config/project-config.adapter.js";

const roots: string[] = [];
const originalHome = process.env.HOME;
async function temp() {
  const path = await mkdtemp(join(tmpdir(), "openzwork-project-config-"));
  roots.push(path);
  return path;
}
async function config(root: string, path: string, servers: Record<string, unknown>) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ mcp: { servers } }));
  return file;
}
afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("OpenZWork project compatibility", () => {
  it("loads legacy fork MCP with the project cwd and keeps it disabled", async () => {
    const root = await temp();
    const path = await config(root, ".openzwork/config.json", {
      fixture: {
        type: "stdio",
        command: "node",
        cwd: "tools",
        enabled: false,
      },
    });
    const result = createConfig({ env: {}, skipUserConfig: true, workingDirectory: root });
    expect(result.sources.project.paths).toEqual([path]);
    expect(result.config.mcp.servers.fixture).toMatchObject({
      command: "node",
      cwd: join(root, "tools"),
      enabled: false,
    });
  });

  // OW-P016：不同层保留不同名 server；同名 server 只能采用高优先级的一整份定义。
  it("preserves upstream project files and replaces same-name server definitions as a whole", async () => {
    const root = await temp();
    const base = await config(root, ".zcode/config.json", {
      same: { type: "stdio", command: "base", args: ["base-only"], env: { BASE: "only" } },
      retained: { type: "stdio", command: "retained" },
    });
    const before = await readFile(base, "utf8");
    const own = await config(root, ".openzwork/config.json", {
      same: { type: "stdio", command: "fork", enabled: false },
    });
    const result = createConfig({ env: {}, skipUserConfig: true, workingDirectory: root });
    expect(result.sources.project.paths).toEqual([base, own]);
    expect(result.config.mcp.servers.same).toMatchObject({ command: "fork", enabled: false });
    expect(result.config.mcp.servers.same.env).toBeUndefined();
    expect(result.config.mcp.servers.same.args).toBeUndefined();
    expect(result.config.mcp.servers.retained.command).toBe("retained");
    expect(await readFile(base, "utf8")).toBe(before);
  });

  it("keeps nearest project scope above an ancestor fork config", async () => {
    const root = await temp();
    const cwd = join(root, "app");
    await mkdir(join(root, ".git"));
    await config(root, ".openzwork/config.json", { same: { type: "stdio", command: "ancestor" } });
    await config(cwd, ".zcode/config.json", { same: { type: "stdio", command: "nearest" } });
    const result = createConfig({ env: {}, skipUserConfig: true, workingDirectory: cwd });
    expect(result.config.mcp.servers.same.command).toBe("nearest");
  });

  it("does not discover the official user directory through HOME or a HOME symlink", async () => {
    const home = await temp();
    process.env.HOME = home;
    await mkdir(join(home, ".git"));
    const source = await config(home, ".zcode/config.json", {
      userOnly: { type: "stdio", command: "must-not-load" },
    });
    expect(loadProjectConfigs(home).paths).toEqual([]);
    const alias = join(await temp(), "alias");
    await symlink(home, alias, process.platform === "win32" ? "junction" : "dir");
    expect(loadProjectConfigs(alias).paths).toEqual([]);
    // 用户明确指定的文件继续遵守已有显式参数合同。
    expect(loadProjectConfigs(home, source).paths).toEqual([source]);
  });
  it("loads a project config once when the legacy directory is a link to its existing source", async () => {
    const root = await temp();
    const base = await config(root, ".zcode/config.json", {
      fixture: { type: "stdio", command: "node" },
    });
    await symlink(
      join(root, ".zcode"),
      join(root, ".openzwork"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(loadProjectConfigs(root).paths).toEqual([base]);
  });
});
