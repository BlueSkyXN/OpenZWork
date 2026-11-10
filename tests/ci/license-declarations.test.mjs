// OZ-C010：守住已有声明和上游许可原文，防止同步或打包维护时误替换、遗漏。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

const root = new URL("../../", import.meta.url);
const text = async (path) => (await readFile(new URL(path, root), "utf8")).replace(/\r\n/g, "\n");

test("发行声明保留当前 GPL-3.0 全文、上游 Apache 原文和声明入口", async () => {
  const [license, apache, notice, ledger] = await Promise.all([
    text("LICENSE"),
    text("LICENSE.Apache-2.0.txt"),
    text("NOTICE.md"),
    text("docs/openzwork/ledger.yaml"),
  ]);
  const { stdout } = await promisify(execFile)(
    "git",
    ["show", `${parse(ledger).upstream.commit}:LICENSE`],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(apache, stdout.replace(/\r\n/g, "\n"), "上游许可变化时先复核保留原文与分支声明");
  assert.equal(
    createHash("sha256").update(license).digest("hex"),
    "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
    "根 LICENSE 应保持已声明的 GPL-3.0 全文",
  );
  for (const path of ["LICENSE", "LICENSE.Apache-2.0.txt", "THIRD-PARTY-NOTICES.md"])
    assert.ok(notice.includes(`](${path})`), `NOTICE 缺少声明入口：${path}`);
});
