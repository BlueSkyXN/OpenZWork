---
name: openzwork-maintenance
description: OpenZWork 维护入口：识别文件和功能来自上游 ZCode 还是 OpenZWork，放置新文档与代码，更新台账，合入上游新版本，沉淀维护经验。修改上游文件、新增 OpenZWork 功能或文档、同步上游、整理 docs 与技能时使用；模块内部的实现细节按对应模块的 spec 与技能处理。
---

# OpenZWork 维护

本技能是路由入口。先按下表选择子能力，读取 `references/<名称>/GUIDE.md` 后再执行。

事实源：

- 维护模型：`docs/openzwork/maintenance-model.md`
- 文档索引：`docs/openzwork/README.md`
- 台账：`docs/openzwork/ledger.yaml`
- 上游文档编辑登记：`docs/openzwork/upstream-doc-edits.yaml`
- 下游补丁：`docs/openzwork/patches/`
- 经验库：本技能的 `knowledge/`

## 路由

| 子能力          | 何时读取                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `scan`          | 查某个文件或功能的来源、是否已被我方删除、是否被台账认领；合入上游前看冲突 |
| `docs-layout`   | 新建或修改 `docs/` 下的文档、`.agents/skills/` 下的技能                    |
| `code-boundary` | 新增 OpenZWork 功能、修改上游代码文件、处理与上游共用的组件和函数          |
| `ledger`        | 新增功能、改变上游行为、裁剪或保留上游功能之后                             |
| `upstream-sync` | 合入上游 ZCode 新版本，或从上游挑选新做法                                  |
| `knowledge`     | 任务中得到值得复用的经验，或发现已有经验有误                               |

一个任务可能用到多个子能力，例如新增功能依次用 `scan`、`code-boundary`、`docs-layout`、`ledger`。

## 每次维护都遵守

1. 改文件前用 `pnpm openzwork:scan --path <文件>` 确认来源。上游文件只改行为必需的行，不格式化、不润色、不顺手重构。
2. 开始前读 `knowledge/` 中与任务相关的条目；任务中得到的新经验按 `knowledge` 子能力写回。
3. 改动上游文件、新增或裁剪功能时，在同一个 PR 中更新台账和登记表。
4. 提交后执行 `pnpm openzwork:scan --check`。检查读取已提交的内容，未提交的改动不在检查范围内。
