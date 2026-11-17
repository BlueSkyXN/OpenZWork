import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyE2ESummary } from "../verify-e2e-summary.mjs";

const exec = promisify(execFile);
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");

const WT04_SPEC = "./test/e2e/git/worktrees/manual-review/pending/git-worktree-remote-view.test.ts";

function result(file, fullTitle, { passed = true, status = "passed" } = {}) {
  return {
    capturedAt: "2026-11-16T00:00:00.000Z",
    file,
    fullTitle,
    title: fullTitle,
    passed,
    status,
    durationMs: 1,
  };
}

/** 真实 WT04 报告结构的最小副本：passRate 由非 skip 结果计算，skip 不计入分母。 */
function summary({ results, exitCode = 0 }) {
  const skipped = results.filter((entry) => entry.status === "skipped");
  const counted = results.filter((entry) => entry.status !== "skipped");
  const passed = counted.filter((entry) => entry.passed).length;
  const failed = counted.filter((entry) => !entry.passed).length;
  return {
    exitCode,
    requestedSpecs: [WT04_SPEC],
    runId: "desktop-e2e-20261116-000000-000",
    stability: {
      passRate: counted.length ? passed / counted.length : 0,
      infraFailureCount: 0,
      flakyCount: 0,
    },
    tests: { passed, failed, skipped: skipped.length, total: results.length, results },
  };
}

const REQUIRED = [{ spec: WT04_SPEC, cases: ["WT04-1", "WT04-2"] }];

test("H5 反例：WT04-1 通过 + WT04-2 skip 时 passRate=1 仍必须被拒绝", () => {
  const report = verifyE2ESummary({
    summary: summary({
      results: [
        result(WT04_SPEC, "WT04-1: worktree 任务冷恢复后仍归属原项目 workspace", {
          passed: true,
        }),
        result(WT04_SPEC, "WT04-2: 手机查看 worktree 任务复用原 Host", {
          passed: false,
          status: "skipped",
        }),
      ],
    }),
    required: REQUIRED,
  });
  assert.equal(report.ok, false);
  const joined = report.failures.join("\n");
  assert.match(joined, /skipped=1/);
  assert.match(joined, /WT04-2/);
  assert.match(joined, /missing required case/);
});

test("H5：全部必需 case 通过时放行，并记录覆盖明细", () => {
  const report = verifyE2ESummary({
    summary: summary({
      results: [
        result(WT04_SPEC, "WT04-1: worktree 任务冷恢复后仍归属原项目 workspace"),
        result(WT04_SPEC, "WT04-2: 手机查看 worktree 任务复用原 Host"),
      ],
    }),
    required: REQUIRED,
  });
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.coverage.length, 1);
  assert.equal(report.coverage[0].collected, 2);
  assert.equal(report.coverage[0].passed, 2);
  assert.deepEqual(report.coverage[0].missingCases, []);
});

test("H5：缺报告、0 collected、缺 spec、失败、非零退出码都拒绝", () => {
  const cases = [
    {
      name: "0 collected",
      summary: summary({ results: [] }),
      expect: /0 collected tests/,
    },
    {
      name: "spec never ran",
      summary: summary({
        results: [result("./test/e2e/other.test.ts", "WT04-1: unrelated")],
      }),
      expect: /0 collected \(spec did not run\)/,
    },
    {
      name: "failed case",
      summary: summary({
        results: [
          result(WT04_SPEC, "WT04-1: a"),
          result(WT04_SPEC, "WT04-2: b", { passed: false, status: "failed" }),
        ],
      }),
      expect: /failed=1/,
    },
    {
      name: "non-zero exit",
      summary: summary({
        results: [result(WT04_SPEC, "WT04-1: a"), result(WT04_SPEC, "WT04-2: b")],
        exitCode: 1,
      }),
      expect: /exitCode=1/,
    },
  ];
  for (const entry of cases) {
    const report = verifyE2ESummary({ summary: entry.summary, required: REQUIRED });
    assert.equal(report.ok, false, entry.name);
    assert.match(report.failures.join("\n"), entry.expect, entry.name);
  }
  // 缺报告 = 结构缺失：没有 tests.results 时同样拒绝。
  const missing = verifyE2ESummary({ summary: {}, required: REQUIRED });
  assert.equal(missing.ok, false);
  assert.match(missing.failures.join("\n"), /0 collected tests/);
});

test("H5：报告自报 requestedSpecs 不能替代实际收集的 case", () => {
  // 报告声称请求了 WT04 两个 case，但只收集到 WT04-1：旧实现只核 spec 文件名会放行。
  const report = verifyE2ESummary({
    summary: summary({ results: [result(WT04_SPEC, "WT04-1: a")] }),
    required: REQUIRED,
  });
  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /missing required case\(s\): WT04-2/);
});

test("H5：CLI 直接执行真实校验逻辑并以非零退出码拒绝 skip 报告", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "verify-e2e-summary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const skipped = join(dir, "skipped.json");
  await writeFile(
    skipped,
    JSON.stringify(
      summary({
        results: [
          result(WT04_SPEC, "WT04-1: a"),
          result(WT04_SPEC, "WT04-2: b", { passed: false, status: "skipped" }),
        ],
      }),
    ),
  );
  const okFile = join(dir, "ok.json");
  await writeFile(
    okFile,
    JSON.stringify(
      summary({
        results: [result(WT04_SPEC, "WT04-1: a"), result(WT04_SPEC, "WT04-2: b")],
      }),
    ),
  );
  const requireFile = join(dir, "require.json");
  await writeFile(requireFile, JSON.stringify({ specs: REQUIRED }));
  const script = join(repoRoot, "scripts/verify-e2e-summary.mjs");

  await assert.rejects(
    exec(process.execPath, [script, "--summary", skipped, "--require-file", requireFile]),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /E2E summary incomplete/);
      return true;
    },
  );
  const ok = await exec(process.execPath, [
    script,
    "--summary",
    okFile,
    "--require-file",
    requireFile,
  ]);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.coverage[0].passed, 2);
});

test("H5：CI 的 E2E job 逐个点名必需 spec 与 case，并复用同一校验实现", async () => {
  const yaml = await import("yaml");
  const workflow = yaml.parse(await readFile(join(repoRoot, ".github/workflows/ci.yml"), "utf8"));
  const job = workflow.jobs["desktop-e2e"];
  const entries = job.strategy.matrix.include;
  // 2026-11-17 J3 修正：不硬编码条目数（V1 加 BD 组时此断言已过期失败）；
  // 逐条形态断言由 tests/ci/actions-runtime.test.mjs 承担，这里只保证清单结构可用。
  assert.ok(entries.length >= 2);
  for (const entry of entries) {
    assert.ok(entry.specs, `${entry["spec-group"]}: named spec`);
    assert.doesNotMatch(entry.specs, /\*/u, `${entry["spec-group"]}: no glob`);
    const cases = JSON.parse(entry["required-cases"]);
    assert.ok(Array.isArray(cases) && cases.length > 0, `${entry["spec-group"]}: required cases`);
  }
  const step = job.steps.find((candidate) => candidate.name === "Verify E2E summary completeness");
  assert.ok(step, "completeness step exists");
  assert.notEqual(step["continue-on-error"], true);
  // 校验逻辑来自真实模块，不是 YAML 里的内联复制。
  assert.match(step.run, /scripts\/verify-e2e-summary\.mjs/);
  assert.match(step.run, /verifyE2ESummary/);
  assert.doesNotMatch(step.run, /passRate !== 1\) failures\.push/);
});

// 2026-11-17 J3：BD 逐 spec 归属回归。旧 ci.yml 把 5 个 spec 折叠成一个带引号的
// --spec 参数（0 匹配）并把全组 case 挂到逗号切分出的单个 spec 上；判定实现本身
// 一直按 spec 归属核销——这里固定该合同，防止汇总侧再出现「跨 spec 顶账」。
test("J3：逐 spec 归属——A spec 的 case 不能由 B spec 的结果顶账", () => {
  const specA = "./test/e2e/browser/design/browser-design-mode.test.ts";
  const specB = "./test/e2e/browser/files/browser-local-html-preview.test.ts";
  const required = [
    { spec: specA, cases: ["设计工具随页面出现"] },
    { spec: specB, cases: ["真实浏览器入口加载相对资源"] },
  ];
  // 只有 B 跑了且通过：A 的必需 case 缺失 + A 0 collected，必须拒绝。
  const report = verifyE2ESummary({
    summary: summary({
      results: [result(specB, "真实浏览器入口加载相对资源，同时拒绝越界文件并支持刷新和后退")],
    }),
    required,
  });
  assert.equal(report.ok, false);
  const joined = report.failures.join("\n");
  assert.match(joined, /browser-design-mode\.test\.ts: 0 collected/);
  assert.match(joined, /missing required case/);
  const coverageB = report.coverage.find((entry) =>
    entry.spec.includes("browser-local-html-preview"),
  );
  assert.equal(coverageB.missingCases.length, 0);
});

test("J3：BD 五 spec 各自全部必需 case 通过时放行（12 case 形态）", () => {
  const groups = [
    ["./test/e2e/browser/design/browser-design-mode.test.ts", 7],
    ["./test/e2e/browser/design/browser-design-page-tools.test.ts", 1],
    ["./test/e2e/browser/design/browser-capture-guest-timeout.test.ts", 2],
    ["./test/e2e/browser/design/browser-design-mode-cross-session.test.ts", 1],
    ["./test/e2e/browser/files/browser-local-html-preview.test.ts", 1],
  ];
  const results = [];
  const required = groups.map(([spec, count]) => {
    const cases = Array.from({ length: count }, (_, index) => `case-${index}`);
    for (const title of cases) results.push(result(spec, title));
    return { spec, cases };
  });
  const report = verifyE2ESummary({ summary: summary({ results }), required });
  assert.equal(report.ok, true, report.failures.join("; "));
  assert.equal(report.coverage.length, 5);
});
