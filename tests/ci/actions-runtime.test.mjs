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
  ["Interactive E2E", ci.jobs["desktop-e2e"].steps],
  ["Agent node dist", installers.jobs["agent-node-dist"].steps],
]) {
  test(`${name} uses the reviewed Node.js 24 Action releases`, () => {
    const actions = steps.filter((step) => step.uses);
    assert.equal(
      actions.length,
      name === "Extended tests" ? 6 : ["Interactive E2E", "Agent node dist"].includes(name) ? 4 : 5,
    );
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
    [ci.jobs["desktop-e2e"].steps, "pnpm install --frozen-lockfile"],
    [installers.jobs["agent-node-dist"].steps, "pnpm install --frozen-lockfile"],
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
  expectedPaths.push("packages/desktop/dist/PREVIEW-MANIFEST.json");
  expectedPaths.push("packages/desktop/dist/BUILD-MANIFEST.json");
  expectedPaths.push("packages/desktop/dist/VERSION-VERIFICATION.json");
  expectedPaths.push("packages/desktop/dist/PK01-REPORT.json");
  assert.deepEqual(upload.with.path.trim().split("\n"), expectedPaths);
});

test("workflow triggers preserve build matrices and expose explicit cloud publishing inputs", () => {
  // 2026-10-20：核心工作流补 workflow_dispatch——stack 上层分支 push 不产生
  // pull_request 事件时可手动派发验证（与 Extended checks 对齐）；矩阵与 push 范围不变。
  assert.deepEqual(ci.on, {
    pull_request: null,
    push: { branches: ["main"], tags: ["v*-openzwork", "v*openzwork.*"] },
    // 2026-11-15：交互 E2E 云验收入口——仅显式 dispatch 触发，不进 PR 自动门禁。
    workflow_dispatch: {
      inputs: {
        desktop_e2e: {
          description:
            "Also run the interactive desktop E2E job (real Electron/Host/CLI, controlled replay)",
          type: "boolean",
          default: false,
        },
      },
    },
  });
  assert.deepEqual(installers.on, {
    workflow_dispatch: {
      inputs: {
        source_commit: {
          description:
            "Immutable source commit for dispatch builds (empty uses the event commit; never a floating branch head)",
          type: "string",
          default: "",
        },
        build_production: {
          description:
            "Build unsigned production installers from source_commit without publishing (no tag, no release)",
          type: "boolean",
          default: false,
        },
        release_tag: {
          description: "Existing formal OpenZWork tag for a production installer",
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
        zcode_dist_base_url: {
          description:
            "Download base URL embedded in the independent Node dist install script (build:zcode)",
          type: "string",
          default: "https://example.invalid/zcode/deps/zcode/",
        },
      },
    },
    push: { branches: ["main", "wp**"], tags: ["v*-openzwork", "v*openzwork.*"] },
  });
  for (const job of [ci.jobs.checks, installers.jobs.installer]) {
    assert.equal(job["runs-on"], "${{ matrix.os }}");
    assert.equal(job.strategy["fail-fast"], false);
    assert.deepEqual(
      job.strategy.matrix.include.map(({ os, platform }) => ({ os, platform })),
      [
        { os: "macos-15", platform: "macos-arm64" },
        { os: "windows-latest", platform: "windows-amd64" },
        { os: "ubuntu-latest", platform: "linux-amd64" },
      ],
    );
  }
});

test("CI runs the offline workflow regression tests without suppressing failures", () => {
  const matches = ciSteps.filter((step) => step.run === "node --test tests/ci/*.test.mjs");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].if, "matrix.lane == 'regressions'");
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

// 交互 E2E 云验收入口（2026-11-15）：spec 与回放 fixture 必须逐个点名（依赖文件名注入
// fixture 的 spec 不允许 glob 跑法），pending 用例只显式候选执行，结果完整性不得靠
// 退出码单点——summary 复核步骤是 job 的一部分。
test("interactive E2E job names every spec and fixture and re-verifies the run summary", () => {
  const job = ci.jobs["desktop-e2e"];
  assert.equal(job["runs-on"], "macos-15");
  assert.equal(job["timeout-minutes"] >= 30, true);
  assert.equal(job.if, "github.event_name == 'workflow_dispatch' && inputs.desktop_e2e");
  const include = job.strategy.matrix.include;
  assert.equal(job.strategy["fail-fast"], false);
  const byGroup = new Map(include.map((entry) => [entry["spec-group"], entry]));
  // WT04：manual-review/pending 用例显式候选执行 + 显式回放 fixture（common + git 领域）。
  const wt04 = byGroup.get("wt04-remote-view");
  assert.equal(
    wt04.specs,
    "./test/e2e/git/worktrees/manual-review/pending/git-worktree-remote-view.test.ts",
  );
  assert.equal(
    wt04["replay-fixtures"],
    "packages/desktop/test/e2e/fixtures/upstream/common.json,packages/desktop/test/e2e/fixtures/upstream/git/managed-worktree.json",
  );
  const git = job.steps.find((step) => step.name === "Resolve Git for the worktree scenario");
  assert.equal(git?.if, "matrix.spec-group == 'wt04-remote-view'");
  assert.match(git.run, /command -v git/);
  assert.match(git.run, /ZCODE_GIT_BINARY=.*GITHUB_ENV/);
  const identity = byGroup.get("identity-isolation");
  assert.equal(
    identity.specs,
    "./test/e2e/git/worktrees/task-index-workspace-identity-isolation.test.ts",
  );
  // BD（2026-11-17 J3 逐 spec 重构）：5 spec 各自成组、共 12 必需 case（含 design-mode
  // 的「再点一次「选择元素」退出点选…」——旧 11 条清单漏列该 case）。
  const bdGroups = [
    ["bd-design-mode", "./test/e2e/browser/design/browser-design-mode.test.ts", 7],
    ["bd-design-page-tools", "./test/e2e/browser/design/browser-design-page-tools.test.ts", 1],
    [
      "bd-capture-guest-timeout",
      "./test/e2e/browser/design/browser-capture-guest-timeout.test.ts",
      2,
    ],
    [
      "bd-design-cross-session",
      "./test/e2e/browser/design/browser-design-mode-cross-session.test.ts",
      1,
    ],
    ["bd-local-html-preview", "./test/e2e/browser/files/browser-local-html-preview.test.ts", 1],
  ];
  for (const [group, spec, caseCount] of bdGroups) {
    const entry = byGroup.get(group);
    assert.ok(entry, `matrix missing ${group}`);
    assert.equal(entry.specs, spec);
    assert.equal(JSON.parse(entry["required-cases"]).length, caseCount, `${group}: case count`);
  }
  const crossSessionFixture =
    "packages/desktop/test/e2e/fixtures/upstream/browser/browser-design-mode-cross-session.json";
  assert.equal(byGroup.get("bd-design-cross-session")["replay-fixtures"], crossSessionFixture);
  assert.equal(byGroup.has("bd-design-and-local-html"), false, "旧折叠多 spec 组必须已移除");
  for (const entry of include) {
    // wdio CLI 的 --spec 每次接收一个文件路径（--help 示例：--spec a.js --spec b.js）；
    // 折叠多行/逗号/空白拼接的字符串会被当成单个带引号参数而 0 匹配（2026-11-17 J3
    // 反例）。每条矩阵条目必须是单个已存在的 spec 文件、无 glob。
    assert.match(
      entry.specs,
      /^\.\/test\/e2e\/[\w./-]+\.test\.ts$/u,
      `${entry["spec-group"]}: single spec path`,
    );
    assert.equal(
      /\s|,|\*/u.test(entry.specs),
      false,
      `${entry["spec-group"]}: no folded/glob specs`,
    );
  }
  const run = job.steps.find((step) => step.name === "Run interactive E2E specs");
  assert.equal(run.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH, "${{ matrix.replay-fixtures }}");
  assert.match(run.env.ZCODE_E2E_HOME_DIR, /^\$\{\{ runner\.temp \}\}\/\.e2e-home-/u);
  assert.notEqual(run["continue-on-error"], true);
  // 必需 case 清单逐个点名：完整性门禁按它核销，报告自报 requestedSpecs 不作依据。
  for (const entry of include) {
    const cases = JSON.parse(entry["required-cases"]);
    assert.ok(Array.isArray(cases) && cases.length > 0, `${entry["spec-group"]}: required cases`);
  }
  const verify = job.steps.find((step) => step.name === "Verify E2E summary completeness");
  assert.ok(verify, "summary completeness verification step exists");
  // 判定逻辑在 scripts/verify-e2e-summary.mjs（其行为由 scripts/test 覆盖），
  // 步骤只负责定位报告、传必需清单并复用同一实现；不能再内联一份判据。
  assert.match(verify.run, /scripts\/verify-e2e-summary\.mjs/);
  assert.match(verify.run, /verifyE2ESummary/);
  assert.match(verify.env.REQUIRED_SPECS, /matrix\.specs/);
  assert.match(verify.env.REQUIRED_CASES, /matrix\.required-cases/);
  assert.notEqual(verify["continue-on-error"], true);
  for (const e2e of [job, ci.jobs["workflows-hub-e2e"]]) {
    const upload = e2e.steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
    assert.equal(upload.with.path, "packages/desktop/.e2e-artifacts/desktop-e2e-*/");
    assert.equal(upload.with["include-hidden-files"], true);
    assert.equal(upload.with["if-no-files-found"], "error");
  }
});

async function loadCi() {
  const workflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  return parseDocument(workflow).toJS();
}

test("interactive E2E matrix required-cases cross-check real spec it() titles (both directions)", async () => {
  // 2026-11-17 J3：旧 BD 组 11 条清单漏列 design-mode 的「退出点选」用例（实际 12 case）。
  // 本测试把每条矩阵的 required-cases 与 spec 文件的真实 it() 标题双向核对：
  // 任一必需 case 匹配不到真实标题（写错/改名未同步），或任一真实标题没被任何必需 case
  // 覆盖（漏列），都在 CI 结构层失败——完整性门禁不靠清单自洽。
  const ci = await loadCi();
  const include = ci.jobs["desktop-e2e"].strategy.matrix.include;
  for (const entry of include) {
    const specPath = new URL(
      `../../packages/desktop/${entry.specs.replace(/^\.\//u, "")}`,
      import.meta.url,
    );
    const source = await readFile(specPath, "utf8");
    const titles = [
      ...source.matchAll(/\bit(?:\.[a-zA-Z]+)?\(\s*(["'])((?:\\.|(?!\1).)*)\1/gu),
    ].map((match) => match[2]);
    assert.ok(titles.length > 0, `${entry["spec-group"]}: no it() titles parsed`);
    // 模板字符串生成的用例（如 MRO04 的 `MRO04-${width}: …` 循环）无法静态枚举标题：
    // 这类 spec 的 required→真实标题方向由实际 run 的 verifyE2ESummary 核销
    //（rm01-web-remote-recovery 已有 10/10 run 证据），静态侧只保留字面标题方向。
    const hasDynamicTitles = /\bit(?:\.[a-zA-Z]+)?\(\s*`/u.test(source);
    const cases = JSON.parse(entry["required-cases"]);
    for (const required of cases) {
      assert.ok(
        hasDynamicTitles || titles.some((title) => title.includes(required)),
        `${entry["spec-group"]}: required case matches no it() title: ${required}`,
      );
    }
    for (const title of titles) {
      assert.ok(
        cases.some((required) => title.includes(required)),
        `${entry["spec-group"]}: it() title not covered by required-cases: ${title}`,
      );
    }
  }
});
