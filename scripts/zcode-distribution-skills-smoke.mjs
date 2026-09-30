import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { bundledSkillPackRequiredPaths } from "../apps/zcode-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";

const execute = promisify(execFile);
const archive = process.argv[2];
assert.ok(
  archive,
  "Usage: node scripts/zcode-distribution-skills-smoke.mjs <archive> [install.sh]",
);
const fixture = await realpath(await mkdtemp(join(tmpdir(), "ozw-release-skills-")));
const workspace = join(fixture, "workspace");
const home = join(fixture, "home");
const sourceRoot = resolve(import.meta.dirname, "../apps/zcode-cli/packages/bundled-skills");
const env = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  HOME: home,
  USERPROFILE: home,
  NODE_PATH: "",
  NODE_OPTIONS: "",
};
try {
  await mkdir(workspace);
  await mkdir(home);
  await execute("tar", ["-xzf", resolve(archive), "-C", fixture]);
  async function inspect(packageRoot) {
    const runner = join(packageRoot, "bin/zcode.mjs");
    const listed = JSON.parse(
      (
        await execute(process.execPath, [runner, "--json", "skills", "list"], {
          cwd: workspace,
          env,
        })
      ).stdout,
    );
    assert.ok(
      listed.skills.some(
        (skill) => skill.name === "dynamic-workflows" && skill.source === "bundled",
      ),
    );
    const inspected = JSON.parse(
      (
        await execute(
          process.execPath,
          [runner, "--json", "skills", "inspect", "dynamic-workflows"],
          { cwd: workspace, env },
        )
      ).stdout,
    );
    assert.equal(inspected.skill.metadata.source, "bundled");
    assert.match(inspected.skill.content, /CreateWorkflow/);
    for (const path of bundledSkillPackRequiredPaths) {
      assert.deepEqual(
        await readFile(join(packageRoot, "agent/packages/bundled-skills", path)),
        await readFile(join(sourceRoot, path)),
      );
    }
    return { source: inspected.skill.metadata.source, bytesRead: inspected.skill.bytesRead };
  }
  const unpacked = await inspect(join(fixture, "zcode"));
  let installed;
  if (process.argv[3]) {
    const installer = resolve(process.argv[3]);
    const distRoot = resolve(installer, "..");
    await execute("/bin/sh", [installer], {
      cwd: workspace,
      env: { ...env, ZCODE_DIST_BASE_URL: `file://${distRoot}` },
    });
    installed = await inspect(join(home, ".openzwork/runtime/current"));
  }
  console.log(
    JSON.stringify({
      archive: resolve(archive),
      isolated: true,
      unpacked,
      installed,
      modelRequests: 0,
    }),
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
