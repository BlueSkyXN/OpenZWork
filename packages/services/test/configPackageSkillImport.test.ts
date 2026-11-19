import { chmod, mkdir, readFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as directoryContent from "../src/data-sync/directoryContent.js";
import * as discovery from "../src/skill-sync/skillSyncService.js";
import { ownerAt, put, sandbox } from "./configPackageFixture.js";

const skillDir = (user: string, dir: string) => join(user, ".openzwork", "skills", dir);
const markdown = (id: string, value: string) =>
  "---\nname: " + id + "\ndescription: fixture\n---\n" + value;
const putSkill = (user: string, dir: string, id: string, value: string) =>
  put(join(skillDir(user, dir), "SKILL.md"), markdown(id, value));

describe("配置包技能提交", () => {
  it("CP-03 中途单项读错时保留已提交文件的启用状态与回执，继续独立项", async () => {
    const root = await sandbox(),
      a = join(root, "source"),
      b = join(root, "target"),
      file = join(root, "transfer.gz");
    for (const id of ["alpha", "bravo", "charlie"]) await putSkill(a, id, id, "incoming");
    await putSkill(b, "bravo", "bravo", "old");
    await put(
      join(a, ".openzwork", "cli/config.json"),
      JSON.stringify({
        skills: {
          [join(skillDir(a, "alpha"), "SKILL.md").replaceAll("\\", "/")]: { enable: false },
        },
      }),
    );
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const target = ownerAt(b),
      preview = await target.service.previewFile(file);
    const hash = directoryContent.hashDirectoryContent;
    vi.spyOn(directoryContent, "hashDirectoryContent").mockImplementation(async (path, options) => {
      if (path === skillDir(b, "bravo")) throw new Error("fixture read failed");
      return hash(path, options);
    });
    const result = await target.service.applyPreview(preview.previewId, preview.rows);
    expect(result.items.map((i) => [i.key, i.status])).toEqual([
      ["alpha", "created"],
      ["bravo", "failed"],
      ["charlie", "created"],
    ]);
    const actual = await target.options.owners.skills.listSyncItems();
    expect(actual.items.find((i) => i.key === "alpha")?.enabled).toBe(false);
    expect(await readFile(join(skillDir(b, "bravo"), "SKILL.md"), "utf8")).toBe(
      markdown("bravo", "old"),
    );
  });

  it("CP-03 已更新子树的启用状态写入失败时恢复原父目录", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    await putSkill(a, "p", "parent", "new");
    await putSkill(a, "p/c", "child", "new");
    await putSkill(b, "p", "parent", "old");
    const cfg = (user: string) => join(user, ".openzwork/cli/config.json");
    await put(
      cfg(a),
      JSON.stringify({
        skills: { [join(skillDir(a, "p/c"), "SKILL.md").replaceAll("\\", "/")]: { enable: false } },
      }),
    );
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    await put(cfg(b), "{broken fixture");
    const result = await target.applyPreview(pre.previewId, pre.rows);
    expect(result.items.every((i) => i.status === "failed")).toBe(true);
    expect(await readFile(join(skillDir(b, "p"), "SKILL.md"), "utf8")).toBe(
      markdown("parent", "old"),
    );
    await expect(stat(skillDir(b, "p/c"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(cfg(b), "utf8")).toBe("{broken fixture");
  });

  it("CP-03 同址子技能仍可独立更新，父目录保留", async () => {
    // OW-P037：父项的整目录保护不能拦截有独立覆盖授权的同址子项。
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    for (const [user, body] of [
      [a, "new"],
      [b, "old"],
    ] as const) {
      await putSkill(user, "p", "parent", body);
      await putSkill(user, "p/c", "child", body);
    }
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    const result = await target.applyPreview(pre.previewId, pre.rows);
    expect(result.items.map((i) => [i.key, i.status])).toEqual([
      ["parent", "failed"],
      ["child", "updated"],
    ]);
    expect(await readFile(join(skillDir(b, "p"), "SKILL.md"), "utf8")).toBe(
      markdown("parent", "old"),
    );
    expect(await readFile(join(skillDir(b, "p/c"), "SKILL.md"), "utf8")).toBe(
      markdown("child", "new"),
    );
  });

  it("CP-01 独立技能共用一份目标目录索引", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    for (let i = 0; i < 16; i++) await putSkill(a, "leaf" + i, "leaf" + i, "new");
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const target = ownerAt(b).service,
      pre = await target.previewFile(file);
    const scan = vi.spyOn(discovery, "collectUserSkillCandidates");
    const result = await target.applyPreview(pre.previewId, pre.rows);
    expect(result.items.filter((i) => i.status === "created")).toHaveLength(16);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("CP-01 跨根独立技能往返后按各自目录比较", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      b = join(root, "b"),
      file = join(root, "skills.gz");
    await putSkill(a, "toolkit", "toolkit", "native");
    await put(join(a, ".agents/skills/toolkit/child/SKILL.md"), markdown("child", "compat"));
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const target = ownerAt(b).service,
      preview = await target.previewFile(file);
    expect(
      (await target.applyPreview(preview.previewId, preview.rows)).items.map((i) => i.status),
    ).toEqual(["created", "created"]);
    expect(await readFile(join(skillDir(b, "agents/toolkit/child"), "SKILL.md"), "utf8")).toBe(
      markdown("child", "compat"),
    );
    expect((await target.previewFile(file)).rows.every((row) => row.status === "same")).toBe(true);
  });

  it("CP-03 两个预览同时新建同一个技能时只提交一次", async () => {
    const root = await sandbox(),
      a = join(root, "source"),
      b = join(root, "target"),
      file = join(root, "package.gz");
    await putSkill(a, "first", "shared", "incoming");
    await ownerAt(a).service.exportToFile(file, ["skills"]);
    const left = ownerAt(b).service,
      right = ownerAt(b).service;
    const [one, two] = await Promise.all([left.previewFile(file), right.previewFile(file)]);
    const receipts = await Promise.all([
      left.applyPreview(one.previewId, one.rows),
      right.applyPreview(two.previewId, two.rows),
    ]);
    expect(receipts.map((r) => r.items[0]?.status).sort()).toEqual(["conflict", "created"]);
    expect(await readFile(join(skillDir(b, "first"), "SKILL.md"), "utf8")).toBe(
      markdown("shared", "incoming"),
    );
  });

  it.skipIf(process.platform === "win32")("CP-13 导出期间只改变执行位也会中止", async () => {
    const root = await sandbox(),
      a = join(root, "a"),
      file = join(root, "backup.gz");
    await putSkill(a, "runner", "runner", "ordinary");
    const helper = join(skillDir(a, "runner"), "helper");
    await put(helper, "helper");
    await chmod(helper, 0o644);
    await put(file, "previous export");
    const source = ownerAt(a),
      owner = source.options.owners.skills;
    const original = owner.exportSyncItems.bind(owner);
    vi.spyOn(owner, "exportSyncItems").mockImplementation(async (params) => {
      const payload = await original(params);
      await chmod(helper, 0o755);
      return payload;
    });
    await expect(source.service.exportToFile(file, ["skills"])).rejects.toThrow("source-changed");
    expect(await readFile(file, "utf8")).toBe("previous export");
  });

  it.skipIf(process.platform === "win32")(
    "CP-01/03 旧 v1 技能包能修复执行位且保护新改动",
    async () => {
      // OW-P043：v1 清单仍用原内容哈希，目标比较同时考虑归档内已有的执行位。
      const root = await sandbox(),
        a = join(root, "a"),
        b = join(root, "b"),
        file = join(root, "skills.gz");
      const helper = (user: string) => join(skillDir(user, "runner"), "run");
      for (const user of [a, b]) {
        await putSkill(user, "runner", "runner", "same");
        await put(helper(user), "helper");
      }
      await chmod(helper(a), 0o755);
      await chmod(helper(b), 0o644);
      await ownerAt(a).service.exportToFile(file, ["skills"]);
      const target = ownerAt(b).service,
        first = await target.previewFile(file);
      expect(first.rows[0]?.status).toBe("different");
      await chmod(helper(b), 0o744);
      expect((await target.applyPreview(first.previewId, first.rows)).items[0]?.status).toBe(
        "conflict",
      );
      const second = await target.previewFile(file);
      expect((await target.applyPreview(second.previewId, second.rows)).items[0]?.status).toBe(
        "updated",
      );
      expect((await stat(helper(b))).mode & 0o111).toBe(0o111);
      expect((await target.previewFile(file)).rows[0]?.status).toBe("same");
    },
  );

  it.each(["commands", "skills"] as const)(
    "CP-03 %s 写入者拒绝已有的目录别名",
    async (category) => {
      // OW-P042：夹具的两个目录都位于测试根内，用同根目录别名验证物理父目录检查。
      const root = await sandbox(),
        a = join(root, "a"),
        b = join(root, "b"),
        file = join(root, "config.gz");
      if (category === "commands")
        await put(join(a, ".openzwork/commands/group/sample.md"), "sample");
      else await putSkill(a, "group/sample", "sample", "sample");
      await ownerAt(a).service.exportToFile(file, [category]);
      const dir = join(b, ".openzwork", category),
        real = join(dir, "existing");
      await mkdir(real, { recursive: true });
      await symlink(real, join(dir, "group"), process.platform === "win32" ? "junction" : "dir");
      const target = ownerAt(b).service,
        pre = await target.previewFile(file);
      const receipt = await target.applyPreview(pre.previewId, pre.rows);
      expect(receipt.items[0]?.status).toBe("failed");
      await expect(
        stat(join(real, category === "commands" ? "sample.md" : "sample")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
