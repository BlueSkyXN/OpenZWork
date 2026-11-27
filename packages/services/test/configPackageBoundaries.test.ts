import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { ChannelServer, ChannelClient, Emitter, type VSBuffer } from "@zcode/rpc";
import { ServiceCollection } from "../src/collection.js";
import { IConfigPackageService } from "../src/config-package/index.js";
import { CONFIG_PACKAGE_CATEGORIES } from "@zcode/shared";
import { exposeWindowHostAttachmentServices } from "../../desktop/src/host/windowHostAttachmentRpcPolicy.js";
import { extractSkillSyncArchive } from "../src/data-sync/node.js";
import { writePrivatePackage } from "../src/config-package/privateFile.js";
import { ownerAt, put, seed, sandbox, privateValues } from "./configPackageFixture.js";
import { attachConfigPackage, readPackage } from "../src/config-package/node.js";

describe("配置包边界", () => {
  it("CP-13 命令来源目录无法枚举时保留已有导出", async () => {
    const root = await sandbox(),
      home = join(root, "source"),
      file = join(root, "backup.gz");
    await put(join(home, ".openzwork/commands/readable.md"), "fixture command");
    await put(join(home, ".agents/commands"), "not a directory");
    await put(file, "previous export");
    await expect(ownerAt(home).service.exportToFile(file, ["commands"])).rejects.toThrow(
      "commands-read",
    );
    expect(await readFile(file, "utf8")).toBe("previous export");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "CP-13 已发现的命令不可读时中止导出",
    async () => {
      const root = await sandbox(),
        home = join(root, "source"),
        denied = join(home, ".openzwork/commands/second.md");
      await put(join(home, ".openzwork/commands/first.md"), "one");
      await put(denied, "two");
      try {
        await chmod(denied, 0);
        await expect(
          ownerAt(home).service.exportToFile(join(root, "commands.gz"), ["commands"]),
        ).rejects.toThrow("commands-read");
      } finally {
        await chmod(denied, 0o600);
      }
    },
  );

  // OW-P041：跨根的相对路径重叠不构成物理父子关系。
  it("CP-01 两个来源根的独立技能可同时成包，兼容前缀避开已有目录", async () => {
    const root = await sandbox(),
      home = join(root, "source"),
      file = join(root, "skills.gz");
    const skill = (path: string, name: string) =>
      put(join(home, path, "SKILL.md"), "---\nname: " + name + "\ndescription: fixture\n---\n");
    await skill(".openzwork/skills/toolkit", "toolkit");
    await skill(".openzwork/skills/agents", "reserved");
    await skill(".agents/skills/toolkit/child", "child");
    await skill(".agents/skills/toolkit/child/deep", "deep");
    await ownerAt(home).service.exportToFile(file, ["skills"]);
    const { items } = (await readPackage(file)).categories.skills!.payload;
    expect(Object.fromEntries(items.map((i) => [i.key, i.directoryName]))).toEqual({
      toolkit: "toolkit",
      reserved: "agents",
      child: "agents-2/toolkit/child",
      deep: "agents-2/toolkit/child/deep",
    });
  });

  it.skipIf(process.platform === "win32")("CP-01 技能归档保留普通文件的执行位", async () => {
    // OW-P043：tar 已携带执行位，解包后的辅助程序须按相同方式调用。
    const root = await sandbox(),
      home = join(root, "source"),
      file = join(root, "skills.gz");
    const skill = join(home, ".openzwork/skills/check"),
      extracted = join(root, "extracted");
    await put(join(skill, "SKILL.md"), "fixture");
    await put(join(skill, "helper"), "fixture helper");
    await chmod(join(skill, "helper"), 0o751);
    await ownerAt(home).service.exportToFile(file, ["skills"]);
    const archive = (await readPackage(file)).categories.skills!.payload.archive;
    await extractSkillSyncArchive(Buffer.from(archive, "base64"), extracted);
    expect((await stat(join(extracted, "check/helper"))).mode & 0o111).toBe(0o111);
    expect((await stat(join(extracted, "check/SKILL.md"))).mode & 0o111).toBe(0);
  });

  it("CP-01 子智能体按原字节导出且保留旧版状态文件", async () => {
    const dir = await sandbox(),
      home = join(dir, "source"),
      path = join(dir, "agents.gz");
    const agent = join(home, ".openzwork/agents/Reader.md");
    const state = join(home, ".openzwork/v2/agents-state.json");
    const original =
      "---\nname: Reader\ndescription: fixture\nmodel: builtin:zai/sample\n---\nbody\n";
    const legacy = JSON.stringify({
      builtInModelOverrides: { Explore: "builtin:zai/sample" },
    });
    await put(agent, original);
    await put(state, legacy);
    await ownerAt(home).service.exportToFile(path, ["subagents"]);
    const group = (await readPackage(path)).categories.subagents!;
    expect(group.entries.map((row) => row.key)).toEqual(["reader"]);
    expect(Buffer.from(group.payload.items[0]!.content, "base64").toString()).toBe(original);
    expect(await readFile(agent, "utf8")).toBe(original);
    expect(await readFile(state, "utf8")).toBe(legacy);
  });

  it("CP-06 父目录内有未登记的同名安装时拒绝成包并保留旧文件", async () => {
    const dir = await sandbox(),
      home = join(dir, "source"),
      path = join(dir, "skills.gz");
    for (const [location, name] of [
      ["a-common", "common"],
      ["b-parent", "parent"],
      ["b-parent/child", "common"],
    ] as const) {
      await put(
        join(home, ".openzwork/skills", location, "SKILL.md"),
        "---\nname: " + name + "\ndescription: fixture\n---\n" + location,
      );
    }
    await put(path, "previous");
    await expect(ownerAt(home).service.exportToFile(path, ["skills"])).rejects.toThrow(
      "config-package.skill-paths",
    );
    expect(await readFile(path, "utf8")).toBe("previous");
  });

  it.each(["new", "previous", "concurrent"] as const)(
    "CP-01 Windows 最终 ACL 失败撤回本次明文：%s",
    async (scenario) => {
      const dir = await sandbox(),
        path = join(dir, "transfer.gz"),
        contents = Buffer.from("fixture-export-bytes");
      if (scenario !== "new") await writeFile(path, "original file");
      const previous = scenario !== "new" ? await stat(path, { bigint: true }) : undefined;
      let publishedBytes: Buffer | undefined;
      const acl = async (file: string, create: boolean) => {
        if (create) {
          await (await open(file, "wx", 0o600)).close();
          return;
        }
        publishedBytes = await readFile(file);
        if (scenario === "concurrent") {
          await rename(file, join(dir, "moved"));
          await writeFile(file, "newer writer");
        }
        throw new Error("fixture final ACL failure");
      };
      await expect(writePrivatePackage(path, contents, acl)).rejects.toThrow(
        "config-package.private-file",
      );
      expect(publishedBytes).toEqual(contents);
      if (scenario === "new") expect(await readdir(dir)).toEqual([]);
      if (scenario === "previous") {
        expect(await readdir(dir)).toEqual(["transfer.gz"]);
        expect((await stat(path, { bigint: true })).ino).toBe(previous!.ino);
        expect(await readFile(path, "utf8")).toBe("original file");
      }
      if (scenario === "concurrent") {
        expect((await readdir(dir)).sort()).toEqual(["moved", "transfer.gz"]);
        expect(await readFile(path, "utf8")).toBe("newer writer");
        expect((await stat(join(dir, "moved"))).size).toBe(0);
      }
    },
  );
  it("CP-01/09 七类导出为私有文件，导出、预览和导入的回执与日志省去载荷", async () => {
    const dir = await sandbox(),
      source = await seed(join(dir, "a")),
      path = join(dir, "example.gz");
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => {
        logs.push(JSON.stringify(args));
      });
    const report = await source.service.exportToFile(path, [...CONFIG_PACKAGE_CATEGORIES]);
    expect(Object.values(report.counts)).toEqual(Array(7).fill(1));
    expect(report.bytes).toBe((await stat(path)).size);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    const json = gunzipSync(await readFile(path)).toString();
    for (const value of [
      privateValues.key,
      privateValues.env,
      privateValues.header,
      privateValues.command,
      privateValues.prompt,
    ])
      expect(json).toContain(value);
    const target = ownerAt(join(dir, "b"));
    const preview = await target.service.previewFile(path);
    const applied = await target.service.applyPreview(preview.previewId, preview.rows);
    expect(applied.items.map((row) => row.status)).toEqual(Array(7).fill("created"));
    for (const value of [
      ...Object.values(privateValues),
      Buffer.from(privateValues.body).toString("base64"),
    ])
      expect(JSON.stringify([logs, report, preview, applied])).not.toContain(value);
  });
  it("CP-11 手机 attachment 的配置包调用经真实 RPC 拒绝", async () => {
    const mobile = new Emitter<VSBuffer>(),
      host = new Emitter<VSBuffer>();
    const client = new ChannelClient({
      onMessage: mobile.event,
      send: (msg) => host.fire(msg),
    });
    const server = new ChannelServer(
      { onMessage: host.event, send: (msg) => mobile.fire(msg) },
      "mobile",
      10,
    );
    try {
      const service = {
        exportToFile: vi.fn(),
        previewFile: vi.fn(),
        applyPreview: vi.fn(),
        releasePreview: vi.fn(),
      };
      exposeWindowHostAttachmentServices({
        server,
        services: new ServiceCollection().register(IConfigPackageService, service),
        clientMode: "web-remote-replayable",
      });
      await expect(
        client
          .getChannel(IConfigPackageService.channelName)
          .call("exportToFile", ["unused", ["commands"]]),
      ).rejects.toThrow();
      expect(service.exportToFile).not.toHaveBeenCalled();
    } finally {
      client.dispose();
      server.dispose();
      mobile.dispose();
      host.dispose();
    }
  });
  it("关闭桌面连接后清除已返回与在途的预览", async () => {
    const dir = await sandbox(),
      source = await seed(join(dir, "a")),
      path = join(dir, "transfer.gz");
    await source.service.exportToFile(path, ["providers"]);
    const target = ownerAt(join(dir, "b")),
      connection = attachConfigPackage(target.service);
    const ready = await connection.service.previewFile(path);
    const read = target.options.source.read.bind(target.options.source);
    const started = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    vi.spyOn(target.options.source, "read").mockImplementationOnce(async (id) => {
      started.resolve();
      await resume.promise;
      return read(id);
    });
    const release = vi.spyOn(target.service, "releasePreview");
    const pending = connection.service.previewFile(path);
    await started.promise;
    connection.dispose();
    resume.resolve();
    await expect(pending).rejects.toThrow("expired");
    const released = release.mock.calls.map(([id]) => id);
    expect(released).toContain(ready.previewId);
    expect(new Set(released).size).toBe(2);
    for (const id of released)
      await expect(target.service.applyPreview(id, ready.rows)).rejects.toThrow("expired");
    expect((await target.repo.read()).providers.keys()).toEqual([]);
  });
});

it("OW-P042：子智能体预检发现别名目录时禁止写入", async () => {
  const root = await sandbox();
  const home = join(root, "target");
  const other = join(root, "separate");
  await mkdir(join(home, ".openzwork"), { recursive: true });
  await mkdir(other);
  await symlink(
    other,
    join(home, ".openzwork", "agents"),
    process.platform === "win32" ? "junction" : "dir",
  );
  ownerAt(home);
  const { createSubagentDataSyncMethods } = await import("../src/data-sync/subagentDataSync.js");
  expect((await createSubagentDataSyncMethods().checkSyncWriteAccess()).ok).toBe(false);
  expect(await readdir(other)).toEqual([]);
});
