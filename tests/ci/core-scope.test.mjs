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

test("extended checks keep real failures and run independently with Electron prepared", async () => {
  const extended = await workflow("extended-checks.yml");
  for (const job of Object.values(extended.jobs)) {
    assert.equal(job.needs, undefined);
    assert.equal(job["continue-on-error"], undefined);
    for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  }
  const tests = extended.jobs["historical-tests"].steps;
  assert.ok(tests.some((step) => step.run === "pnpm install --frozen-lockfile"));
  assert.ok(tests.some((step) => step.run?.startsWith("pnpm test:unit ")));
  assert.ok(
    extended.jobs["desktop-main-audit"].steps.some((step) =>
      step.run?.includes("tsc -p packages/desktop/tsconfig.main.json --noEmit"),
    ),
  );
});
