# 台账：功能、行为调整、裁剪与保留

`docs/openzwork/ledger.yaml` 记录 OpenZWork 相对上游做了什么、改了哪些文件、依据是什么。字段定义见 `docs/openzwork/maintenance-model.md`。

## 选择条目类型

| 情况                                 | kind      | 编号   |
| ------------------------------------ | --------- | ------ |
| 上游没有、OpenZWork 新增的功能       | `feature` | `OZ-F` |
| 上游已有的功能，OpenZWork 改变了行为 | `change`  | `OZ-C` |
| 上游的功能，OpenZWork 移除           | `drop`    | `OZ-D` |
| 上游后来删除，OpenZWork 继续保留     | `retain`  | `OZ-R` |

缺陷修复不进台账，按下游补丁登记为 `OW-Pxxx`。

## 何时更新

- 新增功能、改变上游行为、裁剪或保留上游功能：在同一个 PR 中新增或修改条目。
- 文件移动或重命名：更新 `paths`、`hooks`、`tests`，否则 `--check` 会报路径不存在。
- 合入上游新版本后：更新 `upstream.version` 与 `upstream.commit`，复核受影响条目的路径。
- 功能下线或改用上游实现：`status` 改为 `retired`，保留记录与 `source`。

## 填写规则

- `paths` 写 OpenZWork 新建的文件或 glob；`drop` 条目写已删除的上游路径，必须不再存在。
- 独立模块优先写 `modules`，引用现有架构模块 ID；扫描器沿用架构的文件归属，不抄一份模块内文件清单。模块外的文件仍写 `paths`。`drop` 的 `modules` 表示裁剪后保留的适配模块，删除路径继续写 `paths`。
- `hooks` 写接线或依赖的上游文件，必须存在。
- `spec` 可写多份；`source` 写 PR、提交或 spec 段落，不写推测。
- 每个 `active` 条目要有核心 CI 中运行的保证，判定规则见 `docs/openzwork/maintenance-model.md`「保证」。`feature`、`change`、`retain` 条目把回归测试写入 `tests`（或 `paths`），并确认该测试已列入 `tests/ci/core-tests.json` 或由 `ci.yml` 点名；`drop` 条目由路径不存在的检查保证，文本残留写入 `gates`。用 `pnpm openzwork:scan --entries` 核对。
- 回归测试的目录、验证层与 CI 登记按同一文档的「保证测试的位置与写法」执行；spec 的验收表列出覆盖文件，界面断言放在界面验收中。
- 确实没有保证时填写 `unguarded`，写明原因与补齐方式；补上保证后删除该字段。
- 发现 spec 与代码矛盾时，把条目设为 `undecided`，在 `summary` 中写清矛盾，交给用户决定。

## 补全存量

执行 `pnpm openzwork:scan --list openzwork --unclaimed`，按功能把 OpenZWork 新增的文件补到对应条目。先引用已有模块，再处理模块之外的文件；门禁要求自有文件有认领，上游基准没有的现存模块有有效条目引用。上游文件只在属于某个功能或行为调整的接线、依赖时写入该条目的 `hooks`，不为提高认领数量逐个登记，也不用大范围 glob 凑数。通过 PR 改动推断归属时，按功能关键词过滤，并排除上游同步 PR 中的无关文件（见经验 `OZK-DIF-007`）。
