# 扫描：识别来源与预演合入

`pnpm openzwork:scan`（`scripts/scan.mjs`）以台账 `upstream.commit` 为上游基准，读取已提交的 HEAD。上游快照位于本仓历史中，CI 与本机都能运行。

## 常见问题

| 想知道                             | 命令                                                           | 看哪里                                                                       |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 这个文件是上游的还是我们的         | `--path <文件>`                                                | `上游：首次出现于 …` 或 `上游从未出现`                                       |
| 这个文件是不是我们删过的           | `--path <文件>`                                                | 分类 `removed`，认领中的 `OZ-D…` 是对应的裁剪条目                            |
| 上游已删、我们还留着的文件         | `--list retained`                                              | 应全部被 `OZ-R…` 认领                                                        |
| 哪些 OpenZWork 文件还没登记        | `--list openzwork --unclaimed`                                 | 逐个补到台账，或确认属于已有条目                                             |
| 哪些上游文件被我们实质修改         | `--list upstream-modified`                                     | 认领中的 `OZ-…`、`OW-P…`；只应剩代码文件                                     |
| 每个定制有没有保证、接线面多大     | `--entries`                                                    | 保证一列为「无」的条目要补测试或写 `unguarded`；接线面看 `hooks`             |
| 这份上游文档和 OpenZWork 有何不同  | 读 `docs/openzwork/README.md`「与上游的差异」；`--path <文档>` | 有 `-openzwork` 版本时 `--path` 会给出                                       |
| 合入新上游能直接吸收多少、冲突什么 | `--upstream <提交或 tag>`                                      | 吸收概览、冲突、我方已删被上游修改、上游新增落在裁剪路径内、受影响的台账条目 |
| 有没有只差格式化的上游文件         | `--format` 或 `--check`                                        | `upstream-format` 应为 0                                                     |

加 `--json` 输出结构化结果；`--base <提交>` 临时指定其他上游基准，例如回放历史同步。

## 分类

| 分类                | 含义                             |
| ------------------- | -------------------------------- |
| `upstream`          | 与上游基准一致                   |
| `upstream-format`   | 只差格式化，必须恢复为上游原文   |
| `upstream-identity` | 只差用户级根 `.openzwork` 改名   |
| `upstream-modified` | 我方实质修改的上游文件           |
| `removed`           | 上游有、我方已删除               |
| `openzwork`         | 上游任何版本都没有               |
| `retained`          | 上游已删除、我方保留             |
| `moved`             | 内容与某个上游文件相同，路径不同 |

“认领”指台账条目（`paths`、`hooks`、`tests`、`spec`）、下游补丁（`files`、`regression`）或上游文档的 OpenZWork 版本登记（`variant:…`）覆盖了该路径。`--path` 还会显示上游文档对应的 OpenZWork 版本，或 OpenZWork 版本对应的上游原文。需要认领的范围见 `docs/openzwork/maintenance-model.md`「来源分类」：`upstream-modified` 文件不要求逐个认领，汇总中的增删行数用来观察交叉面的变化。未认领不会让检查失败。

## 门禁

`--check` 与 CI 的 `tests/ci/openzwork-maintenance.test.mjs` 执行同一组检查，失败信息会给出修复方法：

- 台账、登记表与经验库的字段、编号格式和取值；
- 上游基准是 HEAD 的祖先，并与根 `package.json` 版本的前三段一致；
- 裁剪条目的路径不存在，其他 `active` 条目的路径存在；
- 上游文档和技能保持原文；同目录的 `-openzwork` 版本都已登记并写明 `role`，`tool`、`rule` 的读取方按实际读取目标验证（详见 `docs/openzwork/maintenance-model.md`：直接写版本路径、`openzworkDoc(原路径)` 选择函数或 `rule` 链接指向版本三种写法；直接读原文路径或文件名只在注释里都判失败），登记的上游原文与当前基准一致；
- 台账中每个 active、undecided 条目都出现在 `docs/openzwork/README.md` 的「与上游的差异」；
- 没有只差格式化的上游文件（需要已安装依赖中的 oxfmt）；
- OpenZWork 自有 Markdown 中指向已登记上游文档的相对链接，都指向其 OpenZWork 版本（只检查文件路径，不检查锚点；链接文字以「上游」开头的除外）；
- 每个 `active` 条目有核心 CI 中的保证或写明 `unguarded`，已有保证的条目没有残留的 `unguarded`；
- `.github/workflows/ci.yml` 步骤点名的测试文件都存在；
- 台账上游版本对应的 `docs/openzwork/upstream/v<版本>-integration.md` 存在。

## 核心 CI 中运行的测试

保证检查和 `--entries` 按以下来源判断一个测试文件是否在核心 CI 中运行：

- `tests/ci/core-tests.json` 列出的文件；
- `ci.yml` 各步骤 `run` 中出现的测试文件路径（文件名含 `.test.` 或 `.spec.`）。命令带 `--filter <包名>` 或 `--dir <目录>` 时，路径相对该包目录；路径含 `*` 时按通配符匹配；
- `run` 中的 `pnpm <脚本>` 展开为根 `package.json` 的脚本内容后按同样规则读取。

子包 `package.json` 脚本内部启动的测试不在识别范围内；需要计入时在 `ci.yml` 中点名文件，或列入 `core-tests.json`。

## 限制

- 只读取已提交的内容；检查未提交的改动前先提交。
- 改名判定只覆盖家目录下的用户级根由 `.zcode` 改为 `.openzwork` 的确定性写法（见 `scan.mjs` 的 `IDENTITY_RULES`），其他改动一律归为 `upstream-modified`。
- `--upstream` 只做预演，不修改工作区；冲突以 `git merge-tree` 的结果为准。
- 接线面的增删行数按文件统计。一个上游文件写在多个条目的 `hooks` 中时，每个条目都计入该文件的全部行数。
