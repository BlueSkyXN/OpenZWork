import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
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
  ["ci.yml", "installers.yml", "extended-checks.yml"].map(async (name) => {
    const source = await readFile(new URL(`.github/workflows/${name}`, root), "utf8");
    const document = parseDocument(source);
    assert.deepEqual(document.errors, [], `${name}: valid YAML`);
    return document.toJS();
  }),
);
const [ci, installers, extended] = workflows;
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
  ["Extended tests", extended.jobs["historical-tests"].steps],
  ["Main audit", extended.jobs["desktop-main-audit"].steps],
]) {
  test(`${name} uses the reviewed Node.js 24 Action releases`, () => {
    const actions = steps.filter((step) => step.uses);
    assert.equal(actions.length, 5);
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
    assert.deepEqual(actionStep(steps, "pnpm/action-setup").with, {
      version: "11.28.6",
    });
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
    [extended.jobs["historical-tests"].steps, "pnpm install --frozen-lockfile"],
    [extended.jobs["desktop-main-audit"].steps, "pnpm install --frozen-lockfile --ignore-scripts"],
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
  expectedPaths.push("packages/desktop/dist/RELEASE-MANIFEST.json");
  assert.deepEqual(upload.with.path.trim().split("\n"), expectedPaths);
});

test("workflow triggers preserve build matrices and expose explicit cloud publishing inputs", () => {
  // 2026-10-20：核心工作流补 workflow_dispatch——stack 上层分支 push 不产生
  // pull_request 事件时可手动派发验证（与 Extended checks 对齐）；矩阵与 push 范围不变。
  assert.deepEqual(ci.on, {
    pull_request: null,
    push: { branches: ["main"], tags: ["v*-openzwork"] },
    workflow_dispatch: null,
  });
  assert.deepEqual(installers.on, {
    workflow_dispatch: {
      inputs: {
        release_tag: {
          description: "Existing v<version>-openzwork tag for a production installer",
          type: "string",
          default: "",
        },
        release_commit: {
          description: "Expected full source commit SHA of the release tag",
          type: "string",
          default: "",
        },
        publish_installer_run: {
          description:
            "Publish existing production artifacts from this successful run (empty builds installers)",
          type: "string",
          default: "",
        },
        core_run: {
          description: "Successful CI run for the exact release commit",
          type: "string",
          default: "",
        },
        extended_run: {
          description: "Successful complete Extended run for the exact release commit",
          type: "string",
          default: "",
        },
        release_notes: {
          description: "Markdown release notes for publishing the reviewed draft",
          type: "string",
          default: "",
        },
      },
    },
    push: { branches: ["main", "wp**"], tags: ["v*-openzwork"] },
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

function linuxToolchainStep(name) {
  const matches = installerSteps.filter((step) => step.name === name);
  assert.equal(matches.length, 1, `${name}: exactly one step`);
  return matches[0];
}

const linuxPackagingTools = ["rpmbuild", "zstd", "bsdtar"];

test("Linux packaging declares the complete rpm and pacman toolchain before installing dependencies", () => {
  const install = linuxToolchainStep("Install Linux packaging toolchain");
  assert.equal(install.if, "runner.os == 'Linux'");
  assert.equal(
    install.run,
    "sudo apt-get update && sudo apt-get install -y rpm zstd libarchive-tools",
  );
  assert.notEqual(install["continue-on-error"], true);
  const dependencies = installerSteps.find((step) => step.run === "pnpm install --frozen-lockfile");
  assert.ok(installerSteps.indexOf(install) < installerSteps.indexOf(dependencies));
});

test("Linux packaging verifies tool commands immediately after installation with strict Bash", () => {
  const install = linuxToolchainStep("Install Linux packaging toolchain");
  const verify = linuxToolchainStep("Verify Linux packaging toolchain");
  assert.equal(verify.if, "runner.os == 'Linux'");
  assert.equal(verify.shell, "bash");
  assert.notEqual(verify["continue-on-error"], true);
  assert.equal(installerSteps.indexOf(verify), installerSteps.indexOf(install) + 1);
  assert.deepEqual(verify.run.trim().split("\n"), [
    "set -euo pipefail",
    ...linuxPackagingTools.map((tool) => `${tool} --version`),
  ]);
});

const execute = promisify(execFile);

async function runLinuxToolchainProbe({ missing, failing } = {}) {
  const verify = linuxToolchainStep("Verify Linux packaging toolchain");
  const fixture = await mkdtemp(join(tmpdir(), "ozw-linux-toolchain-"));
  try {
    const bin = join(fixture, "bin");
    await mkdir(bin);
    for (const tool of linuxPackagingTools) {
      if (tool === missing) continue;
      const script = `#!/bin/bash\nprintf '%s\\n' '${tool} fixture'\nexit ${tool === failing ? 17 : 0}\n`;
      await writeFile(join(bin, tool), script, { mode: 0o755 });
    }
    return await execute(
      "/bin/bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", verify.run],
      {
        env: { PATH: bin, HOME: fixture, LANG: "C" },
      },
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

test(
  "Linux toolchain preflight executes every declared tool when available",
  { skip: process.platform === "win32" },
  async () => {
    const result = await runLinuxToolchainProbe();
    assert.deepEqual(
      result.stdout.trim().split("\n"),
      linuxPackagingTools.map((tool) => `${tool} fixture`),
    );
  },
);

for (const [index, tool] of linuxPackagingTools.entries()) {
  test(
    `Linux toolchain preflight fails immediately when ${tool} is missing`,
    { skip: process.platform === "win32" },
    async () => {
      await assert.rejects(runLinuxToolchainProbe({ missing: tool }), (error) => {
        assert.equal(error.code, 127);
        assert.ok(error.stderr.includes(`${tool}: command not found`));
        for (const laterTool of linuxPackagingTools.slice(index + 1)) {
          assert.ok(!error.stdout.includes(`${laterTool} fixture`));
        }
        return true;
      });
    },
  );

  test(
    `Linux toolchain preflight preserves ${tool} failure instead of continuing`,
    { skip: process.platform === "win32" },
    async () => {
      await assert.rejects(runLinuxToolchainProbe({ failing: tool }), (error) => {
        assert.equal(error.code, 17);
        assert.ok(error.stdout.includes(`${tool} fixture`));
        for (const laterTool of linuxPackagingTools.slice(index + 1)) {
          assert.ok(!error.stdout.includes(`${laterTool} fixture`));
        }
        return true;
      });
    },
  );
}

test("architecture checks compare the actual PR base with available Git history", () => {
  assert.equal(actionStep(ciSteps, "actions/checkout").with["fetch-depth"], 0);
  const check = ciSteps.find((step) => step.name === "Architecture boundaries");
  assert.equal(
    check.env.ARCHITECTURE_BASE,
    "${{ github.event.pull_request.base.sha || (github.ref_type == 'branch' && github.event.before != '0000000000000000000000000000000000000000' && github.event.before) || '' }}",
  );
  assert.notEqual(check["continue-on-error"], true);
});
