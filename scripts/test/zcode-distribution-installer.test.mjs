import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installScriptSource } from "../zcode-distribution/installer.mjs";

const run = promisify(execFile);
const options = { skip: process.platform === "win32" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openzwork-installer-"));
  const home = join(root, "home");
  const bin = join(home, ".local/bin");
  const runtime = join(home, ".openzwork/runtime");
  await mkdir(bin, { recursive: true });
  const script = join(root, "install.sh");
  const distribution = join(root, "distribution");
  await writeFile(script, installScriptSource(pathToFileURL(distribution).href));
  return {
    root,
    home,
    bin,
    runtime,
    script,
    distribution,
    env: {
      ...process.env,
      HOME: home,
      ZCODE_DIST_HOME: runtime,
      ZCODE_DIST_BIN_DIR: bin,
      ZCODE_DIST_BASE_URL: pathToFileURL(distribution).href,
    },
  };
}

test("installer preserves unknown files and symlinks before downloading", options, async () => {
  const f = await fixture();
  try {
    const entry = join(f.bin, "zcode");
    await writeFile(entry, "upstream sentinel");
    await assert.rejects(run("/bin/sh", [f.script], { env: f.env }), (error) => {
      assert.match(error.stderr, /belongs to another installation/);
      return true;
    });
    assert.equal(await readFile(entry, "utf8"), "upstream sentinel");
    await assert.rejects(lstat(f.runtime), { code: "ENOENT" });
    await rm(entry);
    const external = join(f.root, "external");
    await writeFile(external, "other command");
    await symlink(external, entry);
    await assert.rejects(run("/bin/sh", [f.script], { env: f.env }));
    assert.equal((await lstat(entry)).isSymbolicLink(), true);
    assert.equal(await readFile(external, "utf8"), "other command");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test(
  "installer upgrades its previous wrapper and preserves zcode invocation",
  options,
  async () => {
    const f = await fixture();
    try {
      const version = "0.0.0-fixture";
      const stage = join(f.root, "stage");
      await mkdir(join(stage, "zcode/bin"), { recursive: true });
      await writeFile(
        join(stage, "zcode/bin/zcode.mjs"),
        'console.log("fixture " + process.argv.slice(2).join(" "));',
      );
      const releases = join(f.distribution, "releases", version);
      await mkdir(releases, { recursive: true });
      await run("tar", ["-czf", join(releases, "runtime.tar.gz"), "-C", stage, "zcode"]);
      await writeFile(
        join(f.distribution, "latest.json"),
        JSON.stringify({ version, tarball: "runtime.tar.gz" }),
      );
      const entry = join(f.bin, "zcode");
      // 已发布安装器的原始 wrapper 没有 marker，也应可原地升级。
      await writeFile(
        entry,
        '#!/usr/bin/env sh\nexec node "' + f.runtime + '/current/bin/zcode.mjs" "$@"\n',
      );
      for (let pass = 0; pass < 2; pass += 1) {
        const result = await run("/bin/sh", [f.script], { env: f.env });
        assert.match(result.stdout, /OpenZWork .* installed/);
        assert.match(await readFile(entry, "utf8"), /Managed by OpenZWork/);
        const cli = await run("/bin/sh", [entry, "--version"], { env: f.env });
        assert.equal(cli.stdout.trim(), "fixture --version");
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
