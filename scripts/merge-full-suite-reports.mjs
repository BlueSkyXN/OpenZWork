import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FULL_SUITE_GROUPS,
  fullSuiteShardsForPlatform,
  selectFullSuiteGroups,
} from "./full-suite-plan.mjs";
import { validateSummary, validateTests } from "./test-report-validation.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");

function uniqueFiles(files) {
  assert.ok(Array.isArray(files) && files.length > 0, "Missing discovery files");
  for (const file of files) {
    assert.equal(typeof file, "string");
    assert.ok(
      file && !file.startsWith("/") && !file.includes("\\") && !file.includes(":"),
      "Expected relative file",
    );
    assert.ok(
      !file.split("/").some((part) => part === ".." || part === "."),
      "Invalid relative file",
    );
  }
  assert.equal(new Set(files).size, files.length, "Duplicate test file");
  return [...files].sort();
}

function validatePart({ report, entry }) {
  const { scope } = entry;
  assert.ok(typeof scope?.root === "string" && scope.root.length > 0, "Missing discovery root");
  const prefix = scope.root.replaceAll("\\", "/").replace(/\/$/, "") + "/";
  const actual = report.testResults.map(({ name }) => {
    const path = name.replaceAll("\\", "/");
    assert.ok(path.startsWith(prefix), "Report file outside discovery root");
    return path.slice(prefix.length);
  });
  uniqueFiles(scope.all);
  return uniqueFiles(actual);
}

function mergeParts(parts) {
  assert.deepEqual(
    parts.map(({ entry }) => entry.vitestShard).sort(),
    ["1/2", "2/2"],
    "Missing/duplicate UI half",
  );
  const actual = parts.flatMap(validatePart);
  const all = uniqueFiles(parts[0].entry.scope.all);
  assert.deepEqual(
    uniqueFiles(parts[1].entry.scope.all),
    all,
    "UI full discovery differs between shards",
  );
  assert.deepEqual(uniqueFiles(actual), all, "UI halves omit or repeat files");
  const reports = parts.map(({ report }) => report);
  const merged = {
    ...reports[0],
    testResults: reports.flatMap((report) => report.testResults),
    startTime: Math.min(...reports.map((report) => report.startTime)),
  };
  // Vitest 的 suite 计数包含 describe，不能用 testResults.length 重算；保留各半片原始计数并求和。
  const counters = Object.keys(reports[0])
    .filter((key) => key.startsWith("num"))
    .sort();
  for (const report of reports)
    assert.deepEqual(
      Object.keys(report)
        .filter((key) => key.startsWith("num"))
        .sort(),
      counters,
    );
  for (const key of counters) {
    for (const report of reports)
      assert.ok(Number.isInteger(report[key]) && report[key] >= 0, `Invalid ${key}`);
    merged[key] = reports.reduce((sum, report) => sum + report[key], 0);
  }
  assert.ok(Number.isFinite(merged.startTime), "Missing report startTime");
  const snapshots = reports.map((report) => report.snapshot);
  for (const snapshot of snapshots)
    assert.equal(snapshot?.failure, false, "Failed snapshot report");
  const keys = Object.keys(snapshots[0]).sort();
  for (const snapshot of snapshots) assert.deepEqual(Object.keys(snapshot).sort(), keys);
  merged.snapshot = {};
  for (const key of keys) {
    const values = snapshots.map((snapshot) => snapshot[key]);
    if (values.every((value) => typeof value === "number" && Number.isFinite(value)))
      merged.snapshot[key] = values.reduce((sum, value) => sum + value, 0);
    else if (values.every(Array.isArray)) merged.snapshot[key] = values.flat();
    else {
      assert.ok(
        values.every((value) => typeof value === "boolean"),
        `Unsupported snapshot field ${key}`,
      );
      merged.snapshot[key] = values.some(Boolean);
    }
  }
  validateTests(merged);
  return merged;
}

export async function mergeFullSuiteReports({ inputDir, outputDir, expectedSource }) {
  await mkdir(outputDir, { recursive: true });
  const summary = { groups: [], anyFailed: false, errors: [] };
  for (const group of FULL_SUITE_GROUPS)
    await rm(join(outputDir, `${group.name}.json`), { force: true });
  try {
    for (const key of ["sourceCommit", "sourceTree", "workflowCommit"]) {
      assert.match(expectedSource[key], /^[a-f0-9]{40}$/, `Expected ${key}`);
    }
    const shards = fullSuiteShardsForPlatform(expectedSource.platform);
    assert.equal(
      expectedSource.testPool,
      expectedSource.platform === "windows-amd64" ? "forks" : "threads",
    );
    assert.match(expectedSource.runId, /^\d+$/, "Expected workflow run ID");
    assert.equal(expectedSource.shard, null, "Aggregate source must not select a shard");
    assert.deepEqual(
      (await readdir(inputDir)).sort(),
      shards.map((shard) => `extended-shard-${expectedSource.platform}-${shard}`).sort(),
      "Missing or unexpected shard artifacts",
    );

    const collected = new Map();
    for (const shard of shards) {
      const dir = join(inputDir, `extended-shard-${expectedSource.platform}-${shard}`);
      const groups = selectFullSuiteGroups(shard, expectedSource.platform);
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
          ["source.json", "summary.json", ...groups.map((group) => `${group.name}.json`)].sort(),
          `${shard}: missing/unexpected report or cancelled marker`,
        );
        const partial = await readJson(join(dir, "summary.json"));
        assert.equal(partial.anyFailed, false, `${shard}: failed summary`);
        assert.deepEqual(
          partial.groups.map((entry) => entry.group).sort(),
          groups.map((group) => group.name).sort(),
          `${shard}: incomplete or duplicated groups`,
        );
        for (const entry of partial.groups) {
          const group = groups.find((group) => group.name === entry.group);
          assert.equal(entry.vitestShard, group.vitestShard, `${shard}: wrong Vitest shard`);
          assert.equal(entry.status, "passed", `${entry.group}: failed status`);
          assert.equal(entry.exit, 0, `${entry.group}: nonzero exit`);
          const report = await readJson(join(dir, `${entry.group}.json`));
          validateTests(report);
          const parts = collected.get(entry.group) ?? [];
          parts.push({ entry, report });
          collected.set(entry.group, parts);
        }
      } catch (error) {
        summary.errors.push(`${shard}: ${error.message}`);
      }
    }
    for (const group of FULL_SUITE_GROUPS) {
      try {
        const parts = collected.get(group.name) ?? [];
        const split = expectedSource.platform === "windows-amd64" && group.name === "ui-and-web";
        assert.equal(parts.length, split ? 2 : 1, `${group.name}: missing or duplicate reports`);
        const report = split ? mergeParts(parts) : parts[0].report;
        await writeJson(join(outputDir, `${group.name}.json`), report);
        summary.groups.push({ group: group.name, status: "passed", exit: 0 });
      } catch (error) {
        summary.errors.push(`${group.name}: ${error.message}`);
      }
    }
    assert.equal(summary.errors.length, 0, summary.errors.join("\n"));
    validateSummary(summary);
  } catch (error) {
    summary.anyFailed = true;
    if (summary.errors.length === 0) summary.errors.push(error.message);
  }
  // 失败仍落摘要用于诊断；发布器的 anyFailed / 七组校验会拒绝不完整结果。
  await writeJson(join(outputDir, "source.json"), expectedSource);
  await writeJson(join(outputDir, "summary.json"), summary);
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
