// OpenZWork 维护门禁：台账、上游文档编辑登记、经验库与上游文件格式噪声。
// 规则见 docs/openzwork/maintenance-model.md；需要完整 Git 历史（上游基准提交）与已安装的 oxfmt。
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../.agents/skills/openzwork-maintenance/scripts/scan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("OpenZWork 维护门禁通过", () => {
  const errors = runCheck(root);
  assert.deepEqual(errors, [], `维护门禁未通过（修复方法见各条说明）：\n${errors.join("\n")}`);
});
