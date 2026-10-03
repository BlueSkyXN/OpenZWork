import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDocument } from "yaml";

const root = new URL("../../", import.meta.url);
const actionVersions = {
  "actions/checkout": "v7.0.1",
  "pnpm/action-setup": "v6.1.0",
  "actions/setup-node": "v7.0.0",
  "actions/cache": "v6.1.0",
  "actions/upload-artifact": "v7.0.1",
};
const workflows = await Promise.all(
  ["ci.yml", "installers.yml"].map(async (name) => {
    const source = await readFile(new URL(`.github/workflows/${name}`, root), "utf8");
    const document = parseDocument(source);
    assert.deepEqual(document.errors, [], `${name}: valid YAML`);
    return document.toJS();
  }),
);
const [ci, installers] = workflows;
const ciSteps = ci.jobs.checks.steps;
const installerSteps = installers.jobs.installer.steps;

function actionStep(steps, action) {
  const matches = steps.filter((step) => step.uses?.startsWith(`${action}@`));
  assert.equal(matches.length, 1, `${action}: exactly one step`);
  return matches[0];
}

for (const [name, steps] of [
  ["CI", ciSteps],
  ["Installers", installerSteps],
]) {
  test(`${name} uses the reviewed Node.js 24 Action releases`, () => {
    const actions = steps.filter((step) => step.uses);
    assert.equal(actions.length, name === "CI" ? 4 : 5);
    for (const step of actions) {
      const [action, version] = step.uses.split("@");
      assert.ok(Object.hasOwn(actionVersions, action), `${action}: reviewed Action`);
      assert.equal(version, actionVersions[action], `${action}: reviewed release`);
    }
  });

  test(`${name} keeps the pinned toolchain and a single pnpm cache owner`, () => {
    assert.deepEqual(
      steps.slice(0, 3).map((step) => step.uses.split("@")[0]),
      ["actions/checkout", "pnpm/action-setup", "actions/setup-node"],
    );
    assert.deepEqual(actionStep(steps, "pnpm/action-setup").with, { version: "10.33.2" });
    assert.deepEqual(actionStep(steps, "actions/setup-node").with, {
      "node-version": "24.14.0",
      cache: "pnpm",
    });
  });
}

test("dependency installation keeps each workflow's lifecycle-script policy", () => {
  for (const [steps, command] of [
    [ciSteps, "pnpm install --frozen-lockfile --ignore-scripts"],
    [installerSteps, "pnpm install --frozen-lockfile"],
  ]) {
    const installs = steps.filter((step) => step.run?.startsWith("pnpm install"));
    assert.equal(installs.length, 1);
    assert.equal(installs[0].run, command);
    assert.ok(steps.indexOf(installs[0]) > steps.indexOf(actionStep(steps, "actions/setup-node")));
    assert.notEqual(installs[0]["continue-on-error"], true);
  }
});

test("turbo and Electron caches retain their paths and keys", () => {
  assert.deepEqual(actionStep(ciSteps, "actions/cache").with, {
    path: "apps/zcode-cli/.turbo",
    key: "turbo-${{ runner.os }}-${{ github.sha }}",
    "restore-keys": "turbo-${{ runner.os }}-",
  });
  assert.deepEqual(actionStep(installerSteps, "actions/cache").with, {
    path: "${{ matrix.electron-cache }}\n${{ matrix.builder-cache }}\n",
    key: "electron-${{ matrix.platform }}-${{ hashFiles('pnpm-lock.yaml') }}",
    "restore-keys": "electron-${{ matrix.platform }}-",
  });
});

test("installer uploads remain named multi-file archives and fail on missing files", () => {
  const upload = actionStep(installerSteps, "actions/upload-artifact");
  assert.equal(upload.with.name, "openzwork-installer-${{ matrix.platform }}");
  assert.equal(upload.with.archive, true);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.notEqual(upload["continue-on-error"], true);
  const extensions = ["dmg", "zip", "exe", "AppImage", "deb", "rpm", "pkg.tar.zst"];
  const expectedPaths = ["*", "**/*"].flatMap((glob) =>
    extensions.map((extension) => `packages/desktop/dist/${glob}.${extension}`),
  );
  assert.deepEqual(upload.with.path.trim().split("\n"), expectedPaths);
});

test("workflow triggers and platform matrices remain unchanged", () => {
  assert.deepEqual(ci.on, { pull_request: null, push: { branches: ["main"] } });
  assert.deepEqual(installers.on, {
    workflow_dispatch: null,
    push: { branches: ["main", "wp**"] },
  });
  for (const job of [ci.jobs.checks, installers.jobs.installer]) {
    assert.equal(job["runs-on"], "${{ matrix.os }}");
    assert.equal(job.strategy["fail-fast"], false);
    assert.deepEqual(
      job.strategy.matrix.include.map(({ os, platform }) => ({ os, platform })),
      [
        { os: "macos-14", platform: "macos-arm64" },
        { os: "windows-latest", platform: "windows-amd64" },
        { os: "ubuntu-latest", platform: "linux-amd64" },
      ],
    );
  }
});

test("CI runs the offline workflow regression tests without suppressing failures", () => {
  const matches = ciSteps.filter((step) => step.run === "node --test tests/ci/*.test.mjs");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].if, undefined);
  assert.notEqual(matches[0]["continue-on-error"], true);
});
