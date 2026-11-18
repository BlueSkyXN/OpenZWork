// OpenZWork 维护门禁：台账、上游文档原文与 OpenZWork 版本登记、经验库与上游文件格式噪声。
// 规则见 docs/openzwork/maintenance-model.md；需要完整 Git 历史（上游基准提交）与已安装的 oxfmt。
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyIdentity,
  runCheck,
} from "../../.agents/skills/openzwork-maintenance/scripts/scan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("夹具家目录下的用户数据库沿用 OpenZWork 根，项目目录保留自己的配置", () => {
  for (const file of ["cli/db/db.sqlite", "v2/tasks-index.sqlite"]) {
    assert.equal(
      applyIdentity(`join(fixture.home, ".zcode/${file}")`),
      `join(fixture.home, ".openzwork/${file}")`,
    );
    const project = `join(workspace, ".zcode/${file}")`;
    assert.equal(applyIdentity(project), project);
  }
});

test("OpenZWork 维护门禁通过", () => {
  const errors = runCheck(root);
  assert.deepEqual(errors, [], `维护门禁未通过（修复方法见各条说明）：\n${errors.join("\n")}`);
});
