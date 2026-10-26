import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createVitest } from "vitest/node";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import {
  FULL_SUITE_GROUPS,
  FULL_SUITE_SHARDS,
  fullSuiteShardsForPlatform,
  selectFullSuiteGroups,
} from "../../scripts/full-suite-plan.mjs";
import { parseShardArgs, runFullSuiteGroups } from "../../scripts/run-full-suite-groups.mjs";
import { mergeFullSuiteReports } from "../../scripts/merge-full-suite-reports.mjs";
import { validateSummary, validateTests } from "../../scripts/publish-github-release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const exec = promisify(execFile);
const workflow = parse(await readFile(join(root, ".github/workflows/extended-checks.yml"), "utf8"));
const platforms = ["macos-arm64", "windows-amd64", "linux-amd64"];
const writeJson = (path, data) => writeFile(path, JSON.stringify(data));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), "openzwork-extended-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  // macOS 的 /var 临时目录是符号链接；使用实际路径匹配 runner 的规范 checkout 路径。
  return realpath(dir);
}

test("platform plans retain seven groups within nine runners and five macOS slots", () => {
  const expected = {
    "macos-arm64": ["ui-and-web", "services-and-supporting"],
    "windows-amd64": ["services", "supporting", "ui-and-web-1", "ui-and-web-2"],
    "linux-amd64": ["services", "ui-and-web", "supporting"],
  };
  for (const platform of platforms) {
    const shards = fullSuiteShardsForPlatform(platform);
    assert.deepEqual(shards, expected[platform]);
    const groups = shards.flatMap((shard) => selectFullSuiteGroups(shard, platform));
    assert.deepEqual(
      [...new Set(groups.map((group) => group.name))].sort(),
      FULL_SUITE_GROUPS.map((group) => group.name).sort(),
    );
    assert.equal(groups.length, platform === "windows-amd64" ? 8 : 7);
  }
  assert.throws(() => fullSuiteShardsForPlatform("unknown"));
  assert.throws(() => selectFullSuiteGroups("ui-and-web-1", "macos-arm64"));
  assert.equal(selectFullSuiteGroups().length, 7);
  for (const shard of Object.keys(FULL_SUITE_SHARDS)) {
    assert.equal(parseShardArgs([`--shard=${shard}`]), shard);
    assert.deepEqual(
      selectFullSuiteGroups(shard).map((group) => group.name),
      FULL_SUITE_SHARDS[shard],
    );
  }
  for (const args of [
    ["--shard="],
    ["--shard=unknown"],
    ["--shard=constructor"],
    ["--shard=services", "extra"],
    ["--unknown"],
  ])
    assert.throws(() => parseShardArgs(args));
});

test("shard discovery retains the complete root test scope and isolated project", async (t) => {
  const dir = await temp(t);
  const discover = async (name, filters) => {
    const output = join(dir, `${name}.json`);
    await exec(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "list",
        ...filters,
        "--filesOnly",
        `--json=${output}`,
      ],
      { cwd: root },
    );
    return (await readJson(output)).map(
      ({ file, projectName }) => `${projectName}:${relative(root, file).split(sep).join("/")}`,
    );
  };
  const expected = await discover("all", []);
  const actual = [];
  for (const shard of fullSuiteShardsForPlatform("linux-amd64")) {
    actual.push(
      ...(await discover(
        shard,
        selectFullSuiteGroups(shard).flatMap((group) => group.filter),
      )),
    );
  }
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort());
  assert.ok(actual.some((entry) => entry.startsWith("fork-isolated:")));
});

test("supporting runner continues after failure and timeout, clearing previous reports", async (t) => {
  const cwd = await temp(t);
  const outDir = join(cwd, ".run-logs/full-groups");
  await mkdir(outDir, { recursive: true });
  await writeJson(join(outDir, "source.json"), { fixture: true });
  await writeJson(join(outDir, "shared-and-rpc.json"), { stale: true });
  const calls = [];
  const summary = await runFullSuiteGroups({
    cwd,
    shard: "supporting",
    execute(command, args, options) {
      calls.push({ command, args, options });
      if (calls.length === 1) return { status: 1 };
      if (calls.length === 2) return { status: null, error: { code: "ETIMEDOUT" } };
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 5);
  assert.equal(summary.anyFailed, true);
  assert.deepEqual(
    summary.groups.map((group) => group.status),
    ["failed", "cancelled", "passed", "passed", "passed"],
  );
  assert.deepEqual(
    calls.map((call) => call.options.timeout),
    [12, 12, 12, 30, 10].map((minutes) => minutes * 60_000),
  );
  assert.ok(
    calls.every(
      (call) => call.command === "pnpm" && !call.args.some((arg) => arg.startsWith("--maxWorkers")),
    ),
  );
  await assert.rejects(readFile(join(outDir, "shared-and-rpc.json")), { code: "ENOENT" });
  assert.ok(await readFile(join(outDir, "provider.json.cancelled"), "utf8"));
  assert.deepEqual(await readJson(join(outDir, "source.json")), { fixture: true });
  assert.deepEqual(await readJson(join(outDir, "summary.json")), summary);
});

async function fixture(t, platform = "windows-amd64") {
  const cwd = await temp(t);
  const inputDir = join(cwd, ".run-logs/extended-shards");
  const outputDir = join(cwd, ".run-logs/full-groups");
  const expectedSource = {
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
    workflowCommit: "c".repeat(40),
    testPool: platform === "windows-amd64" ? "forks" : "threads",
    platform,
    shard: null,
    runId: "123",
  };
  const shardDir = (shard) => join(inputDir, `extended-shard-${platform}-${shard}`);
  await mkdir(outputDir, { recursive: true });
  await writeJson(join(outputDir, "source.json"), expectedSource);
  for (const shard of fullSuiteShardsForPlatform(platform)) {
    const groups = selectFullSuiteGroups(shard);
    const dir = shardDir(shard);
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, "source.json"), { ...expectedSource, shard });
    await writeJson(join(dir, "summary.json"), {
      anyFailed: false,
      groups: groups.map(({ name, vitestShard }) => ({
        group: name,
        status: "passed",
        exit: 0,
        ...(vitestShard
          ? { vitestShard, scope: { root: cwd, all: ["ui-1.test.ts", "ui-2.test.ts"] } }
          : {}),
      })),
    });
    for (const { name: group, vitestShard } of groups) {
      await writeJson(join(dir, `${group}.json`), {
        success: true,
        numFailedTests: 0,
        numFailedTestSuites: 0,
        numTotalTestSuites: 1,
        numPassedTestSuites: 1,
        numPendingTestSuites: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        startTime: 100,
        snapshot: {
          added: 0,
          failure: false,
          filesAdded: 0,
          filesRemoved: 0,
          filesRemovedList: [],
          filesUnmatched: 0,
          filesUpdated: 0,
          matched: 1,
          total: 1,
          unchecked: 0,
          uncheckedKeysByFile: [],
          unmatched: 0,
          updated: 0,
          didUpdate: false,
        },
        numTotalTests: 1,
        numPassedTests: 1,
        testResults: [
          {
            name: join(cwd, vitestShard ? `ui-${vitestShard[0]}.test.ts` : `${group}.test.ts`),
            status: "passed",
            assertionResults: [{ fullName: group, status: "passed" }],
          },
        ],
      });
    }
  }
  return { cwd, inputDir, outputDir, expectedSource, shardDir };
}

for (const platform of platforms) {
  test(`${platform}: merged artifact remains accepted by the production release validators`, async (t) => {
    const f = await fixture(t, platform);
    const summary = await mergeFullSuiteReports(f);
    validateSummary(summary);
    assert.deepEqual(summary.errors, []);
    assert.deepEqual(await readJson(join(f.outputDir, "source.json")), f.expectedSource);
    for (const group of FULL_SUITE_GROUPS)
      validateTests(await readJson(join(f.outputDir, `${group.name}.json`)));
  });
}

const brokenReports = [
  ["missing shard", (f) => rm(f.shardDir("services"), { recursive: true })],
  ["extra shard", (f) => mkdir(join(f.inputDir, "extended-shard-windows-amd64-extra"))],
  ["missing group JSON", (f) => rm(join(f.shardDir("services"), "services.json"))],
  [
    "cancelled group",
    (f) => writeFile(join(f.shardDir("services"), "services.json.cancelled"), "timeout"),
  ],
  ["corrupt JSON", (f) => writeFile(join(f.shardDir("services"), "services.json"), "{")],
  ["misplaced report", (f) => writeJson(join(f.shardDir("services"), "desktop.json"), {})],
  ...["duplicate", "failed", "nonzero", "summary-failure"].map((kind) => [
    kind,
    async (f) => {
      const file = join(f.shardDir("services"), "summary.json");
      const summary = await readJson(file);
      if (kind === "duplicate") summary.groups.push(summary.groups[0]);
      if (kind === "failed") summary.groups[0].status = "failed";
      if (kind === "nonzero") summary.groups[0].exit = 1;
      if (kind === "summary-failure") summary.anyFailed = true;
      await writeJson(file, summary);
    },
  ]),
  ...["success", "numFailedTests", "numRuntimeErrorTestSuites", "numPassedTests"].map((key) => [
    `invalid report ${key}`,
    async (f) => {
      const file = join(f.shardDir("services"), "services.json");
      const report = await readJson(file);
      report[key] = key === "success" ? false : 2;
      await writeJson(file, report);
    },
  ]),
  ...["sourceCommit", "sourceTree", "workflowCommit", "testPool", "platform", "shard", "runId"].map(
    (key) => [
      `mismatched ${key}`,
      async (f) => {
        const file = join(f.shardDir("services"), "source.json");
        const source = await readJson(file);
        source[key] = "wrong";
        await writeJson(file, source);
      },
    ],
  ),
];
for (const [name, breakReport] of brokenReports) {
  test(`aggregation rejects ${name} and records a failed summary`, async (t) => {
    const f = await fixture(t);
    await breakReport(f);
    const summary = await mergeFullSuiteReports(f);
    assert.equal(summary.anyFailed, true);
    assert.ok(summary.errors.length > 0);
    assert.throws(() => validateSummary(summary));
    assert.deepEqual(await readJson(join(f.outputDir, "summary.json")), summary);
  });
}

test("aggregate CLI exits nonzero for missing shards and succeeds with complete reports", async (t) => {
  const f = await fixture(t);
  const command = join(root, "scripts/merge-full-suite-reports.mjs");
  await exec(process.execPath, [command], { cwd: f.cwd });
  await rm(f.shardDir("services"), { recursive: true });
  await assert.rejects(exec(process.execPath, [command], { cwd: f.cwd }), { code: 1 });
  assert.equal((await readJson(join(f.outputDir, "summary.json"))).anyFailed, true);
  await assert.rejects(
    exec(process.execPath, [join(root, "scripts/run-full-suite-groups.mjs"), "--shard=unknown"], {
      cwd: f.cwd,
    }),
    { code: 1 },
  );
});

test("sparse workflow tools merge reports without application files or node_modules", async (t) => {
  const f = await fixture(t);
  // CI 的工具 checkout 只有 scripts；完整工作区导入会掩盖发布器的桌面打包依赖。
  const tools = join(f.cwd, ".ci-tools/scripts");
  await cp(join(root, "scripts"), tools, { recursive: true });
  await exec(process.execPath, [join(tools, "merge-full-suite-reports.mjs")], { cwd: f.cwd });
  validateSummary(await readJson(join(f.outputDir, "summary.json")));
});

test("workflow expands to nine isolated runners and preserves the platform release reports", () => {
  const tests = workflow.jobs["historical-tests"];
  const os = {
    "macos-arm64": "macos-14",
    "windows-amd64": "windows-latest",
    "linux-amd64": "ubuntu-latest",
  };
  assert.deepEqual(tests.strategy.matrix, {
    include: platforms.flatMap((platform) =>
      fullSuiteShardsForPlatform(platform).map((shard) => ({ os: os[platform], platform, shard })),
    ),
  });
  assert.equal(tests.strategy.matrix.include.length, 9);
  assert.equal(
    tests.strategy.matrix.include.filter((item) => item.platform === "macos-arm64").length + 2 + 1,
    5,
  );
  assert.equal(tests.strategy["fail-fast"], false);
  assert.equal(tests.env.EXTENDED_TEST_SHARD, "${{ matrix.shard }}");
  assert.equal(
    tests.env.ZCODE_TEST_POOL,
    "${{ matrix.platform == 'windows-amd64' && 'forks' || 'threads' }}",
  );
  assert.equal(
    tests.steps.find((step) => step.id === "full_tests").run,
    "node .ci-tools/scripts/run-full-suite-groups.mjs --shard=${{ matrix.shard }}",
  );
  const aggregate = workflow.jobs["historical-results"];
  assert.equal(aggregate.needs, "historical-tests");
  assert.equal(aggregate.if, "always() && inputs.repair != true");
  assert.equal(aggregate.name, "full suite (${{ matrix.platform }})");
  assert.equal(aggregate["runs-on"], "ubuntu-latest");
  assert.deepEqual(aggregate.strategy.matrix.platform, platforms);
  assert.equal(aggregate.strategy["fail-fast"], false);
  assert.ok(
    !aggregate.steps.some((step) => /pnpm install|typecheck|build:remote/.test(step.run ?? "")),
  );
  const download = aggregate.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  assert.equal(download.uses, "actions/download-artifact@v8.0.2");
  assert.deepEqual(download.with, {
    pattern: "extended-shard-${{ matrix.platform }}-*",
    path: ".run-logs/extended-shards",
    "merge-multiple": false,
  });
  for (const [job, artifactName] of [
    [tests, "extended-shard-${{ matrix.platform }}-${{ matrix.shard }}"],
    [aggregate, "extended-tests-${{ matrix.platform }}"],
  ]) {
    assert.equal(job["continue-on-error"], undefined);
    const upload = job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    assert.equal(upload.with.name, artifactName);
    assert.equal(upload.with.overwrite, true);
    assert.equal(upload.with.archive, true);
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.match(upload.if, /always\(\)/);
    assert.equal(job.steps[0].with.ref, "${{ inputs.source_commit || github.sha }}");
    const tools = job.steps.find((step) => step.name === "Checkout workflow tools");
    assert.equal(tools.with.ref, "${{ github.workflow_sha }}");
    assert.equal(tools.with.path, ".ci-tools");
    assert.equal(tools.with["sparse-checkout"], "scripts");
    assert.equal(tools.with["persist-credentials"], false);
    for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  }
});

test("native Vitest sequencer partitions the UI discovery without changing projects", async () => {
  const ctx = await createVitest("test", { root, run: true, watch: false, shard: "1/2" });
  try {
    const all = await ctx.getRelevantTestSpecifications(["packages/ui", "packages/web"]);
    const key = (spec) => `${spec.project.name}:${spec.moduleId}`;
    const sequencer = new ctx.config.sequence.sequencer(ctx);
    const a = await sequencer.shard([...all]);
    ctx.config.shard = { index: 2, count: 2 };
    const b = await sequencer.shard([...all]);
    assert.ok(a.length > 0 && b.length > 0);
    const actual = [...a, ...b].map(key);
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(actual.sort(), all.map(key).sort());
  } finally {
    await ctx.close();
  }
});

for (const [shard, part] of [
  ["ui-and-web-1", "1/2"],
  ["ui-and-web-2", "2/2"],
]) {
  test(`${shard} forwards the native shard flag and records complete discovery`, async (t) => {
    const cwd = await temp(t);
    const calls = [];
    const summary = await runFullSuiteGroups({
      cwd,
      shard,
      env: { EXTENDED_TEST_PLATFORM: "windows-amd64" },
      execute(command, args, options) {
        calls.push({ command, args, options });
        if (args[2] === "list") {
          const file = args.find((arg) => arg.startsWith("--json=")).slice(7);
          // 同步执行器夹具模拟 Vitest 写入 discovery；生产路径使用异步文件 IO。
          writeFileSync(
            file,
            JSON.stringify([
              { file: join(cwd, "ui-a.test.ts") },
              { file: join(cwd, "ui-b.test.ts") },
            ]),
          );
        }
        return { status: 0 };
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].args.some((arg) => arg.startsWith("--shard=")));
    assert.ok(calls[1].args.includes(`--shard=${part}`));
    assert.ok(
      calls.every(
        (call) => !call.args.some((arg) => /maxWorkers|pool|retry|testTimeout/.test(arg)),
      ),
    );
    assert.equal(summary.groups[0].vitestShard, part);
    assert.deepEqual(summary.groups[0].scope, { root: cwd, all: ["ui-a.test.ts", "ui-b.test.ts"] });
    assert.equal(summary.anyFailed, false);
  });
}

for (const kind of [
  "missing-half",
  "wrong-half",
  "overlap",
  "missing-file",
  "extra-file",
  "different-discovery",
  "count-mismatch",
  "snapshot-failure",
]) {
  test(`UI aggregation rejects ${kind}`, async (t) => {
    const f = await fixture(t);
    const dir = f.shardDir("ui-and-web-2");
    if (kind === "missing-half") await rm(dir, { recursive: true });
    else {
      const summaryFile = join(dir, "summary.json");
      const partial = await readJson(summaryFile);
      const group = partial.groups[0];
      const reportFile = join(dir, "ui-and-web.json");
      const report = await readJson(reportFile);
      if (kind === "wrong-half") group.vitestShard = "1/2";
      if (kind === "overlap") {
        report.testResults[0].name = join(f.cwd, "ui-1.test.ts");
      }
      if (kind === "missing-file") {
        group.scope.all.push("missing.test.ts");
        const otherFile = join(f.shardDir("ui-and-web-1"), "summary.json");
        const other = await readJson(otherFile);
        other.groups[0].scope.all.push("missing.test.ts");
        await writeJson(otherFile, other);
      }
      if (kind === "extra-file") report.testResults[0].name = join(f.cwd, "extra.test.ts");
      if (kind === "different-discovery") group.scope.all[0] = "different.test.ts";
      if (kind === "count-mismatch") report.numPassedTests = 2;
      if (kind === "snapshot-failure") report.snapshot.failure = true;
      await writeJson(summaryFile, partial);
      await writeJson(reportFile, report);
    }
    const summary = await mergeFullSuiteReports(f);
    assert.equal(summary.anyFailed, true);
    assert.ok(summary.errors.length > 0);
  });
}

test("UI aggregate combines both reports and snapshot counters once", async (t) => {
  const f = await fixture(t);
  validateSummary(await mergeFullSuiteReports(f));
  const ui = await readJson(join(f.outputDir, "ui-and-web.json"));
  assert.deepEqual(validateTests(ui), { files: 2, passed: 2, skipped: 0, failed: 0 });
  assert.equal(ui.numTotalTestSuites, 2);
  assert.equal(ui.snapshot.matched, 2);
  assert.equal(ui.snapshot.total, 2);
});

test("Ubuntu aggregation accepts Windows report paths from different checkout roots", async (t) => {
  const f = await fixture(t);
  for (const [index, drive] of [
    [1, "D"],
    [2, "E"],
  ]) {
    const dir = f.shardDir(`ui-and-web-${index}`);
    const summary = await readJson(join(dir, "summary.json"));
    const root = `${drive}:\\a\\repo\\repo`;
    summary.groups[0].scope.root = root;
    const report = await readJson(join(dir, "ui-and-web.json"));
    report.testResults[0].name = `${root.replaceAll("\\", "/")}/ui-${index}.test.ts`;
    await writeJson(join(dir, "summary.json"), summary);
    await writeJson(join(dir, "ui-and-web.json"), report);
  }
  validateSummary(await mergeFullSuiteReports(f));
});

test("failed discovery cannot reuse a previous successful summary", async (t) => {
  const cwd = await temp(t);
  const dir = join(cwd, ".run-logs/full-groups");
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "summary.json"), { anyFailed: false });
  let calls = 0;
  await assert.rejects(
    runFullSuiteGroups({
      cwd,
      shard: "ui-and-web-1",
      execute() {
        calls++;
        return { status: 1 };
      },
    }),
    /discovery failed/,
  );
  assert.equal(calls, 1);
  await assert.rejects(readFile(join(dir, "summary.json")), { code: "ENOENT" });
});
