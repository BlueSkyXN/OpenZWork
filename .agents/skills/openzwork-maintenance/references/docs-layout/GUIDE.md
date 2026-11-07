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

- 上游原有的文档原文不动，包括格式。
- OpenZWork 需要不同内容时，复制上游文档到同目录的 `<名称>-openzwork<扩展名>`（`foo.md` → `foo-openzwork.md`），在副本中修改，并登记到 `docs/openzwork/upstream-doc-variants.yaml`：`upstream`、`variant`、`kind`（`purge` 删除上游内容，`identity` 只改用户级根，`content` 增补或改写内容）、`upstreamBlob`（`git rev-parse <基准>:<上游路径>`）。
- 已有 OpenZWork 版本的文档，后续修改都写在 OpenZWork 版本中。
- 只补充 OpenZWork 独有的说明、不需要上游内容时，写独立的 `-openzwork` 文档或放进 `docs/openzwork/`，不登记为版本。
- 合入上游后原文变化，`--check` 会提示复核：按新原文更新 OpenZWork 版本，再更新 `upstreamBlob`；上游删除了原文时，决定保留（改为独立文档并删除登记）或一并删除。

## 技能

- `.agents/skills/` 下的上游技能原文不动；文档类文件（`SKILL.md`、references 中的 md、yaml）的 OpenZWork 版本同样另存为 `-openzwork` 并登记。技能中的脚本属于代码，按 `code-boundary` 原地修改。
- OpenZWork 专用的维护方法放进本技能：新的子能力加到 `references/<名称>/GUIDE.md`，并在 `SKILL.md` 的路由表中加一行。
- 新建独立的 OpenZWork 技能前，先确认无法作为本技能的子能力；新建后在台账中登记为 `feature` 条目。
- 用户全局 Git 忽略规则可能包含 `.agents/`，新增文件需要用 `git add -f` 加入。
