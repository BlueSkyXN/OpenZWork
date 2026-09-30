import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stageBundledSkills } from "../../../scripts/zcode-distribution/assets.mjs";
import { bundledSkillPackRequiredPaths } from "../../../apps/zcode-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";

for (const omitted of [undefined, ...bundledSkillPackRequiredPaths]) {
  test(`Node 发行技能包 ${omitted ? `拒绝缺失 ${omitted}` : "复制完整引用树"}`, async () => {
    const fixture = await mkdtemp(join(tmpdir(), "ozw-skill-assets-"));
    try {
      const source = join(fixture, "source");
      const target = join(fixture, "package");
      for (const path of [
        ...bundledSkillPackRequiredPaths,
        "skills/dynamic-workflows/extra-reference.md",
      ]) {
        if (path === omitted) continue;
        await mkdir(dirname(join(source, path)), { recursive: true });
        await writeFile(join(source, path), path);
      }
      if (omitted)
        await assert.rejects(
          stageBundledSkills(target, source),
          /Missing bundled skill required file/,
        );
      else {
        await stageBundledSkills(target, source);
        for (const path of [
          ...bundledSkillPackRequiredPaths,
          "skills/dynamic-workflows/extra-reference.md",
        ]) {
          assert.equal(
            await readFile(join(target, "agent/packages/bundled-skills", path), "utf8"),
            path,
          );
        }
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}

test("Node 发行拒绝目录代替必需技能文件", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "ozw-skill-directory-"));
  try {
    const source = join(fixture, "source");
    await mkdir(join(source, bundledSkillPackRequiredPaths[0]!), { recursive: true });
    await assert.rejects(
      stageBundledSkills(join(fixture, "package"), source),
      /Missing bundled skill required file/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
