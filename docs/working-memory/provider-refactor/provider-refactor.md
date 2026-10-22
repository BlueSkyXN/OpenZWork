# Provider 重构 Working Memory

> 本目录是上游 Provider 重构的研究与实施历史。文中的 Account Config、账号权益和服务端配置
> 记录用于解释当时的设计；OpenZWork 当前功能以源码与 `docs/spec/` 为准。日常维护从下方
> 内置 Provider 维护入口展开。

> 状态：主体实现收口，进入整体验证
>
> 最近更新：2026-09-09
>
> 当前阶段：核心架构和设置边界已落地；整理 Design V2 与上线验证

本目录保存 Provider 重构的目标设计、分阶段实施和当前代码调研。它是本次宏观工作的持续记忆。

## 文档入口

- [内置 Provider 模板与模型日常维护](../../builtin-provider-maintenance/README.md)：2026-10-14 整理，包含范围、原理、正式/测试配置、当前库存、官方资料跟踪、人工 Key 验证和交付流程。重构历史留在本目录，实时维护从新入口展开。

```text
provider-refactor/
├─ provider-refactor.md
│  └─ 当前状态与总入口
│
├─ design/
│  └─ design.md
│     └─ 历史演进中的层次化设计树
│
├─ design-v2/
│  ├─ design.md
│  │  └─ 当前核心设计唯一入口
│  └─ evidence-and-contradictions.md
│     └─ 历史矛盾、证据与裁定
│
├─ steps/
│  └─ steps.md
│     └─ 迁移路线、实施目标、结果和问题
│
├─ plan/
│  └─ plan.md
│     └─ 合并、自动化门禁、真实验证与最终收尾的上线总计划
│
├─ research/
│  └─ research.md
│     └─ 当前代码与协议的专项调研
```

- [`design-v2/design.md`](./design-v2/design.md) 是当前核心设计唯一入口。
- [`design-v2/evidence-and-contradictions.md`](./design-v2/evidence-and-contradictions.md) 说明旧材料如何被取代、
  当前事实依据和仍未完成的事项。
- [`design/design.md`](./design/design.md) 保留演进过程中的层次化设计，发生冲突时不再覆盖 Design V2。
- [`steps/steps.md`](./steps/steps.md) 介绍迁移 Roadmap、M1-M3 实施记录和 M4 阶段设计与实施结果。
- [`plan/plan.md`](./plan/plan.md) 固定 Provider 重构进入 Release Candidate 前的四阶段上线收口方向。
- [`research/research.md`](./research/research.md) 介绍当前代码和协议的专项调研，并引用每篇事实文档。

## 当前阶段

- [Todo138：空模型草稿与 Model 层推理档位兜底](./steps/todo-138-reasoning-level-ui-and-api-defaults.md)：已完成；空 UI 草稿不预填档位，Model 通用兜底 disabled/enabled，三种 API 通用 map 将 enabled 转为 high；保留层级及专用规则。来源 revision 23，合并版为 24；验证见正文及合并记录。

M1 已经统一所有生产模型调用的 `Model` / `ModelRequest` 边界。M2 已经统一普通长期 Model 的来源：

```text
ProviderConfigService
├─ ZCode Built-in Provider Config
├─ Account Provider Config
└─ Personal Provider Config ────────────────┐
                                            ├─> Effective Provider Config
ZCode Built-in Model Config Rules ──────────┤
Personal Model Config Rules ────────────────┘
                             |
                             v
            ProviderRegistryService
                     ├─ Provider[] / { modelId, config: ModelConfig }[]
                     └─ createModel(selection)
                                  |
                                  v
                             ModelFactory
                                  |
                                  v
                                Model
                                  |
                                  v
                           ModelRequest
```

Config Overlay、Registry View、Settings/Selection Facade、ModelFactory 和 Account Provider 请求期鉴权已经进入生产链路。Account Config 使用独立进程协议同步给本地 Worker，不再从 Workspace Registry Snapshot 反向提取；旧 Provider Store 只承担一次性 Personal/Account 迁移输入。

M3 已在这套基础上完成模型选择、原子 Submission、Guide/立即、Provider 设置页与 Model 输入输出格式
收口，并删除被取代的 ModelRef、共享可变 Runtime 模型状态、媒体 capability map 与连通性旁路。

## 当前进度

| 阶段     | 主题                                  | 状态                            |
| -------- | ------------------------------------- | ------------------------------- |
| M0       | 宏观架构与现状地图                    | 已完成第一轮                    |
| M1       | Model 与 ModelRequest                 | 已完成，MR !2006 已合入 staging |
| M2       | Provider 配置、Registry 与 Model 创建 | 已完成，作为 M3 的基础切片      |
| M3       | Provider 架构切换与 Model 格式收口    | 已完成                          |
| M4       | 模型执行链、闲时任务与 Subagent       | 已完成                          |
| 后续收口 | Config 发布、Account 与 Settings 边界 | 主体已实现；剩余项见 Design V2  |
| 独立专题 | Environment 配置与 Provisioning       | 不属于本次 Provider Refactor    |

## 下一步

[Todo117](./steps/todo-117-preserve-account-domain-on-provider-save.md)／[Todo118](./steps/todo-118-preserve-legacy-provider-enabled.md)：最新裁决已确认，待实施。内置账号 Provider 取消禁用能力，已有账号 false 不再生效、旧账号禁用不迁入；手动 Key Provider 保留启停。公共连接、权益、凭据和模型可执行性判断不变，不再等待内置禁用来源裁决。

[Todo132：模型选项底色反馈与供应商名称编辑修复](./steps/todo-132-model-option-feedback-and-provider-name-edit.md)：**待执行，方案已确认**。方块选项只加强选中底色，文字/图标及覆盖边框不改；名称输入不定时保存，Enter/失焦确认、Esc 放弃，其他字段保存不能夹带未确认名称。已列局部边界与验证，本轮仅落盘。

[Todo131：模型设置页智能配置位置与“恢复”按钮](./steps/todo-131-model-settings-smart-config-placement-and-restore.md)：**待执行，方案已确认**。智能配置移到模型 ID 容器右侧，底部左侧增加“恢复”；只改草稿、保存后生效，空 ID 可用且仅 saving 禁用。关联 Todo125/130，包含响应式布局、异步保护和 R121 验证，本轮仅落盘。

[Todo130：智能配置开关与手动配置字段边界修正](./steps/todo-130-manual-model-config-editable-field-boundary.md)：**待执行，方案已确认**。开关仅保存中禁用；手动只固化可编辑字段，内部映射/能力继续由当前系统规则解析，修 schema、合成与保存回退。按预计未正式发布处理，兼容保持轻量；不加隐藏字段编辑器，本轮仅落盘。

[Todo127：Built-in 配置在线发布与更新链路修复](./steps/todo-127-builtin-online-release.md)：**待执行，详细方案已确认**。已落盘下载 20 秒／10 MB、每分钟到期检查与每小时正常下载、Account 对齐和同一检查入口驱动恢复，以及实施顺序和测试。调查证据独立留档，本轮不实施产品代码。

[Todo113：近期新模型目录与智能配置更新](./steps/todo-113-new-model-catalog-refresh.md)：**第二轮待执行**。已列明逐模板目录与配置改动、下线清理及聚合支持必查；已确定型号仍须深度研究，不确定细节在执行时核实。首批历史结果保留，不与本轮验收混算。

[Todo125：模型设置页问号说明与定稿文案](./steps/todo-125-model-settings-help-copy.md)：已完成产品裁决并落盘，待实施。固定中文定稿、标题问号与跨端交互；不得擅自润色、扩充提示或改变配置行为。

M2/M3 已经让普通 Provider 的配置、展示、选择与执行统一使用 Built-in → Account → Personal 三层 Config、
Built-in + Personal Model Rules 和进程级 Registry。完成情况见
[`steps/02-provider-config-and-registry-cleanup.md`](./steps/02-provider-config-and-registry-cleanup.md) 与
[`steps/03-provider-architecture-cutover-implementation-log.md`](./steps/03-provider-architecture-cutover-implementation-log.md)。

核心架构与后续已完成 Todo 已形成当前上线收口基线；Todo 32 已完成 Team/Individual 设置页与
Effective Provider 边界收口。Todo 11、11A、15、19、22 等未完成、延后和草案事项统一见
[`design-v2/design.md`](./design-v2/design.md#11-尚未完成但不改变设计的工作)，不再从旧阶段编号推断当前状态。

本轮上线收口不扩大到 Remote Provisioning、模型选择生命周期、普通 Queue、
`modelContextBudget.strategy` 或账号产品重构。

## 维护原则

```text
design-v2 最终系统如何工作，以及历史矛盾如何裁定
design    历史层次化设计与专题细节
steps     如何迁移，以及实际发生了什么
plan      已完成主体实现如何进入可发布状态
research  当前代码和协议事实
```

稳定结论进入 design-v2；实施过程和偏差进入 steps；事实证据进入 research。旧材料不再通过静默改写伪装成
最终设计，冲突统一记录在 Design V2 的考证文档中。

Provider 架构演进期间，设计、实施记录、调研和历史材料统一保存在本 Working Memory 中，不提前复制到正式 `docs` 文档。相应阶段完成实现、验证并形成稳定事实后，再从 Working Memory 提炼面向长期维护者的正式文档；正式文档描述已经落地的系统，Working Memory 保留演进过程和决策依据。
