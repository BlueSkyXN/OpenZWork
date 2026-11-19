import { readFile, stat, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import * as atomicFiles from "../src/fs/atomicFileUtils.js";
import { collectCategory } from "../src/config-package/categories.js";
import { createCommandsService } from "../src/commands/commandsService.js";
import { createSubagentsService } from "../src/subagents/subagentsService.js";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@zcode/provider-node";
import { extractManualModelConfig, serializeRegistryModelConfig } from "@zcode/provider";
import { createDefaultSystemPromptSettings, CONFIG_PACKAGE_LIMITS } from "@zcode/shared";
import {
  sandbox,
  seed,
  put,
  ownerAt,
  providerData,
  privateValues,
} from "./configPackageFixture.js";

describe("配置包文件与并发", () => {
  it("CP-06 旧 v1 包遗漏同名嵌套技能的路径时拒绝预览", async () => {
    const root = await sandbox(),
      a = join(root, "source"),
      b = join(root, "target");
    for (const [dir, name] of [
      ["a-common", "common"],
      ["parent", "parent"],
      ["parent/nested", "common"],
    ] as const) {
      await put(
        join(a, ".openzwork/skills", dir, "SKILL.md"),
        "---\nname: " + name + "\ndescription: fixture\n---\n" + dir,
      );
    }
    const source = ownerAt(a);
    // 前版 v1 用按名称去重的清单，父目录仍以完整归档保存。
    const { entries, payload } = await collectCategory(source.options.owners.skills, "skills");
    const file = join(root, "legacy.gz");
    await writeFile(
      file,
      gzipSync(
        JSON.stringify({
          formatVersion: 1,
          appVersion: "3.18.2",
          sourcePlatform: "darwin",
          sourceHomeDir: a,
          exportedAt: new Date().toISOString(),
          categories: {
            skills: {
              entries,
              payload: { ...payload, archive: Buffer.from(payload.archive).toString("base64") },
            },
          },
        }),
      ),
    );
    await expect(ownerAt(b).service.previewFile(file)).rejects.toThrow(
      "config-package.skill-paths",
    );
    await expect(stat(join(b, ".openzwork/skills"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["commands", "subagents"] as const)(
    "OW-P036 %s 批中一项拿锁失败后保留成功回执并继续",
    async (category) => {
      const root = await sandbox(),
        a = join(root, "a"),
        b = join(root, "b"),
        file = join(root, "move.gz");
      const path = (home: string, name: string) =>
        join(home, ".openzwork", category === "commands" ? "commands" : "agents", name + ".md");
      const body = (name: string, value: string) =>
        "---\nname: " + name + "\ndescription: example\n---\n" + value;
      const names = ["first", "second", "third"];
      for (const name of names) {
        await put(path(a, name), body(name, "incoming"));
        await put(path(b, name), body(name, "before"));
      }
      await ownerAt(a).service.exportToFile(file, [category]);
      const svc = ownerAt(b).service,
        preview = await svc.previewFile(file);
      const lock = atomicFiles.withUserMarkdownLock;
      const calls = vi
        .spyOn(atomicFiles, "withUserMarkdownLock")
        .mockImplementationOnce(lock)
        .mockRejectedValueOnce(new Error("lock unavailable"));
      const receipt = await svc.applyPreview(preview.previewId, preview.rows);
      expect(receipt.items.map((i) => i.status)).toEqual(["updated", "failed", "updated"]);
      expect(await svc.applyPreview(preview.previewId, preview.rows)).toEqual(receipt);
      expect(calls).toHaveBeenCalledTimes(3);
      for (const name of names) {
        expect(await readFile(path(b, name), "utf8")).toBe(
          body(name, name === "second" ? "before" : "incoming"),
        );
      }
    },
  );

  it("OW-P037 覆盖父项时保护本机目录内按名称去重前的另一份安装", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    const path = (home: string, dir: string) => join(home, ".openzwork/skills", dir, "SKILL.md");
    const md = (name: string, value: string) =>
      "---\nname: " + name + "\ndescription: example\n---\n" + value;
    await put(path(a, "b-parent"), md("parent", "incoming"));
    await put(path(a, "independent"), md("independent", "incoming"));
    await put(path(b, "a-common"), md("common", "outside"));
    await put(path(b, "b-parent"), md("parent", "before"));
    await put(path(b, "b-parent/owned"), md("common", "only here"));
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const svc = ownerAt(b).service,
      preview = await svc.previewFile(file);
    const receipt = await svc.applyPreview(preview.previewId, preview.rows);
    expect(receipt.items.find((i) => i.key === "parent")).toMatchObject({
      status: "failed",
      reason: "nested-target",
    });
    expect(receipt.items.find((i) => i.key === "independent")?.status).toBe("created");
    expect(await readFile(path(b, "b-parent/owned"), "utf8")).toBe(md("common", "only here"));
    expect(await readFile(path(b, "a-common"), "utf8")).toBe(md("common", "outside"));
    expect(await readFile(path(b, "b-parent"), "utf8")).toBe(md("parent", "before"));
  });
  // OW-P036：在真实分类已经写入第一项后保存第二项，确保批内后续写入重新核对目标。
  it.each(["commands", "subagents"] as const)("CP-03 %s 批内后项保留新编辑", async (category) => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b");
    const dir = category === "commands" ? "commands" : "agents";
    const path = (home: string, name: string) => join(home, ".openzwork", dir, name + ".md");
    const content = (name: string, value: string) =>
      "---\nname: " + name + "\ndescription: fixture\n---\n" + value;
    for (const name of ["first", "second"]) {
      await put(path(a, name), content(name, "incoming"));
      await put(path(b, name), content(name, "before"));
    }
    const file = join(root, "roundtrip.gz");
    await ownerAt(a).service.exportToFile(file, [category]);
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    const write = atomicFiles.writeFileAtomically;
    const edit = content("second", "fresh edit");
    vi.spyOn(atomicFiles, "writeFileAtomically").mockImplementation(async (dest, bytes, mode) => {
      await write(dest, bytes, mode);
      if (dest === path(b, "first")) await writeFile(path(b, "second"), edit);
    });
    const result = await target.applyPreview(pre.previewId, pre.rows);
    expect(result.items.map((row) => row.status)).toEqual(["updated", "conflict"]);
    expect(await readFile(path(b, "first"), "utf8")).toBe(content("first", "incoming"));
    expect(await readFile(path(b, "second"), "utf8")).toBe(edit);
  });

  // OW-P037：父目录物理包含子项，遇到异位同名项时整棵选中子树必须先拒绝落盘。
  it("CP-03 嵌套技能同名子项在另一目录，保留原目录并继续独立项", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    const skill = (home: string, dir: string) =>
      join(home, ".openzwork", "skills", dir, "SKILL.md");
    const md = (name: string, body: string) =>
      "---\nname: " + name + "\ndescription: fixture\n---\n" + body;
    await put(skill(a, "parent"), md("parent", "source"));
    await put(skill(a, "parent/child"), md("child", "source"));
    await put(skill(a, "other"), md("other", "independent"));
    await put(skill(b, "elsewhere"), md("child", "target"));
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const svc = ownerAt(b).service,
      pre = await svc.previewFile(file);
    const result = await svc.applyPreview(pre.previewId, pre.rows);
    expect(result.items.find((i) => i.key === "other")?.status).toBe("created");
    expect(
      result.items
        .filter((i) => i.key !== "other")
        .every((i) => ["failed", "conflict"].includes(i.status)),
    ).toBe(true);
    await expect(stat(join(b, ".openzwork/skills/parent"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(skill(b, "elsewhere"), "utf8")).toBe(md("child", "target"));
    expect(await readFile(skill(b, "other"), "utf8")).toBe(md("other", "independent"));
  });

  it.each(["commands", "subagents"] as const)(
    "OW-P036 %s 设置保存与导入的检查替换串行",
    async (category) => {
      const root = await sandbox(),
        a = join(root, "a"),
        b = join(root, "b"),
        file = join(root, "file.gz");
      const filename = (home: string) =>
        join(home, ".openzwork", category === "commands" ? "commands" : "agents", "sample.md");
      const markdown = (value: string) => "---\nname: sample\ndescription: fixture\n---\n" + value;
      await put(filename(a), markdown("incoming"));
      await put(filename(b), markdown("before"));
      await ownerAt(a).service.exportToFile(file, [category]);
      const target = ownerAt(b).service,
        preview = await target.previewFile(file);
      const write = atomicFiles.writeFileAtomically;
      const agents = createSubagentsService({ homeDir: b });
      let saving: Promise<unknown> | undefined;
      const saves: string[] = [];
      vi.spyOn(atomicFiles, "writeFileAtomically").mockImplementation(async (path, bytes, mode) => {
        saving = (
          category === "commands"
            ? createCommandsService().updateCommandFile({
                commandId: "sample",
                oldFilePath: path,
                config: { name: "sample", prompt: "user edit" },
              })
            : agents.updateAgent({
                agentId: "sample",
                provider: "glm",
                oldFilePath: path,
                config: { name: "sample", description: "fixture", systemPrompt: "user edit" },
              })
        ).then(() => saves.push("editor"));
        await write(path, bytes, mode);
        saves.push("import");
      });
      try {
        expect((await target.applyPreview(preview.previewId, preview.rows)).items[0]?.status).toBe(
          "updated",
        );
        await saving;
        expect(saves).toEqual(["import", "editor"]);
        expect(await readFile(filename(b), "utf8")).toContain("user edit");
      } finally {
        agents.disposeAll();
      }
    },
  );

  it.each(["deleted-child", "all-new", "unselected"] as const)(
    "OW-P037 嵌套技能 %s",
    async (scenario) => {
      const root = await sandbox(),
        a = join(root, "a"),
        b = join(root, "b"),
        file = join(root, "skills.gz");
      const path = (home: string, dir: string) =>
        join(home, ".openzwork", "skills", dir, "SKILL.md");
      const md = (name: string, body: string) =>
        "---\nname: " + name + "\ndescription: fixture\n---\n" + body;
      await put(path(a, "p"), md("p", "p"));
      await put(path(a, "p/c"), md("c", "c"));
      if (scenario === "deleted-child") await put(path(b, "elsewhere"), md("c", "before"));
      await ownerAt(a).service.exportToFile(file, ["skills"]);
      const svc = ownerAt(b).service,
        preview = await svc.previewFile(file);
      if (scenario === "deleted-child") await unlink(path(b, "elsewhere"));
      const chosen = preview.rows.filter((row) => scenario !== "unselected" || row.key === "p");
      const result = await svc.applyPreview(preview.previewId, chosen);
      if (scenario === "all-new") {
        expect(result.items.map((r) => r.status)).toEqual(["created", "created"]);
        expect(await readFile(path(b, "p/c"), "utf8")).toBe(md("c", "c"));
      } else {
        expect(result.items.find((r) => r.key === "p")?.status).toBe("failed");
        if (scenario === "deleted-child")
          expect(result.items.find((r) => r.key === "c")?.status).toBe("conflict");
        await expect(stat(join(b, ".openzwork/skills/p"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    },
  );
  it("CP-06 整包校验拒绝坏文件、未来版本、清单错配和两种大小超限", async () => {
    const root = await sandbox(),
      host = await seed(join(root, "a")),
      file = join(root, "file.gz");
    await host.service.exportToFile(file, ["commands"]);
    const bytes = await readFile(file),
      doc = JSON.parse(gunzipSync(bytes).toString());
    const targetHome = join(root, "b");
    const target = ownerAt(targetHome).service;
    await writeFile(file, bytes.subarray(0, 10));
    await expect(target.previewFile(file)).rejects.toThrow("unreadable");
    for (const mutate of [
      (v: typeof doc) => {
        v.formatVersion = 2;
      },
      (v: typeof doc) => {
        v.categories.other = {};
      },
      (v: typeof doc) => {
        v.categories.commands.entries.push(v.categories.commands.entries[0]);
      },
      (v: typeof doc) => {
        v.categories.commands.payload.items[0].content = "abcd!";
      },
      (v: typeof doc) => {
        v.categories.commands.payload.items[0].key = "other";
      },
      (v: typeof doc) => {
        v.categories.commands.payload.items[0].content = "YWJj";
      },
    ]) {
      const value = structuredClone(doc);
      mutate(value);
      await writeFile(file, gzipSync(JSON.stringify(value)));
      await expect(target.previewFile(file)).rejects.toThrow(
        value.formatVersion === 2 ? "future-version" : "invalid",
      );
    }
    await truncate(file, CONFIG_PACKAGE_LIMITS.compressed + 1);
    await expect(target.previewFile(file)).rejects.toThrow("size");
    await writeFile(file, gzipSync(Buffer.alloc(CONFIG_PACKAGE_LIMITS.json + 1, 32), { level: 1 }));
    await expect(target.previewFile(file)).rejects.toThrow("size");
    await expect(stat(join(targetHome, ".openzwork"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "a/.openzwork/commands/Git/sample.md"), "utf8")).toBe(
      "fixture-markdown-body",
    );
  });
  it.each(["change", "delete"] as const)("CP-13 导出期间 %s 则保留原目标文件", async (action) => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      owner = source.options.owners.commands,
      path = join(root, "target.gz");
    await put(path, "original");
    const original = owner.exportSyncItems.bind(owner);
    vi.spyOn(owner, "exportSyncItems").mockImplementation(async (input) => {
      const payload = await original(input),
        item = join(root, "a/.openzwork/commands/Git/sample.md");
      if (action === "change") await writeFile(item, "changed");
      else await unlink(item);
      return payload;
    });
    await expect(source.service.exportToFile(path, ["commands"])).rejects.toThrow("source-changed");
    expect(await readFile(path, "utf8")).toBe("original");
  });
});

describe("个人配置的锁内比较与回滚", () => {
  const id = "personal:fixture";
  function replaceProviders(
    target: ReturnType<typeof ownerAt>,
    entries: ReturnType<typeof providerData>[],
    options: { defaultId?: string; manual?: unknown[]; ordinary?: unknown[] } = {},
  ) {
    return target.repo.update(() =>
      decodeProviderConfigFile({
        schemaVersion: 1,
        config: {
          providerConfigRules: { providerRules: entries },
          providerOrder: entries.map((rule) => rule.providerId),
          modelConfigRules: {
            providerModelRules: options.ordinary ?? [],
            manualProviderModelRules: options.manual ?? [],
          },
          ...(options.defaultId
            ? {
                defaultModelSelection: {
                  providerId: options.defaultId,
                  modelId: "sample",
                  options: { reasoningLevel: "disabled" },
                },
              }
            : {}),
        },
      }),
    );
  }
  it("CP-04/05 按 ID 成组合并普通和手动规则、顺序与默认模型", async () => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      file = join(root, "move.gz");
    await source.runtime.start();
    const manual = extractManualModelConfig(
      serializeRegistryModelConfig(source.runtime.registryService.getModel(id, "sample")!.config),
    );
    await replaceProviders(
      source,
      [
        providerData("new-b", "b"),
        providerData(id, "from-source"),
        providerData("skip", "skip"),
        providerData("new-a", "a"),
      ],
      {
        defaultId: "skip",
        manual: [{ providerId: id, modelId: "sample", config: manual }],
      },
    );
    await source.service.exportToFile(file, ["providers"]);
    const target = ownerAt(join(root, "b"));
    await replaceProviders(target, [providerData("target-only", "keep"), providerData(id, "old")], {
      defaultId: "target-only",
      ordinary: [{ providerId: id, modelId: "sample", config: { enabled: true } }],
    });
    const pre = await target.service.previewFile(file);
    expect(pre.rows.find((row) => row.key === id)?.status).toBe("different");
    const untouched = await target.service.applyPreview(pre.previewId, []);
    expect(untouched.items).toEqual([]);
    expect(JSON.stringify(encodeProviderConfigFile(await target.repo.read()))).toContain(
      '"apiKey":"old"',
    );
    const apply = await target.service.previewFile(file);
    const result = await target.service.applyPreview(
      apply.previewId,
      apply.rows.filter((row) => row.key !== "skip").reverse(),
    );
    expect(result.items.filter((r) => r.status === "created")).toHaveLength(2);
    const data = encodeProviderConfigFile(await target.repo.read()).config;
    expect(data.providerOrder).toEqual(["target-only", id, "new-b", "new-a"]);
    expect(data.modelConfigRules.providerModelRules).toHaveLength(0);
    expect(data.modelConfigRules.manualProviderModelRules.map((r) => r.providerId)).toEqual([id]);
    expect(data.defaultModelSelection?.providerId).toBe("target-only");
    expect(
      data.providerConfigRules.providerRules.find((r) => r.providerId === id)?.config.access,
    ).toMatchObject({ apiKey: "from-source" });
    const empty = ownerAt(join(root, "c")),
      partial = await empty.service.previewFile(file);
    const skipped = await empty.service.applyPreview(
      partial.previewId,
      partial.rows.filter((row) => row.key !== "skip"),
    );
    expect(skipped.defaultModelSkipped).toBe(true);
    expect((await empty.repo.read()).defaultModelSelection).toBeUndefined();
  });
  it("CP-03/05 锁内发现 Provider 与提示词并发变化，各自报告冲突", async () => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      file = join(root, "move.gz"),
      b = join(root, "b");
    await source.service.exportToFile(file, ["providers", "commands", "systemPrompt"]);
    const target = ownerAt(b),
      pre = await target.service.previewFile(file);
    const other = ownerAt(b);
    await replaceProviders(other, [providerData(id, "third-writer")]);
    await other.options.settings.update(
      {
        systemPromptSettings: {
          ...createDefaultSystemPromptSettings(),
          mode: "replace",
          replacement: "concurrent",
        },
      },
      { expectedSystemPromptSettings: null },
    );
    const result = await target.service.applyPreview(pre.previewId, pre.rows);
    expect(result.items.map((row) => row.status)).toEqual(["created", "conflict", "conflict"]);
    expect(
      encodeProviderConfigFile(await target.repo.read()).config.providerConfigRules.providerRules[0]
        ?.config.access,
    ).toMatchObject({ apiKey: "third-writer" });
    expect((await target.options.settings.get()).systemPromptSettings?.replacement).toBe(
      "concurrent",
    );
  });
  it.each([false, true])("CP-05 刷新失败，第三方在回滚前写入 %s", async (race) => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      file = join(root, "move.gz"),
      b = join(root, "b");
    await source.service.exportToFile(file, ["providers", "commands", "systemPrompt"]);
    const target = ownerAt(b),
      other = ownerAt(b);
    await replaceProviders(target, [providerData(id, "before")]);
    const pre = await target.service.previewFile(file);
    vi.spyOn(target.options.registry, "refresh").mockImplementationOnce(async () => {
      if (race) await replaceProviders(other, [providerData(id, "concurrent")]);
      throw new Error(privateValues.key);
    });
    const result = await target.service.applyPreview(pre.previewId, pre.rows);
    expect(result.items.map((row) => row.status)).toEqual(["created", "failed", "created"]);
    expect(result.items[1]?.reason).toBe(race ? "rollback-incomplete" : "refresh-rolled-back");
    expect(
      encodeProviderConfigFile(await target.repo.read()).config.providerConfigRules.providerRules[0]
        ?.config.access,
    ).toMatchObject({ apiKey: race ? "concurrent" : "before" });
    expect(JSON.stringify(result)).not.toContain(privateValues.key);
  });
  it("CP-05 仅当本机缺省且来源默认模型可解析，采用配置相同的供应商", async () => {
    const root = await sandbox(),
      source = await seed(join(root, "a")),
      file = join(root, "file.gz"),
      targetHome = join(root, "b");
    await source.service.exportToFile(file, ["providers"]);
    const target = ownerAt(targetHome);
    const first = await target.service.previewFile(file);
    await target.service.applyPreview(first.previewId, first.rows);
    expect((await target.repo.read()).defaultModelSelection?.providerId).toBe(id);
    await target.repo.update((current) => ({ ...current, defaultModelSelection: undefined }));
    const same = await target.service.previewFile(file);
    expect(same.rows[0]?.status).toBe("same");
    expect(same.defaultModelCandidate).toEqual({ providerId: id, modelId: "sample" });
    const adopted = await target.service.applyPreview(same.previewId, []);
    expect(adopted).toEqual({
      items: [],
      defaultModelApplied: { providerId: id, modelId: "sample" },
    });
    expect((await target.repo.read()).defaultModelSelection?.modelId).toBe("sample");
    const alreadySet = await target.service.previewFile(file);
    expect(alreadySet.defaultModelCandidate).toBeUndefined();
    await target.repo.update((current) => ({ ...current, defaultModelSelection: undefined }));
    const afterClear = await target.service.applyPreview(alreadySet.previewId, []);
    expect(afterClear.defaultModelApplied).toBeUndefined();
    expect((await target.repo.read()).defaultModelSelection).toBeUndefined();
    const rollback = await target.service.previewFile(file);
    vi.spyOn(target.runtime.registryService, "refresh").mockRejectedValueOnce(
      new Error("refresh failed"),
    );
    const failed = await target.service.applyPreview(rollback.previewId, []);
    expect(failed.defaultModelApplied).toBeUndefined();
    expect(failed.items).toContainEqual({
      category: "providers",
      key: id,
      status: "failed",
      reason: "refresh-rolled-back",
    });
    expect((await target.repo.read()).defaultModelSelection).toBeUndefined();

    const bad = ownerAt(join(root, "a"));
    await bad.repo.update((current) => ({
      ...current,
      defaultModelSelection: { providerId: id, modelId: "missing" },
    }));
    await bad.service.exportToFile(file, ["providers"]);
    const another = ownerAt(join(root, "c")),
      preview = await another.service.previewFile(file);
    const result = await another.service.applyPreview(preview.previewId, preview.rows);
    expect(result.defaultModelSkipped).toBe(true);
    expect((await another.repo.read()).defaultModelSelection).toBeUndefined();
  });
});
