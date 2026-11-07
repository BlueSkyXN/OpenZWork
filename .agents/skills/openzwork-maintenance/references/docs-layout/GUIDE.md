# 文档与技能布局

## 放在哪里

| 要写的内容                            | 位置                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| OpenZWork 产品 spec                   | `docs/specs/<名称>-openzwork.md`                                          |
| OpenZWork 测试计划                    | `docs/testing/<名称>-openzwork.md`                                        |
| 属于上游某个主题目录的 OpenZWork 文档 | 该目录下的 `<名称>-openzwork.md`                                          |
| 上游整合与验证记录                    | `docs/openzwork/upstream/v<版本>-integration.md`、`v<版本>-validation.md` |
| 下游补丁说明                          | `docs/openzwork/patches/`                                                 |
| 发行流程                              | `docs/openzwork/release/`                                                 |
| CI 与测试基础设施                     | `docs/openzwork/ci/`                                                      |
| 一次性的验收或排查记录                | `docs/openzwork/records/`                                                 |

新建 OpenZWork 文档后，在 `docs/openzwork/README.md` 中加一行索引。

## 上游文档

- 上游原有的文档保持上游原文。
- 要补充 OpenZWork 的行为说明时，新建 `-openzwork` 文档，在其中链接上游文档；不改上游文档。
- 必须修改上游文档时（例如更正指向已移动文件的链接），在 `docs/openzwork/upstream-doc-edits.yaml` 登记路径和 `kind`：`purge` 只删除上游内容，`identity` 只改用户级根，`content` 增补或改写内容。
- 恢复为上游原文后，删除对应登记。`pnpm openzwork:scan --check` 会检查登记与实际是否一致。
- 不对上游文档运行格式化。

## 技能

- `.agents/skills/` 下的上游技能保持上游原文；对它们的必要修改同样登记在 `upstream-doc-edits.yaml`。
- OpenZWork 专用的维护方法放进本技能：新的子能力加到 `references/<名称>/GUIDE.md`，并在 `SKILL.md` 的路由表中加一行。
- 新建独立的 OpenZWork 技能前，先确认无法作为本技能的子能力；新建后在台账中登记为 `feature` 条目。
- 用户全局 Git 忽略规则可能包含 `.agents/`，新增文件需要用 `git add -f` 加入。
