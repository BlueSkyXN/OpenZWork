import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const policy = JSON.parse(await readFile(new URL("./core-tests.json", import.meta.url), "utf8"));
const declared = policy.suites.flatMap((suite) => suite.files);
const workflow = async (name) =>
  parseDocument(await readFile(join(root, ".github/workflows", name), "utf8")).toJS();

test("core discovery keeps every declared regression and preserves process isolation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openzwork-core-scope-"));
  try {
    const output = join(dir, "discovered.json");
    await promisify(execFile)(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "list",
        "--config",
        "vitest.core.config.ts",
        "--filesOnly",
        `--json=${output}`,
      ],
      { cwd: root },
    );
    const discovered = JSON.parse(await readFile(output, "utf8"));
    const actual = discovered.map(({ file }) => relative(root, file).split(sep).join("/"));
    assert.equal(new Set(declared).size, declared.length);
    assert.deepEqual(actual.toSorted(), declared.toSorted());
    for (const file of [
      "packages/desktop/test/desktopRuntimeEnv.test.ts",
      "packages/services/test/zcodeAgentProcessManager.test.ts",
      "packages/services/test/mcpSyncService.test.ts",
      "packages/services/test/subagentRuntimeConfigWatcher.test.ts",
    ]) {
      const entry = discovered.find(
        (item) => relative(root, item.file).split(sep).join("/") === file,
      );
      assert.equal(entry?.projectName, "fork-isolated", file);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("core CI cannot be hidden behind historical collection or optional outcomes", async () => {
  const ci = await workflow("ci.yml");
  const steps = ci.jobs.checks.steps;
  const core = steps.filter((step) => step.run?.startsWith("pnpm test:ci:core"));
  assert.equal(core.length, 1);
  assert.equal(core[0].if, undefined);
  assert.equal(core[0]["continue-on-error"], undefined);
  assert.equal(ci.jobs.checks.needs, undefined);
  assert.ok(!steps.some((step) => /vitest list|pnpm (?:run )?test:unit/.test(step.run ?? "")));
});

test("repository Node regressions run in the blocking platform checks", async () => {
  const ci = await workflow("ci.yml");
  const steps = ci.jobs.checks.steps;
  const scriptSteps = steps.filter((step) => step.run === "pnpm test:repo-scripts");
  assert.equal(scriptSteps.length, 1);
  assert.equal(scriptSteps[0].if, undefined);
  assert.equal(scriptSteps[0]["continue-on-error"], undefined);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.match(manifest.scripts["test:repo-scripts"], /scripts\/test\/\*\.test\.mjs/);
  assert.match(manifest.scripts["test:repo-scripts"], /--test-concurrency=1/);
});

test("real release archive regressions remain discovered once in the isolated process pool", async () => {
  const files = [
    "packages/zcode-server-cli/test/releaseInstaller.test.ts",
    "packages/zcode-server-cli/test/cli.test.ts",
  ];
  const dir = await mkdtemp(join(tmpdir(), "openzwork-release-scope-"));
  try {
    const output = join(dir, "discovered.json");
    await promisify(execFile)(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "list",
        ...files,
        "--filesOnly",
        `--json=${output}`,
      ],
      { cwd: root },
    );
    const discovered = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      discovered.map(({ file }) => relative(root, file).split(sep).join("/")).toSorted(),
      files.toSorted(),
    );
    for (const entry of discovered) assert.equal(entry.projectName, "fork-isolated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("project MCP regression runs after required runtime artifacts are built", async () => {
  const steps = (await workflow("ci.yml")).jobs.checks.steps;
  const build = steps.findIndex((step) => step.run === "node scripts/build-desktop-agent-cli.mjs");
  const regression = steps.findIndex((step) =>
    step.run?.includes("tests/mcp-project-config.test.ts"),
  );
  assert.ok(build >= 0 && regression > build);
  assert.equal(steps[build].if, undefined);
  assert.equal(steps[build]["continue-on-error"], undefined);
});

test("extended checks keep real failures and run independently with Electron prepared", async () => {
  const extended = await workflow("extended-checks.yml");
  for (const job of Object.values(extended.jobs)) {
    assert.equal(job.needs, undefined);
    assert.equal(job["continue-on-error"], undefined);
    for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  }
  const tests = extended.jobs["historical-tests"].steps;
  assert.ok(tests.some((step) => step.run === "pnpm install --frozen-lockfile"));
  // 2026-10-20：全量套件改为分组执行，脚本内建组级时限与逐组 JSON；断言从单条
  // vitest 命令改为分组入口，语义不变（真实失败仍失败、结果仍上传）。
  assert.ok(tests.some((step) => step.run === "node scripts/run-full-suite-groups.mjs"));
  assert.ok(
    extended.jobs["desktop-main-audit"].steps.some((step) =>
      step.run?.includes("tsc -p packages/desktop/tsconfig.main.json --noEmit"),
    ),
  );
});
