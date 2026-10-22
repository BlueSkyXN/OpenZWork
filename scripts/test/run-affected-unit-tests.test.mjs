import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectDefaultBranchRef } from "../affected-unit-test-baseline.mjs";

test("prefers origin/staging as the default affected-test baseline", () => {
  const availableRefs = new Set(["origin/staging", "origin/main"]);

  const selected = selectDefaultBranchRef({
    originHead: "origin/main",
    hasCommit: (ref) => availableRefs.has(ref),
  });

  assert.equal(selected, "origin/staging");
});

test("deleting a test file skips the full-suite fallback", async () => {
  const runnerSource = await readFile(
    new URL("../run-affected-unit-tests.mjs", import.meta.url),
    "utf8",
  );

  // 删除测试文件不减少任何现存用例的覆盖；只有删除实现/工具等代码文件才必须
  // 全量兜底。断言该分支顺序：先判 isRootUnitTestFile 再决定是否回退全量。
  assert.match(runnerSource, /!isRootUnitTestFile\(deletedCodeFile\)/u);
  assert.match(runnerSource, /跳过全量兜底/u);
});

test("does not force a full unit run based on changed file names", async () => {
  const runnerSource = await readFile(
    new URL("../run-affected-unit-tests.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(runnerSource, /isFullRunTrigger/u);
});
