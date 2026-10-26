import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FULL_SUITE_GROUPS, FULL_SUITE_SHARDS } from "./full-suite-plan.mjs";
import { validateSummary, validateTests } from "./test-report-validation.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

export async function mergeFullSuiteReports({ inputDir, outputDir, expectedSource }) {
  await mkdir(outputDir, { recursive: true });
  const summary = { groups: [], anyFailed: false, errors: [] };
  try {
    for (const key of ["sourceCommit", "sourceTree", "workflowCommit"]) {
      assert.match(expectedSource[key], /^[a-f0-9]{40}$/, `Expected ${key}`);
    }
    assert.ok(["macos-arm64", "windows-amd64", "linux-amd64"].includes(expectedSource.platform));
    assert.equal(
      expectedSource.testPool,
      expectedSource.platform === "windows-amd64" ? "forks" : "threads",
    );
    assert.match(expectedSource.runId, /^\d+$/, "Expected workflow run ID");
    assert.equal(expectedSource.shard, null, "Aggregate source must not select a shard");
    const directories = Object.keys(FULL_SUITE_SHARDS).map(
      (shard) => `extended-shard-${expectedSource.platform}-${shard}`,
    );
    assert.deepEqual(
      (await readdir(inputDir)).sort(),
      directories.sort(),
      "Missing or unexpected shard artifacts",
    );

    for (const [shard, groups] of Object.entries(FULL_SUITE_SHARDS)) {
      const dir = join(inputDir, `extended-shard-${expectedSource.platform}-${shard}`);
      try {
        const source = await readJson(join(dir, "source.json"));
        for (const key of [
          "sourceCommit",
          "sourceTree",
          "workflowCommit",
          "testPool",
          "platform",
          "runId",
        ]) {
          assert.equal(source[key], expectedSource[key], `${shard}: mismatched ${key}`);
        }
        assert.equal(source.shard, shard, `${shard}: mismatched shard`);
        assert.deepEqual(
          (await readdir(dir)).sort(),
          ["source.json", "summary.json", ...groups.map((group) => `${group}.json`)].sort(),
          `${shard}: missing/unexpected report or cancelled marker`,
        );
        const partial = await readJson(join(dir, "summary.json"));
        assert.equal(partial.anyFailed, false, `${shard}: failed summary`);
        assert.deepEqual(
          partial.groups.map((entry) => entry.group).sort(),
          [...groups].sort(),
          `${shard}: incomplete or duplicated groups`,
        );
        for (const entry of partial.groups) {
          assert.equal(entry.status, "passed", `${entry.group}: failed status`);
          assert.equal(entry.exit, 0, `${entry.group}: nonzero exit`);
          validateTests(await readJson(join(dir, `${entry.group}.json`)));
          await copyFile(join(dir, `${entry.group}.json`), join(outputDir, `${entry.group}.json`));
          summary.groups.push(entry);
        }
      } catch (error) {
        summary.errors.push(`${shard}: ${error.message}`);
      }
    }
    summary.groups.sort(
      (a, b) =>
        FULL_SUITE_GROUPS.findIndex((group) => group.name === a.group) -
        FULL_SUITE_GROUPS.findIndex((group) => group.name === b.group),
    );
    assert.equal(summary.errors.length, 0, summary.errors.join("\n"));
    validateSummary(summary);
  } catch (error) {
    summary.anyFailed = true;
    if (summary.errors.length === 0) summary.errors.push(error.message);
  }
  // 失败仍落摘要用于诊断；发布器的 anyFailed / 七组校验会拒绝不完整结果。
  await writeFile(join(outputDir, "source.json"), JSON.stringify(expectedSource, null, 2) + "\n");
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2, "This command uses the workflow's fixed report paths");
  const outputDir = resolve(".run-logs/full-groups");
  const summary = await mergeFullSuiteReports({
    inputDir: resolve(".run-logs/extended-shards"),
    outputDir,
    expectedSource: await readJson(join(outputDir, "source.json")),
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.anyFailed ? 1 : 0;
}
