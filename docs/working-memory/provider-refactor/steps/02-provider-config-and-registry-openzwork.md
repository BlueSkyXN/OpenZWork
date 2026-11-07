# M2：Provider 配置与 Registry 实施

> 状态：实现、退役清理与最终分支验证完成；等待上线
>
> 最近更新：2026-08-21

目标设计见 [`../design/registry/registry.md`](../design/registry/registry.md)。本篇记录 M2 的实施目标和切片。普通长期 Provider 的主体生产链路与退役清理已经完成；清理结果、保留的窄兼容边界和最终验证见 [`02-provider-config-and-registry-cleanup.md`](./02-provider-config-and-registry-cleanup.md)，新增代码规模与过渡边界评审见 [`02-provider-config-and-registry-review.md`](./02-provider-config-and-registry-review.md)。Merge Request 静态审查及其修复证据保存在 [`02-provider-config-and-registry-mr-review.md`](./02-provider-config-and-registry-mr-review.md)；其中的上线阻断项已经全部收口。

## 最高优先级迁移原则

Official、Personal 与 Account 三层 Provider Config 是 Provider Registry 的唯一事实来源。现有 Catalog/Preset 分支、Builtin hardcode、Provider Family resolver、旧 CLI Provider Config 和 Runtime Snapshot 中重复表达的静态事实，都必须迁入这三层或删除。

```text
旧静态事实仍然有效
└─ 搬入 Official / Personal Config

旧账号与套餐判断仍然有效
└─ 收敛为 Account ProviderConfigMap

旧动态凭据逻辑仍然有效
└─ 收敛到请求期鉴权 Service

无法证明仍然必要的旧分支
└─ 删除
```

迁移期不建立“旧 Snapshot + 新 Registry”的长期兼容层。允许在物理存储边界做一次性格式迁移，但迁移后的运行链路只能读取新的唯一事实来源。这一原则优先于按旧模块边界逐个兼容，M2 应尽快让生产路径开始消费正式 Config 与 Access Source。

## 实施目标

M2 统一“Model 如何从当前 Environment 的 Provider 事实产生”。M2 启动前，Host Provider Service、Worker Workspace Catalog、CLI Config Parser 和 Runtime Overlay 分别解释 Provider 静态信息，导致 Host 选择的模型与 Worker 真正执行的模型需要靠完整快照和兼容 Overlay 维持一致。

目标链路是：

```text
ProviderConfigService
├─ Official ProviderConfigMap
├─ Personal ProviderConfigMap
└─ Official / Personal ModelConfigRules ──┐
                                            ├─> Registry 输入聚合
AccountProviderService                      │
└─ Account ProviderConfigMap ───────────────┘
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
```

Host、Core Worker、Prompt CLI 和 TUI 复用相同 Config 与 Registry 领域实现，各自在进程内持有实例。

## 已完成的设计准备

当前已经确定：

- Config 使用统一 ConfigOverlay 语义，稀疏层和最终结果使用同一类型；key 有序，覆盖已有 key 时保留位置，新 key 按后层顺序追加。
- ProviderConfig 与 ModelConfigRules 都有 Official 和 Personal 两组有序输入。
- Account Source 直接产生第三层稀疏 `ProviderConfigMap`，与 Official、Personal 复用同一种 Overlay。Account Provider 的 `accessId` 和当前 `models` 都是 kind-specific Config 字段；Registry 不额外验证账号权益，请求鉴权由 Account Service 最终裁定。裁决背景见 [`02-provider-config-and-registry-human-in-the-loop.md`](./02-provider-config-and-registry-human-in-the-loop.md#1-account-access-复用-provider-config-overlay)。
- Registry 分两轮形成 ProviderConfig 和 ModelConfig。
- Provider 与模型对外保持顺序，内部索引支持查询、Selection 校验和 Model 创建。
- 设置页面和模型选择页面使用各自 Facade，不在 Renderer 复制解析逻辑。
- 设置页面只拖动 Personal-only Provider 和 Personal Provider 内模型；保存时按照 Effective 顺序重排 Personal Overlay，不建立独立排序 Preference。
- 每个进程拥有独立 Registry 实例；进程 Registry 启用后，Host Snapshot 不再参与普通长期
  Provider 的成员、属性、执行或展示。
- 闲时任务从进程级 Registry 选择 Official Builtin Provider；执行期只补充 Request Auth 与 Ticket，不建立临时 Provider 静态事实源。

具体设计从 [`../design/registry/registry.md`](../design/registry/registry.md) 逐层下钻。

## 首个实施切片的边界

M2 的第一批代码先建立了一条不依赖文件、网络、React、Electron、Services 或 Provider SDK 的领域链路：

```text
普通 Object / RPC 数据
          |
          v
Config Schema + ConfigOverlay
          |
          v
ProviderConfigResolver
├─ Settings 可用的完整解析结果与问题
└─ Registry 可发布的有效 Provider View
          |
          v
内存 ProviderRegistry
├─ 有序 View
├─ provider/model 索引
├─ ModelSelection 校验
└─ 变化通知
```

这一切片建立在新的纯领域包 `@zcode/provider` 中。后续切片已经让 Host、Worker、Prompt CLI 和 TUI 复用这套代码；文件监听、远端管理配置和账号接口继续由各自 Source Service 负责。

这一节只记录首个领域切片当时的边界，不代表 M2 最终交付范围。后续切片已经接入 Host、Worker、设置页、模型选择和模型执行；Adapter reasoning 映射仍保持原有执行语义。

首个切片开工时的影响面和测试契约保存在
[`02-provider-config-and-registry-impact.md`](./02-provider-config-and-registry-impact.md)；它是历史实施证据，不描述当前完成状态。

## 实施切片与结果

同一 Environment 内的 Account Config 跨进程同步先从 Workspace Snapshot 中拆出。Host 从自己的 Account
Provider Source 读取当前第三层 Overlay，通过 `provider/updateAccountConfig` 发送普通对象；
Worker 在 Provider 领域边界解析为 `ProviderConfigMap`，替换进程级 Account Source 并刷新
Registry。该协议不携带 JWT、API Key、一次性安全校验材料或请求 Header，也不绑定某个 Workspace。

```text
Host Account Provider Source
        |
        | revision + Account ProviderConfigMap JSON
        v
provider/updateAccountConfig
        |
        v
Worker MutableAccountProviderConfigSource
        |
        v
ProviderRegistryService.refresh()
```

Account Config 最初先从旧完整 Snapshot 中拆出，随后 M2.8 按执行、展示和远端来源分别退出了
Workspace Snapshot。当前 `provider/updateAccountConfig` 是仍然保留的窄同步边界。

`provider/updateAccountConfig` 不跨 Environment 使用。Remote Host 从自己的账号状态形成
Account Config，再把它同步给自己管理的 Remote Worker。Desktop Local Host 不向 Remote Host
或 Remote Worker 发送这份 Overlay。

本地与远端生产 Worker 都拥有 Official、Personal、Account 三层 Registry。普通生产路径的
ModelFactory 查询所属进程的 Registry；协议 Entry 必须装配 Process Registry，缺少 Official 或
Personal Config 路径时启动直接失败，不再回落到 Workspace Provider Catalog。

Local Host 通过自己的 `ModelSelectionView` 判断至少存在一个可选择模型，并在空 Registry 变为
可用时唤醒等待启动的 Worker。这个 View 不携带执行凭据，也不用于构造普通 `runtimeModel`。
Session create/resume/set/send 等本地入口只传 `providerId/modelId/reasoningLevel`；Worker 依据自身
最新 Registry 创建 Model。Worker 的 Official 与 Personal 来自自己的 Config Source，Account 由
独立进程协议同步。M2 实现中仍保留的 execution-scoped `runtimeModel` 只服务闲时任务，是迁移期
兼容输入；最新裁决要求后续把它收窄为 ModelSelection + Request Auth + Ticket，删除其中的 Provider
和 Model 静态配置。它从不表达 Workspace 或另一个 Environment 的长期 Provider 事实。

desktop-attached remote 不再建立动态鉴权的跨 Host 路由。Remote Worker 的请求只到达 Remote Host，
由 Remote Account Request Auth 读取 Remote Credential Store。后续本地到远端的持续同步功能可以更新
Remote Config 与 Credential Store，但同步完成后仍由 Remote Source 重建 Registry、由 Remote Request
Auth 解析请求凭据。它不会恢复 Desktop Snapshot 或跨 Host 请求鉴权。

```text
Local Host ModelSelectionView
        |
        +-- 启动门禁 / 模型选择
        |
        +-- Submission(ModelSelection)
                    |
                    v
             Local Core Worker
                    |
                    v
          Process Provider Registry
                    |
                    v
                  Model

迁移期 execution-scoped runtimeModel
        |
        v
闲时任务兼容输入
```

## M2.8 的来源退出顺序

M2.8 完成时，Worker 仍保留下面两类 Model 来源。这张图记录已经交付的迁移状态，不是最终设计：

```text
一次 Agent Loop 创建 Model
        |
        v
Turn Execution Source
├─ 仅当前执行存在
├─ 当前用于闲时任务兼容 runtimeModel
└─ 命中时覆盖同名 Registry 模型
        |
        | 未命中
        v
Process Provider Registry
├─ Official ProviderConfigMap
├─ Personal ProviderConfigMap
├─ Account ProviderConfigMap
└─ 普通长期 Provider 的唯一事实来源
```

Turn Source 与 Process Registry 分别判断自己持有的 target。二者即使包含相同 `providerId/modelId`，
也不能借另一层的成员判断宣称自己能够创建 Model。M2.8 已经让主要生产路径退出 Workspace
Compatibility Source；上线清理随后删除了它的 Bootstrap fallback 和旧协议类型。后续 M4 再删除
Turn Source 的 Provider 静态配置：闲时任务改从 Process Registry 选择 Builtin Model，只保留
turn-scoped Request Auth 与 Ticket。

切片编号用于当前规划，可以根据代码依赖调整。调整时先更新本篇，不在实现中另造平行架构。

## 后续阶段接续的边界

Config、Registry、主要生产装配和旧事实源退役已经完成，并由 M2 清理门禁持续保护。后续阶段在当前边界上继续：

- M3 把模型选择与 Prompt 原子封装为 Submission，并统一 Session、Draft、Recent 与 Loop 内切换语义。
- M4 删除通用 execution-scoped Provider；闲时任务改用 Registry ModelSelection，并仅携带本 Turn 的 Request Auth 与 Ticket。
- M6 继续整理 Account Provider 的身份、权益、凭据刷新与请求期鉴权内部结构。
- M7 实现 Remote Environment 的 Provisioning Sync 与远端设置操作；远端 Registry 始终读取远端自己的事实源。

旧 Store Reader 的删除以一次性 Personal Config 与 Account Key 迁移停止支持为前提，不再参与任何运行时设计。

相关现状证据见 [`../research/m2-registry-aggregation-and-refresh.md`](../research/m2-registry-aggregation-and-refresh.md)。实施中超出原计划的自主决策见 [`02-provider-config-and-registry-implementation-log.md`](./02-provider-config-and-registry-implementation-log.md)。

## 实施记录与裁决去向

本篇维护 M2 切片的当前状态。实施期间超出原计划的自主决策按时间顺序保存在
[`02-provider-config-and-registry-implementation-log.md`](./02-provider-config-and-registry-implementation-log.md)；需要人裁决的架构、产品和公共契约问题保存在
[`02-provider-config-and-registry-human-in-the-loop.md`](./02-provider-config-and-registry-human-in-the-loop.md)。历史记录可能被后续裁决或实现取代，当前事实以本篇、Design 和 M2 Cleanup 为准。

```text
设计已经回答的问题
└─ 直接按设计实施

实现细节但不改变边界
└─ 自主决策并记录

会改变目标边界的问题
└─ 先回到 design 讨论
```

## 完成条件

- Official/Personal/Account ProviderConfigMap 只有一套 Overlay 逻辑，Official/Personal ModelConfigRules 只有一套解析逻辑。
- Catalog、Preset、Builtin hardcode、Family resolver 和旧 Runtime Snapshot 不再作为额外 Provider/Model 事实来源。
- Host、Core Worker、Prompt CLI 和 TUI 复用相同 Provider 领域实现。
- Registry 维护当前有序 Provider View、查询索引和 Selection 校验。
- 普通 API Provider 的 Submission 只携带 ModelSelection，Worker 使用自己的 Registry 创建 Model。
- 设置和选择 Facade 使用 Registry，Renderer 不解释配置来源。
- Official Provider 顺序稳定，Personal-only Provider 与其模型的拖动结果由 Personal Config 自身顺序表达。
- Registry 更新只影响新 Model，当前 Agent Loop 保持稳定。
- Official/Personal Config Source 只在 content revision 改变时发布 invalidation；
  Personal 进程自写不会被文件 watcher 重复通知，外部编辑仍即时生效。
- 迁移期兼容逻辑已经退出生产权威，并按
  [`02-provider-config-and-registry-cleanup.md`](./02-provider-config-and-registry-cleanup.md) 删除残留接口、类型和 fallback。

上述条件和 M2 Cleanup 的退役门禁全部满足后，M2 才标记完成。M2 已经建立 Provider/Model Config、账号级 accessId、Usage/Entitlement 事实源、请求鉴权账号核对和 Credential 隔离的统一边界。它不重新定义产品权益规则，不重做 Token 刷新协议、Usage API 行为和闲时任务状态；M4 与 M6 再分别处理 execution-scoped 执行语义和更完整的 Account Provider 状态模型。
