import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import { REQUIRED_E2E_CASES, auditRequiredCases } from "../check-e2e-required-cases.mjs";

const execFileAsync = promisify(execFile);
const root = new URL("../../", import.meta.url);
const repoRoot = fileURLToPath(root);
const scriptPath = fileURLToPath(new URL("scripts/check-e2e-required-cases.mjs", root));

function summaryWith(results) {
  return { tests: { results, passed: 0, failed: 0, skipped: 0, total: results.length } };
}

/**
 * 真实报告行形状（wdio 9 + 本仓 reporter）：只有 `it` 标题，且**没有** status 字段。
 * 按真实形态构造，避免门禁靠报告里不存在的字段通过。
 */
function passedCase(required) {
  return { fullTitle: required.title, passed: true };
}

test("OW-P024 目标 E2E 清单覆盖 REVIEW-3 B 的四个场景加本次全局列表场景", () => {
  // 回归 guard：清单本身是本任务与 CI 的合同，误删条目等于悄悄缩小验收范围。
  assert.deepEqual(
    REQUIRED_E2E_CASES.map((item) => item.id),
    ["hub-crud", "runs-error-retry", "stale-refresh", "overview-50", "global-runs-error-retry"],
  );
});

test("目标用例全部通过时判定通过", () => {
  const audit = auditRequiredCases(summaryWith(REQUIRED_E2E_CASES.map(passedCase)));
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.problems, []);
});

test("grep 漏选导致用例缺失时失败（退出码只反映已收集用例）", () => {
  // 这正是 REVIEW-3 B 的实际形态：只有旧 CRUD 被收集，job 却显示成功。
  const collected = [passedCase(REQUIRED_E2E_CASES[0])];
  const audit = auditRequiredCases(summaryWith(collected));
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.missing, [
    "runs-error-retry",
    "stale-refresh",
    "overview-50",
    "global-runs-error-retry",
  ]);
});

test("目标用例被跳过或失败时判定失败", () => {
  const skipped = auditRequiredCases(
    summaryWith([
      ...REQUIRED_E2E_CASES.slice(1).map(passedCase),
      { fullTitle: REQUIRED_E2E_CASES[0].title, passed: true, status: "skipped" },
    ]),
  );
  assert.equal(skipped.ok, false);
  assert.match(skipped.problems.join("\n"), /hub-crud: 被跳过/u);

  const failed = auditRequiredCases(
    summaryWith([
      ...REQUIRED_E2E_CASES.slice(1).map(passedCase),
      { fullTitle: REQUIRED_E2E_CASES[0].title, passed: false, status: "failed", error: "boom" },
    ]),
  );
  assert.equal(failed.ok, false);
  assert.match(failed.problems.join("\n"), /hub-crud: 未通过.*boom/u);
});

test("清单外的用例不参与判定（含既有失败欠账，也含将来新增用例）", () => {
  const audit = auditRequiredCases(
    summaryWith([
      ...REQUIRED_E2E_CASES.map(passedCase),
      // 既有 8 项欠账同款形态：清单外的失败不得影响本任务门禁。
      {
        fullTitle: "全局工作流中枢 E2E 全局组置顶；全局→项目搬文件",
        passed: false,
        status: "failed",
      },
      { fullTitle: "将来新增的场景", passed: true, status: "passed" },
    ]),
  );
  assert.equal(audit.ok, true);
});

test("报告缺失时 CLI 以非零退出（用例没运行不能算通过）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ow-p024-e2e-cases-"));
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, dir], { cwd: repoRoot }),
      (error) => error.code !== 0 && /找不到 E2E 报告/u.test(String(error.stderr)),
    );

    // 只有旧 CRUD 的报告：CLI 必须失败并点名漏选的用例。
    await mkdir(join(dir, "run-1"), { recursive: true });
    await writeFile(
      join(dir, "run-1", "summary.json"),
      JSON.stringify(summaryWith([passedCase(REQUIRED_E2E_CASES[0])])),
      "utf8",
    );
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, dir], { cwd: repoRoot }),
      (error) => error.code !== 0 && /grep 漏选/u.test(String(error.stderr)),
    );

    // 全部通过：CLI 退出 0。
    await mkdir(join(dir, "run-2"), { recursive: true });
    await writeFile(
      join(dir, "run-2", "summary.json"),
      JSON.stringify(summaryWith(REQUIRED_E2E_CASES.map(passedCase))),
      "utf8",
    );
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, dir], { cwd: repoRoot });
    assert.match(stdout, /目标 E2E 全部通过/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("清单里的每个标题都是 spec 里真实存在的 it 标题，且 grep 能选中它所在 describe", async () => {
  const { readFile } = await import("node:fs/promises");
  const spec = await readFile(
    new URL("packages/desktop/test/e2e/automations-workflows-hub.test.ts", root),
    "utf8",
  );
  const grep = (await readFile(new URL(".github/workflows/ci.yml", root), "utf8")).match(
    /ZCODE_E2E_HUB_GREP: "([^"]+)"/u,
  )?.[1];
  assert.ok(grep, "ci.yml 定义 ZCODE_E2E_HUB_GREP");
  const patterns = grep
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const item of REQUIRED_E2E_CASES) {
    // 标题必须逐字出现在 spec 的 it("...") 里——改名后这里立刻红，不会等到 CI 才发现。
    assert.ok(spec.includes(`it("${item.title}"`), `${item.id}: spec 里找不到 it("${item.title}")`);
    // 它所在 describe 必须被 grep 命中，否则该用例不会被收集。
    const describeIndex = spec.indexOf(`describe("${item.describe}"`);
    assert.ok(describeIndex >= 0, `${item.id}: spec 里找不到 describe("${item.describe}")`);
    assert.ok(
      patterns.some((pattern) => item.describe.includes(pattern)),
      `${item.id}: describe "${item.describe}" 不被 grep ${grep} 覆盖`,
    );
    // 该 it 必须属于这个 describe：取 describe 之后、下一个 describe 之前的区间检查。
    const nextDescribe = spec.indexOf("describe(", describeIndex + 10);
    const region = spec.slice(describeIndex, nextDescribe === -1 ? undefined : nextDescribe);
    assert.ok(region.includes(`it("${item.title}"`), `${item.id}: 该 it 不在声明的 describe 内`);
  }
});

test("ci.yml 的 grep 覆盖目标 describe，并保留报告校验步骤", async () => {
  const { readFile } = await import("node:fs/promises");
  const ci = parseDocument(
    await readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
  ).toJS();
  const steps = ci.jobs["desktop-e2e"].steps;
  const run = steps.find((step) => step.id === "hub_e2e");
  assert.ok(run, "desktop-e2e 存在 hub E2E 步骤");
  // grep 变量必须同时覆盖旧 CRUD describe 与 OW-P024 R4 的三个新 describe。
  assert.match(run.env.ZCODE_E2E_HUB_GREP, /已保存工作流中枢 E2E/u);
  assert.match(run.env.ZCODE_E2E_HUB_GREP, /OW-P024 R4/u);
  assert.match(run.run, /--mochaOpts\.grep "\$ZCODE_E2E_HUB_GREP"/u);

  const audit = steps.find((step) => step.run?.includes("check-e2e-required-cases.mjs"));
  assert.ok(audit, "存在按报告核对目标用例的步骤");
  // 失败或漏选时必须能真正让 job 失败：不能 continue-on-error，且要在 E2E 之后仍执行。
  assert.equal(audit["continue-on-error"], undefined);
  assert.match(audit.if, /always\(\)/u);
});
