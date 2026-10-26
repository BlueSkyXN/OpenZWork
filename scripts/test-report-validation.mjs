// 发布与分片汇总共用的纯报告校验，不导入应用或桌面打包代码。
import assert from "node:assert/strict";
import { FULL_SUITE_GROUPS } from "./full-suite-plan.mjs";

const groups = FULL_SUITE_GROUPS.map((group) => group.name);

export function validateTests(report) {
  assert.equal(report.success, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numFailedTestSuites, 0);
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0);
  assert.ok(report.numTotalTests > 0);
  let passed = 0,
    skipped = 0;
  for (const file of report.testResults) {
    assert.equal(file.status, "passed", file.name);
    for (const test of file.assertionResults) {
      if (test.status === "passed") passed++;
      else {
        assert.ok(["skipped", "pending", "todo", "disabled"].includes(test.status), test.fullName);
        skipped++;
      }
    }
  }
  assert.equal(passed, report.numPassedTests);
  assert.equal(passed + skipped, report.numTotalTests);
  return { files: report.testResults.length, passed, skipped, failed: 0 };
}

export function validateSummary(summary) {
  assert.equal(summary.anyFailed, false);
  assert.equal(summary.groups.length, groups.length);
  assert.deepEqual(summary.groups.map((group) => group.group).sort(), [...groups].sort());
  for (const group of summary.groups) {
    assert.equal(group.status, "passed");
    assert.equal(group.exit, 0);
  }
}
