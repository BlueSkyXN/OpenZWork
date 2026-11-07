# OpenZWork 维护模型

OpenZWork 持续合入上游 ZCode，同时保留自己的功能、行为调整和裁剪。维护工作由 AI Agent 执行。本文规定文件放在哪里、改动记在哪里、怎样识别一个文件或功能的来源，以及维护经验怎样沉淀。执行方法见 `.agents/skills/openzwork-maintenance/`。

## 双轨

| 轨道   | 内容                                           | 维护方式                                                   |
| ------ | ---------------------------------------------- | ---------------------------------------------------------- |
| 上游轨 | 上游已有的文件：代码、文档、技能、配置         | 尽量保持上游原文。合入上游新版本时，这些文件直接随上游更新 |
| 下游轨 | OpenZWork 新增的文件，以及对上游文件的必要改动 | 新增内容放在可识别的位置；改动上游文件时登记到台账并加标记 |

合入上游新版本时，Agent 按技能中的同步流程处理两轨的交叉点，也借此吸收上游的新做法。

## 来源分类

基准是 `docs/openzwork/ledger.yaml` 记录的上游提交（最近一次合入的上游快照）。扫描工具按下表给每个路径分类：

| 分类                | 判定                                   | 要求                                                      |
| ------------------- | -------------------------------------- | --------------------------------------------------------- |
| `upstream`          | 内容与上游基准一致                     | 保持原样                                                  |
| `upstream-format`   | 与上游的差异只来自格式化               | 不允许存在；恢复为上游原文                                |
| `upstream-identity` | 差异只有用户级数据根 `.openzwork` 改名 | 允许；只改必要的行                                        |
| `upstream-modified` | 我方实质修改的上游文件                 | 只允许代码文件；接线处加标记。文档改为另存 OpenZWork 版本 |
| `removed`           | 上游有、我方已删除                     | 应由台账中的 `drop` 条目认领                              |
| `openzwork`         | 上游任何版本都没有的文件               | 应由台账条目认领，或属于 OpenZWork 维护文档与工具         |
| `retained`          | 上游已删除、我方保留                   | 应由台账中的 `retain` 条目认领                            |
| `moved`             | 内容与某个上游文件一致，但路径不同     | 说明移动原因                                              |

识别"上游原作者写的"和"OpenZWork 写的"以 Git 历史中的上游快照为准。上游快照提交位于本仓库历史中（每次合入使用双亲 merge），本机镜像仓用于获取上游的新版本。

## 文档布局

| 内容                            | 位置                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游原有文档                    | 原路径，保持上游原文，不做任何修改                                                                                                                    |
| 上游文档的 OpenZWork 版本       | 同目录，文件名加 `-openzwork`（`foo.md` → `foo-openzwork.md`），内容是 OpenZWork 修改后的完整文档；登记在 `docs/openzwork/upstream-doc-variants.yaml` |
| OpenZWork 产品 spec             | `docs/specs/<名称>-openzwork.md`，与上游的 `docs/specs/` 同目录                                                                                       |
| OpenZWork 测试计划              | `docs/testing/<名称>-openzwork.md`                                                                                                                    |
| 上游其他目录下的 OpenZWork 文档 | 同目录，文件名加 `-openzwork` 后缀                                                                                                                    |
| 维护文档                        | `docs/openzwork/`：`upstream/` 上游整合与验证记录，`patches/` 下游补丁，`release/` 发行，`ci/` CI 与测试基础设施，`records/` 历史验收记录             |

`docs/openzwork/README.md` 是全部 OpenZWork 文档的索引。

## 上游文档的 OpenZWork 版本

- 上游文档与技能原文不动。OpenZWork 需要不同内容时，在同目录新建 `<名称>-openzwork<扩展名>`，写入修改后的完整文档，并登记到 `docs/openzwork/upstream-doc-variants.yaml`（`kind`：`purge` 删除了上游内容，`identity` 只改用户级根，`content` 增补或改写内容；`upstreamBlob` 为生成时的上游原文）。
- 读取或修改上游文档、技能时，同目录存在 `-openzwork` 版本的，以 OpenZWork 版本为准，修改也写在 OpenZWork 版本中。
- 合入上游后原文变化，`--check` 会按 `upstreamBlob` 提示复核对应的 OpenZWork 版本。
- 与上游原文逐字节一致的上游文档描述的是上游产品，净化门禁 WP-03、WP-08、WP-09 的文本扫描跳过它们；OpenZWork 版本照常扫描。
- 代码文件（包括技能中的脚本）不使用这种方式，按「代码」一节原地修改。

## 技能布局

`.agents/skills/` 下的上游技能保持上游原文。OpenZWork 专用的维护方法、扫描用法和经验集中在 `.agents/skills/openzwork-maintenance/`：入口 `SKILL.md` 只做路由，子能力位于 `references/<名称>/GUIDE.md`，经验库位于 `knowledge/`。

## 代码

- 新功能代码优先放在新文件或新模块中；上游文件只保留接线所需的改动。
- 上游文件里的接线处加注释 `OpenZWork(<台账编号>): <原因>`；缺陷修复继续使用 `OW-Pxxx`（见 [下游补丁清单](patches/downstream-patch-registry.md)）。存量的其他写法在下次修改该处时统一。
- 功能依赖的上游共享组件、store、协议和函数登记在台账条目的 `hooks` 中。同步时，扫描工具会报告上游对这些文件的改动。
- 上游文件不做格式化、注释润色或与任务无关的重构。

## 台账

`docs/openzwork/ledger.yaml` 记录每个 OpenZWork 功能、行为调整、裁剪和保留：

| 字段               | 含义                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `id`               | `OZ-F`（新增功能）、`OZ-C`（改变上游行为）、`OZ-D`（裁剪上游功能）、`OZ-R`（上游已删、我方保留）加三位数字 |
| `kind`             | `feature`、`change`、`drop`、`retain`                                                                      |
| `status`           | `active`、`undecided`（需要用户决定）、`retired`（已退役，保留记录）                                       |
| `title`、`summary` | 名称与一句话说明                                                                                           |
| `spec`             | 对应的 spec 或记录，可写多份                                                                               |
| `paths`            | 认领的路径或 glob。`drop` 条目的路径必须不存在，其余条目的路径必须存在                                     |
| `hooks`            | 可选，功能依赖或接线的上游文件                                                                             |
| `gates`            | 可选，`drop` 条目对应的净化门禁断言名称片段。路径不存在由台账检查保证，文本残留由这些门禁保证              |
| `tests`            | 可选，回归测试路径                                                                                         |
| `source`           | 决定的来源：PR、提交或 spec 段落                                                                           |

新增功能、改变上游行为或裁剪上游功能，都要在同一个 PR 中更新台账。

## 扫描

`pnpm openzwork:scan` 运行 `.agents/skills/openzwork-maintenance/scripts/scan.mjs`：

- 默认输出全仓来源分类与台账认领情况。
- `--path <路径…>` 输出单个路径的来源、首次出现的上游版本、当前分类和认领条目。
- `--upstream <提交或 tag>` 预演合入新上游：冲突文件、冲突中涉及台账条目的文件、上游新增文件中命中 `drop` 路径的文件、上游修改的我方已删文件。
- `--check` 执行门禁检查，由 `tests/ci/openzwork-maintenance.test.mjs` 在 CI 中调用。

## 经验库

`knowledge/` 下按类型分为三份 YAML：`pitfalls.yaml`（踩坑）、`diff.yaml`（diff 与识别经验）、`decisions.yaml`（取舍先例）。经验库由 Agent 在任务中更新，规则如下：

- 只记录经过实际任务验证的经验，并附上可核对的证据：提交、PR、文件路径或 spec 段落。推测和一次性的过程信息不记录。
- 新增前先在三份文件中搜索；已有相近条目时更新原条目。
- 一条经验只写一个可执行的做法，写明适用场景。
- 发现条目错误或过时，将 `status` 改为 `superseded` 并填写 `supersededBy`，或在没有替代时直接删除。
- 每份文件的 `active` 条目不超过 40 条，超过时先合并同类条目。
- 字段、编号格式和数量上限由 CI 校验。

## 门禁

`tests/ci/openzwork-maintenance.test.mjs` 校验：

1. 台账、经验库与 `upstream-doc-variants.yaml` 的字段、编号和取值。
2. 台账上游基准是 HEAD 的祖先，并与根 `package.json` 版本的前三段一致。
3. `drop` 条目的路径不存在；其他 `active` 条目的路径存在。
4. 上游文档与技能（md、yaml、json 等文档类文件）与上游原文逐字节一致；同目录的 `-openzwork` 版本都已登记；登记时记录的上游原文 `upstreamBlob` 与当前基准一致，不一致说明上游更新了原文，需要复核 OpenZWork 版本。
5. 任何上游文件都不能只有格式化差异。

## 待用户决定

- image-search 插件：v3.17.1 整合 spec 写明保持移除，但代码保留了注册（运行时拒绝官方鉴权）。台账中记为 `undecided`。
