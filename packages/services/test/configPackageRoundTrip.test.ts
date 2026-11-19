import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ownerAt, privateValues, put, sandbox, seed } from "./configPackageFixture.js";
import { CONFIG_PACKAGE_CATEGORIES, type ConfigCategory } from "@zcode/shared";

const categories: ConfigCategory[] = [...CONFIG_PACKAGE_CATEGORIES];
describe("两个隔离的用户目录", () => {
  it("CP-01 在 3.18.2 继续读写 v1 用户子智能体文件，保留目标内置模型覆盖", async () => {
    const dir = await sandbox(),
      a = join(dir, "a"),
      b = join(dir, "b"),
      file = join(dir, "package.gz");
    const state = (home: string) => join(home, ".openzwork/v2/agents-state.json");
    const settings = (modelId: string) => ({
      builtInModelSelectionOverrides: { Explore: { providerId: "personal:fixture", modelId } },
    });
    const from = await seed(a);
    await put(state(a), JSON.stringify(settings("source-model")));
    expect(
      (await from.options.owners.subagents.listSyncItems()).items.some(
        (i) => !!i.builtInModelOverride,
      ),
    ).toBe(true);
    const exported = await from.service.exportToFile(file, ["subagents"]);
    expect(exported.counts.subagents).toBe(1);
    await put(state(b), JSON.stringify(settings("local-model")));
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    expect(pre.rows.map((r) => r.key)).toEqual(["reader"]);
    expect((await target.applyPreview(pre.previewId, pre.rows)).items[0]?.status).toBe("created");
    expect(JSON.parse(await readFile(state(b), "utf8"))).toMatchObject(settings("local-model"));
  });
  it("CP-07 普通 stdio MCP 仅迁移完整的 home 路径字段，HTTP、凭据和命令原样保留", async () => {
    const root = await sandbox(),
      a = join(root, "source"),
      b = join(root, "source", "nested-target");
    const configPath = (home: string) => join(home, ".openzwork", "cli", "config.json");
    const common = {
      command: a + "/bin/tool",
      args: [a, a + "/with spaces", a + "-other/item", "--flag=" + a + "/x", "/opt/app"],
      cwd: a + "/cwd",
      env: { DATA: a + "/data", NOTE: "use " + a + "/x" },
      environment: { CACHE: a + "/cache" },
      headers: { Authorization: a + "/header" },
      enabled: false,
    };
    const http = {
      type: "http",
      url: "https://example.invalid/mcp",
      env: { DATA: a + "/data" },
      headers: { Authorization: a + "/header" },
    };
    await put(
      configPath(a),
      JSON.stringify({ mcp: { servers: { custom: common, filesystem: common, web: http } } }),
    );
    const file = join(root, "move.gz");
    await ownerAt(a).service.exportToFile(file, ["mcp"]);
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    expect(pre.differentPlatform).toBe(false);
    expect((await target.applyPreview(pre.previewId, pre.rows)).items.map((i) => i.status)).toEqual(
      ["created", "created", "created"],
    );
    const { servers } = JSON.parse(await readFile(configPath(b), "utf8")).mcp;
    // 迁入目标 home 的路径按目标机分隔符比较，其余字段逐字核对来源值。
    for (const name of ["custom", "filesystem"])
      expect(servers[name]).toMatchObject({
        ...common,
        args: [b, join(b, "with spaces"), a + "-other/item", "--flag=" + a + "/x", "/opt/app"],
        cwd: join(b, "cwd"),
        env: { DATA: join(b, "data"), NOTE: "use " + a + "/x" },
        environment: { CACHE: join(b, "cache") },
      });
    expect(servers.web).toMatchObject(http);
  });
  it("CP-01/04/07/08 源字节、启用状态、home 与目标独有项", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "move.gz");
    const source = await seed(a);
    await source.service.exportToFile(file, categories);
    await put(join(b, ".openzwork/commands/only.md"), "keep");
    const target = ownerAt(b, "win32");
    const preview = await target.service.previewFile(file);
    expect(preview.rows).toHaveLength(7);
    expect(preview.rows.every((row) => row.status === "new")).toBe(true);
    expect(preview.rows.filter((row) => row.absolutePath).map((row) => row.category)).toEqual([
      "hooks",
      "mcp",
    ]);
    for (const value of Object.values(privateValues))
      expect(JSON.stringify(preview)).not.toContain(value);
    const spy = vi.spyOn(target.options.owners.commands, "importSyncItems");
    const [first, second] = await Promise.all([
      target.service.applyPreview(preview.previewId, preview.rows),
      target.service.applyPreview(preview.previewId, preview.rows),
    ]);
    expect(first).toEqual(second);
    expect(first.items.map((r) => r.status)).toEqual(Array(7).fill("created"));
    expect(await target.service.applyPreview(preview.previewId, preview.rows)).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    for (const name of ["commands/Git/sample.md", "agents/Reader.md", "skills/sample/SKILL.md"])
      expect(await readFile(join(b, ".openzwork", name))).toEqual(
        await readFile(join(a, ".openzwork", name)),
      );
    expect(await readFile(join(b, ".openzwork/commands/only.md"), "utf8")).toBe("keep");
    const local = JSON.parse(await readFile(join(b, ".openzwork/cli/config.json"), "utf8"));
    expect(local.mcp.servers.filesystem).toMatchObject({
      args: [join(b, "folder"), "/opt/fixed"],
      env: { EXAMPLE: privateValues.env },
      headers: { Example: privateValues.header },
      enabled: false,
    });
    expect(local.hooks.events.Stop[0].hooks[0].command).toBe(privateValues.command);
    expect((await target.options.settings.get()).systemPromptSettings?.replacement).toBe(
      privateValues.prompt,
    );
    expect(target.runtime.registryService.getModel("personal:fixture", "sample")).toBeDefined();
    expect((await target.repo.read()).defaultModelSelection?.providerId).toBe("personal:fixture");
    const again = await target.service.previewFile(file);
    expect(
      again.rows.filter((r) => r.status !== "same").map((r) => [r.category, r.status]),
    ).toEqual([["mcp", "different"]]);
  });
  it("CP-02/03 差异按选择覆盖，预览后竞争的新增和覆盖均保留本机新值", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "move.gz"),
      source = await seed(a);
    await source.service.exportToFile(file, ["subagents", "commands", "skills"]);
    const agent = join(b, ".openzwork/agents/Reader.md"),
      command = join(b, ".openzwork/commands/Git/sample.md");
    const body = "---\nname: Reader\ndescription: local\n---\nlocal";
    await put(agent, body);
    const target = ownerAt(b).service;
    const canceled = await target.previewFile(file);
    expect(canceled.rows.find((r) => r.category === "subagents")?.status).toBe("different");
    await target.releasePreview(canceled.previewId);
    await expect(target.applyPreview(canceled.previewId, canceled.rows)).rejects.toThrow("expired");
    expect(await readFile(agent, "utf8")).toBe(body);
    const conflict = await target.previewFile(file);
    await expect(
      target.applyPreview(conflict.previewId, [{ category: "skills", key: "unknown" }]),
    ).rejects.toThrow("selection");
    await put(agent, body + "new");
    await put(command, "race");
    const mixed = await target.applyPreview(conflict.previewId, conflict.rows);
    expect(mixed.items.map((r) => r.status)).toEqual(["conflict", "conflict", "created"]);
    expect(await readFile(agent, "utf8")).toBe(body + "new");
    expect(await readFile(command, "utf8")).toBe("race");
    const next = await target.previewFile(file);
    await expect(
      target.applyPreview(
        next.previewId,
        next.rows.filter((r) => r.status === "same"),
      ),
    ).rejects.toThrow("selection");
    await writeFile(file, "replaced after preview");
    const applied = await target.applyPreview(
      next.previewId,
      next.rows.filter((r) => r.category === "subagents"),
    );
    expect(applied.items[0]?.status).toBe("updated");
    expect(await readFile(agent, "utf8")).toContain(privateValues.body);
    expect(await readFile(command, "utf8")).toBe("race");
  });
  it("分类写入失败后继续其余选择，回执省略底层错误中的内容", async () => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      file = join(root, "move.gz");
    await source.service.exportToFile(file, ["subagents", "commands", "skills"]);
    const target = ownerAt(join(root, "b"));
    const preview = await target.service.previewFile(file);
    vi.spyOn(target.options.owners.commands, "importSyncItems").mockRejectedValue(
      new Error(privateValues.key),
    );
    const result = await target.service.applyPreview(preview.previewId, preview.rows);
    expect(result.items.map((r) => r.status)).toEqual(["created", "failed", "created"]);
    expect(JSON.stringify(result)).not.toContain(privateValues.key);
  });
});
