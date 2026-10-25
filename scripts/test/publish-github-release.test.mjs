import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import {
  validateExistingAssets,
  validateManifest,
  validateRun,
  validateSummary,
  validateTests,
} from "../publish-github-release.mjs";

const expected = {
  sourceTag: "v3.16.2-openzwork",
  sourceCommit: "a".repeat(40),
  sourceTree: "b".repeat(40),
  workflowCommit: "c".repeat(40),
  version: "3.16.2",
  platform: "windows-amd64",
  runUrl: "https://github.com/example/project/actions/runs/1",
};
const manifest = () => ({
  ...expected,
  productName: "OpenZWork",
  environment: "production",
  codeSigning: "unsigned",
  assets: [{ name: "OpenZWork-3.16.2-win-x64.exe", size: 123, sha256: "d".repeat(64) }],
});
const report = () => ({
  success: true,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  numPassedTests: 1,
  numTotalTests: 2,
  testResults: [
    {
      name: "example.test.ts",
      status: "passed",
      assertionResults: [{ status: "passed" }, { status: "skipped" }],
    },
  ],
});
const summary = () => ({
  anyFailed: false,
  groups: [
    "shared-and-rpc",
    "services",
    "provider",
    "server",
    "desktop",
    "ui-and-web",
    "root-scripts",
  ].map((group) => ({ group, status: "passed", exit: 0 })),
});

test("publisher requires successful exact-source test runs", () => {
  const run = {
    name: "CI",
    status: "completed",
    conclusion: "success",
    head_sha: expected.sourceCommit,
  };
  validateRun(run, "CI", expected.sourceCommit);
  for (const patch of [
    { name: "Installers" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { head_sha: "f".repeat(40) },
  ])
    assert.throws(() => validateRun({ ...run, ...patch }, "CI", expected.sourceCommit));
});

test("publisher rejects wrong installer provenance and Preview identity", () => {
  validateManifest(manifest(), expected);
  for (const key of Object.keys(expected))
    assert.throws(() => validateManifest({ ...manifest(), [key]: "wrong" }, expected), key);
  for (const patch of [
    { environment: "test" },
    { productName: "OpenZWork Preview" },
    { assets: [] },
  ])
    assert.throws(() => validateManifest({ ...manifest(), ...patch }, expected));
});

test("publisher rejects duplicate formats, unsafe names, empty files and invalid hashes", () => {
  const valid = manifest();
  assert.throws(() =>
    validateManifest({ ...valid, assets: [valid.assets[0], valid.assets[0]] }, expected),
  );
  for (const patch of [
    { name: "../OpenZWork-3.16.2-win-x64.exe" },
    { name: "OpenZWork-3.16.2-win-x64_TEST.exe" },
    { size: 0 },
    { size: -1 },
    { sha256: "bad" },
  ])
    assert.throws(() =>
      validateManifest({ ...valid, assets: [{ ...valid.assets[0], ...patch }] }, expected),
    );
});

test("publisher validates every Linux target and native architecture alias", () => {
  const input = { ...expected, platform: "linux-amd64" };
  const value = {
    ...manifest(),
    platform: input.platform,
    assets: [
      ["x86_64", "AppImage"],
      ["amd64", "deb"],
      ["x86_64", "rpm"],
      ["x64", "pkg.tar.zst"],
    ].map(([arch, ext]) => ({
      name: `OpenZWork-3.16.2-linux-${arch}.${ext}`,
      size: 123,
      sha256: "d".repeat(64),
    })),
  };
  validateManifest(value, input);
  value.assets[3] = value.assets[2];
  assert.throws(() => validateManifest(value, input));
});

test("test validation rejects misleading success and incomplete accounting", () => {
  assert.deepEqual(validateTests(report()), { files: 1, passed: 1, skipped: 1, failed: 0 });
  for (const patch of [
    { success: false },
    { numFailedTests: 1 },
    { numFailedTestSuites: 1 },
    { numRuntimeErrorTestSuites: 1 },
    { numTotalTests: 3 },
    { numPassedTests: 2 },
  ])
    assert.throws(() => validateTests({ ...report(), ...patch }));
  const bad = report();
  bad.testResults[0].assertionResults[0].status = "failed";
  assert.throws(() => validateTests(bad));
});

test("all seven Extended groups must finish with successful process exits", () => {
  validateSummary(summary());
  const missing = summary();
  missing.groups.pop();
  assert.throws(() => validateSummary(missing));
  const duplicate = summary();
  duplicate.groups[0] = duplicate.groups[1];
  assert.throws(() => validateSummary(duplicate));
  for (const patch of [{ status: "cancelled" }, { exit: 1 }, { exit: null }]) {
    const bad = summary();
    Object.assign(bad.groups[0], patch);
    assert.throws(() => validateSummary(bad));
  }
});

test("draft resume reuses identical assets and rejects overwrite or incomplete publication", () => {
  const files = new Map([["installer.exe", { size: 123, sha256: "d".repeat(64) }]]);
  const asset = {
    name: "installer.exe",
    state: "uploaded",
    size: 123,
    digest: `sha256:${"d".repeat(64)}`,
  };
  assert.deepEqual([...validateExistingAssets([], files)], []);
  assert.deepEqual([...validateExistingAssets([asset], files, true)], ["installer.exe"]);
  assert.throws(() => validateExistingAssets([], files, true));
  assert.throws(() => validateExistingAssets([asset, asset], files));
  for (const patch of [
    { name: "unknown.exe" },
    { size: 999 },
    { digest: `sha256:${"e".repeat(64)}` },
    { state: "starter" },
  ])
    assert.throws(() => validateExistingAssets([{ ...asset, ...patch }], files));
});

test("cloud publishing is manual, isolated from builds and uses least job permissions", async () => {
  const workflow = parse(
    await readFile(new URL("../../.github/workflows/installers.yml", import.meta.url), "utf8"),
  );
  assert.equal(workflow.permissions.contents, "read");
  assert.match(workflow.jobs.installer.if, /!inputs.publish_installer_run/);
  assert.match(workflow.jobs.publish.if, /workflow_dispatch/);
  assert.match(workflow.jobs.publish.if, /inputs.publish_installer_run/);
  assert.deepEqual(workflow.jobs.publish.permissions, { actions: "read", contents: "write" });
  assert.match(workflow.concurrency.group, /publish_installer_run/);
  assert.ok(
    workflow.jobs.publish.steps.some(
      (step) => step.run === "node scripts/publish-github-release.mjs",
    ),
  );
  assert.ok(!workflow.jobs.publish.steps.some((step) => step.run?.includes("pnpm install")));
});
