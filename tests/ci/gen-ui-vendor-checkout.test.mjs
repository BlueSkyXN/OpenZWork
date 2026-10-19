import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const vendor = new URL(
  "../../apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/vendor/",
  import.meta.url,
);

test("Windows Git checkout preserves pinned GenUI resource and license hashes", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", vendor), "utf8"));
  const files = new Map();
  for (const resource of manifest.resources) {
    files.set(resource.file, resource.sha256);
    files.set(resource.licenseFile, resource.licenseSha256);
  }
  for (const [file, expected] of files) {
    const path = relative(root, fileURLToPath(new URL(file, vendor)))
      .split(sep)
      .join("/");
    // 真实执行 Git 的工作树过滤，覆盖 autocrlf=true；不以修改哈希或关闭校验补救。
    const { stdout } = await execute(
      "git",
      ["-c", "core.autocrlf=true", "cat-file", "--filters", `HEAD:${path}`],
      {
        cwd: root,
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    assert.equal(createHash("sha256").update(stdout).digest("hex"), expected, file);
  }
});
