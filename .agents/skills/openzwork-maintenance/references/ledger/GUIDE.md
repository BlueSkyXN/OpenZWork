# 台账：功能、行为调整、裁剪与保留

`docs/openzwork/ledger.yaml` 记录 OpenZWork 相对上游做了什么、改了哪些文件、依据是什么。字段定义见 `docs/openzwork/maintenance-model.md`。

## 选择条目类型

| 情况 | kind | 编号 |
| --- | --- | --- |
| 上游没有、OpenZWork 新增的功能 | `feature` | `OZ-F` |
| 上游已有的功能，OpenZWork 改变了行为 | `change` | `OZ-C` |
| 上游的功能，OpenZWork 移除 | `drop` | `OZ-D` |
| 上游后来删除，OpenZWork 继续保留 | `retain` | `OZ-R` |

缺陷修复不进台账，按下游补丁登记为 `OW-Pxxx`。

## 何时更新

- 新增功能、改变上游行为、裁剪或保留上游功能：在同一个 PR 中新增或修改条目。
- 文件移动或重命名：更新 `paths`、`hooks`、`tests`，否则 `--check` 会报路径不存在。
- 合入上游新版本后：更新 `upstream.version` 与 `upstream.commit`，复核受影响条目的路径。
- 功能下线或改用上游实现：`status` 改为 `retired`，保留记录与 `source`。

## 填写规则

- `paths` 写 OpenZWork 新建的文件或 glob；`drop` 条目写已删除的上游路径，必须不再存在。
- `hooks` 写接线或依赖的上游文件，必须存在。
- `spec` 可写多份；`source` 写 PR、提交或 spec 段落，不写推测。
- 发现 spec 与代码矛盾时，把条目设为 `undecided`，在 `summary` 中写清矛盾，交给用户决定。

## 补全存量

执行 `pnpm openzwork:scan --list openzwork --unclaimed` 与 `--list upstream-modified --unclaimed`，按功能把文件补到对应条目。通过 PR 改动推断归属时，按功能关键词过滤，并排除上游同步 PR 中的无关文件（见经验 `OZK-DIF-007`）。
