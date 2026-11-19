import { readFile, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { CONFIG_PACKAGE_LIMITS } from "@zcode/shared";
import { readPackage } from "../src/config-package/node.js";
import { sandbox, seed, put } from "./configPackageFixture.js";

describe("配置包文件与并发", () => {
  it("CP-06 整包校验拒绝坏文件、未来版本、清单错配和两种大小超限", async () => {
    const root = await sandbox(),
      host = await seed(join(root, "a")),
      file = join(root, "file.gz");
    await host.service.exportToFile(file, ["commands"]);
    const bytes = await readFile(file),
      doc = JSON.parse(gunzipSync(bytes).toString());
    await writeFile(file, bytes.subarray(0, 10));
    await expect(readPackage(file)).rejects.toThrow("unreadable");
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
      await expect(readPackage(file)).rejects.toThrow(
        value.formatVersion === 2 ? "future-version" : "invalid",
      );
    }
    await truncate(file, CONFIG_PACKAGE_LIMITS.compressed + 1);
    await expect(readPackage(file)).rejects.toThrow("size");
    await writeFile(file, gzipSync(Buffer.alloc(CONFIG_PACKAGE_LIMITS.json + 1, 32), { level: 1 }));
    await expect(readPackage(file)).rejects.toThrow("size");
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
