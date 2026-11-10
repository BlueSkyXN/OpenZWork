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
- 读上游文档时，按 `docs/openzwork/README.md` 的「与上游的差异」理解 OpenZWork 的实际情况；同目录有 `-openzwork` 版本的，以该版本为准，修改也写在该版本中。
- 要写 OpenZWork 的内容时，写进 OpenZWork 自己的文档（产品 spec、`docs/openzwork/`），不复制上游文档。改变了上游行为的，在台账条目中登记，并让「与上游的差异」包含它。
- 只有三种情况才新建 OpenZWork 版本：代码要读取该文档（`role: tool`），OpenZWork 的规则或 spec 以它为准（`role: rule`），或 OpenZWork 需要整份改写并持续维护（`role: maintained`）。做法：复制上游文档到同目录的 `<名称>-openzwork<扩展名>`，在副本中修改，登记到 `docs/openzwork/upstream-doc-variants.yaml`（`role`；`tool`、`rule` 填写 `usedBy`；`kind`；`upstreamBlob` 用 `git rev-parse <基准>:<上游路径>`）。
- 新建 OpenZWork 版本后，把 OpenZWork 文档中指向该上游文档的链接改为指向新版本，`--check` 会列出遗漏的链接。上游文档之间的链接保持原样。
- OpenZWork 版本没有对应内容、需要引用上游原文时，链接文字以「上游」开头（如 `[上游远控架构：后台恢复](…)`），读者能看出打开的是上游文本。删除 OpenZWork 版本时，把指向它的链接改回上游原文。
- 合入上游后原文变化，`--check` 会提示复核：按新原文更新 OpenZWork 版本，再更新 `upstreamBlob`。上游删除了原文时，决定保留（改为独立文档并删除登记）或一并删除。不再需要的 OpenZWork 版本（读取方或引用方已去掉）随之删除。

## 技能

- `.agents/skills/` 下来自上游的技能整体不改，包括其中的脚本。先用 `pnpm openzwork:scan --path <文件>` 确认文件来自上游，再按 `docs/openzwork/maintenance-model.md`「技能布局」的表选择做法：说明上的差异写进差异表或根 `AGENTS.md`；不同的内容新增 `-openzwork` 文件并登记；不同的流程写成本技能的子能力或新建 OpenZWork 技能；整个技能不适用时保留不用或整个删除并登记 `drop` 条目。
- 上游技能的脚本只允许用户级根改名这一种原地改动：只改那一行，不加注释，改完用 `--path` 确认分类为 `upstream-identity`。需要其他行为时把脚本复制为 `<名称>-openzwork<扩展名>`，登记到 `docs/openzwork/upstream-doc-variants.yaml`（`role: maintained`，`upstreamBlob` 取上游原脚本），原脚本保持不动。
- 可以在上游技能目录下新增 OpenZWork 文件。
- OpenZWork 专用的维护方法放进本技能：新的子能力加到 `references/<名称>/GUIDE.md`，并在 `SKILL.md` 的路由表中加一行。
- 新建独立的 OpenZWork 技能前，先确认无法作为本技能的子能力；新建后在台账中登记为 `feature` 条目。
- 用户全局 Git 忽略规则可能包含 `.agents/`，新增文件需要用 `git add -f` 加入。
