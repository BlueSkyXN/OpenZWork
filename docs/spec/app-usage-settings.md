# 使用统计页重建（本地度量）规格

- 工作包：WP-E1b
- 状态：实现规格
- 复核日期：2026-09-23
- 目标：恢复设置页「使用统计」的 App Usage 页面，只消费现存本地用量事实与现有协议，不重建遥测/云上报链。

## 1. 背景与范围

使用统计的事实采集和聚合协议仍在，但设置页分派及 `settings/usage-stats/` 的主要 UI 已删除。当前导航配置仍保留 `usage` 分区（`packages/ui/src/settings/settingsPageConfig.ts:145-149`），而 `SettingsPage` 的分派没有 `activeSection === "usage"` 分支（`packages/ui/src/SettingsPage.tsx:982-1089`），因而落入 `null`；存活图表色板位于 `packages/ui/src/settings/usage-stats/appUsageChartPalette.ts:1-14`。

本工作包恢复一个可读的 **App Usage** 统计页：包含时间范围、刷新、摘要指标、活动热图、按日模型趋势、模型排行和工具排行。UI 仅消费 `AppUsageSnapshot` 已有字段；不得增加协议 schema 字段或建立第二条度量采集链。

**明确口径：本地度量，数据不用于云遥测。** 用量事实写入 Agent 本机 SQLite session store；统计只查询当前 Agent Host 暴露的本地 usage store。不得恢复 WP-05 删除的云遥测、遥测客户端/上传、官方账号、供应商账号同步或官方在线服务，不得将统计快照复制到云端或 relay 保存。UI 发起的既有 Host/RPC 读取只用于向用户展示其请求的结果，不形成上报、后台同步或中转持久化。此规则承接计划中的 E1b 重定范围和「不重新引入云遥测、官方账号、官方在线服务」纪律（`local/feature-eval-20260922/DECISIONS-AND-PLAN.md:29-33,122-127`）。

## 2. 产品规则

1. **只展示本地 App Usage。** 页面不展示供应商端点用量、远端额度、Coding Plan/个人套餐、账号登录或购买入口。若既有 i18n 中还留有相关键，不代表本页可以调用或呈现其能力。
2. **范围选项沿用协议**：`all`、`7d`、`30d`，不加入自定义日期或其他窗口。`all` 表示当前 usage store 尚保留的全部数据，不能文案承诺永久/终身历史：写入路径会滚动清理 30 天之前记录（`apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts:16-18,334-350`）。
3. **本地时区归桶。** UI 在请求时传入 IANA 时区；若浏览器无法提供有效时区则回退 `UTC`。快照携带 `timeZone` 和 `generatedAt`，图表日期按该时区解释。当前存储查询用调用时提供的固定偏移计算本地日；已有实现注明 DST 跨日最多约一小时误差（`apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts:383-390`），本工作包不改其聚合口径。
4. **读取是只读、显式刷新。** 初次进入和改变范围时读取一次；用户触发刷新后重新查询，范围选择保持不变。不得由页面写 usage store、改写历史或启用后台轮询。刷新并发时仅最新请求可以更新可见状态。
5. **空数据与错误分开。** 合法空快照显示空态；RPC/服务失败显示错误状态和重试入口，不得把失败伪装成零用量。现有 RPC 在 usage store 不可用时会构造零值快照以便空态（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:1781-1816`）；实现应保持该协议行为。
6. **数据表达。** 使用快照中的 token、请求/会话/轮次、活跃天数、缓存命中率、错误率、TTFT/轮次时长、heatmap、每日模型、模型排行和工具排行字段；不推算费用，不叠加 cache read/write 到已包含 cache 的 input 分母，不新增 querySource、错误分桶或耗时分布等进阶维度。
7. **桌面与 Web 同语义，但不得误路由。** 设置导航、指标定义和交互在桌面及 Web 一致；小屏仅改变排列与密度，不隐藏范围选择、刷新、空态/错误态等主要功能。统计始终来自当前客户端明确提供的本地 base Host；不得因当前选中远程 workspace 而将远端用量标成「本地」。运行环境没有可确认的本地 base Host 时显示本地统计不可用提示，不以空快照代替，也不回退到远端或普通当前 workspace 服务。没有活动 workspace 不妨碍使用 Agent service 既有的本机 management ProcessManager。

## 3. 状态唯一所有者与写入路径

| 状态/数据                     | 唯一所有者                                | 允许的写入/读取路径                                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型请求、turn、tool 用量事实 | Agent Runtime / CLI Host 运行时事件观察者 | Runtime 从模型/turn/tool 事件构造记录，经 `UsageStorePort` 写入 session store；UI 不写。模型与 turn 写入见 `apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts:54-119,130-199`，tool 事件见同文件 `:201-331`。                            |
| SQLite 中的用量事实及聚合查询 | session-store adapter                     | `repositories/usage.ts` 的 upsert/record 与 `queryAppUsage` / `pruneUsage` 是唯一持久路径；查询不改变事实。                                                                                                                                                    |
| 协议聚合快照                  | CLI Bootstrap 的 `buildAppUsageSnapshot`  | 聚合函数纯转换，不另存快照；缓存命中率、日期桶和排行由 builder 计算（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/usage-stats-builder.ts:82-115,167-240`）。                                                                                          |
| 页面已选范围及图表局部交互    | App Usage 页面                            | 页面是 `range` 的唯一所有者，默认 `30d`；只有页面更新范围，再将其作为参数传给 hook。离开页面不修改用量事实，也不要求持久化用户设置。                                                                                                                           |
| 页面查询生命周期状态          | UI 的 App Usage hook                      | hook 独占 `loading / data / error / request version`，并对外提供 `refresh()`；接收页面 `range`，不接收 Host target，由 Agent service 自身的本机 management ProcessManager 路由，不维护另一个可写的 range。不得再在 SettingsPage 或服务中复制一份查询结果缓存。 |

写入只能由 Runtime → `UsageStorePort` → 本机 SQLite 发生。页面统计读取不得建立第二写入者或在服务层落库。

## 4. 数据链、接口与事件顺序

### 4.1 数据链

```text
Runtime model / turn / tool events
  → UsageStorePort recordModelUsage / upsertTurnUsage / upsertToolUsage
  → adapters session-store SQLite (model_usage / turn_usage / tool_usage)
  → queryAppUsage(since, until, tzOffsetMs)
  → bootstrap getUsageStats + buildAppUsageSnapshot
  → Local base Host 上的既有 V4 RPC: v4/usage/stats
  → packages/services thin facade: getAppUsageStats({ range, timeZone })
       （authority 双重校验；Agent service 通过自身管理 ProcessManager 路由）
  → packages/ui/src/hooks/ App Usage hook（接收页面 range）
  → SettingsPage usage 分派 / App Usage 页面（range 单一所有者）
```

会话级 `conversationUsage` 是既有的另一条只读查询，不是 App Usage 页面聚合的替代品；现有服务路由见 `packages/services/src/zcode-agent/zcodeAgentService.ts:2804-2812`。V4 的 `usageStats` 名称和 schema 已存在，协议注释明确 usage facts 在 CLI session store、Host 不留副本（`packages/shared/src/zcode-protocol-v4/transport.ts:338-342,737-748`）。

### 4.2 接口约束

- **存储**：复用 `UsageStorePort.queryAppUsage({ since, until, tzOffsetMs })`；查询输入、结果字段定义在 `apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts:982-1051,1070-1076`。
- **Builder/RPC**：复用 `buildAppUsageSnapshot` 和 `getUsageStats`。既有 V4 入参为 `{ range: "all" | "7d" | "30d", timeZone?: string }`，结果为 `AppUsageSnapshot`（`packages/shared/src/zcode-protocol-v4/transport.ts:740-748`；builder/RPC 调用见 `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:1763-1817`）。不得更改或新增 schema 字段。
- **Services 薄 facade（恢复缺失面）**：services 暴露 `getAppUsageStats({ range, timeZone })` 应用级只读入口，供 Settings 调用，不要求调用者传入当前 workspace。facade 仅在可信 `runtimeSurface === "desktop_local_host"` 且 `serviceAuthorityMode === "desktop-local"` 时响应。Agent service 的 `getAppUsageStats` 使用自身的 `pluginProcessManager` 发送既有 V4 `{ range, timeZone }` RPC；不使用页面当前 workspace path，不接受调用方 workspace target，也不为统计另建持久目录。远程或普通 standalone server authority 不作为 App Usage 本机服务。返回既有 schema 校验后的 `AppUsageSnapshot`；不直接读 SQLite、不复刻 builder 聚合、不落缓存、不改变 RPC schema。
- **Management 目标与本机用量事实的数据根**：`pluginProcessManager` 与普通 `processManager` 均以 `ZCodeAgentProcessManager` 构造，管理进程复用相同 command resolver、presentation surface、request timeout、spawn-env resolver 与 admission hook（`packages/services/src/zcode-agent/zcodeAgentService.ts:836-860`）。Management Host 启动同一个 `zcode_protocol_entrypoint`，session store 由 `getSessionDbPath(configResult)` 打开（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts:118-132`）；普通会话的准备入口也调用同一 helper（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts:65-75`），正常 Host session store 装配使用同一 `getSessionDbPath`（`apps/zcode-cli/packages/bootstrap/src/app/session-store.ts:74-85,104-109`）。`sessionDbPath` 是与 `storage.dir` 无关的共享用户级配置：默认绝对路径为 `~/.openzwork/cli/db/db.sqlite`（`apps/zcode-cli/packages/contracts/src/config/index.ts:301-304`），配置 merge 分别读取 `storage.dir` 与 `storage.sessionDbPath`（`apps/zcode-cli/packages/adapters/src/config/index.ts:272-275`）；环境变量 `ZCODE_STORAGE_DIR` 只映射 `storage.dir`，而 `ZCODE_SESSION_DB_PATH` / `ZCODE_SESSION_DB` 单独映射 `sessionDbPath`（`apps/zcode-cli/packages/adapters/src/config/env-config.adapter.ts:25-31`）。因此只改 `storage.dir` 不改变 App Usage DB；只有显式改 `storage.sessionDbPath`（配置键或上述 session DB 环境变量）才改变数据位置。默认 session DB 为绝对路径，不受进程 cwd 影响；若用户将该键改为相对路径，host 按实际进程 cwd 解析（`packages/desktop/src/host/hostDatabaseStartup.ts:71`、`apps/zcode-cli/packages/bootstrap/src/app/session-store.ts:104-109`）。产品装配没有按管理/普通 Agent 分别设置 `SESSION_DB_PATH`，故两类本机 Agent 在同一共享配置下访问同一 session DB；用户若显式按进程注入不同的 session DB 环境变量则不在产品保证范围。默认 management cwd 为 `getDataBaseDir()/.openzwork/plugin-workspace`（`packages/services/src/zcode-agent/zcodeAgentService.ts:411-420`，`OPENZWORK_DATA_DIR_NAME` 定义为 `.openzwork`：`packages/shared/src/productIdentity.ts:7`），它只隔离管理进程生命周期，不定义用量数据根。`getUsageStats` 从 protocol context 的 `sessionStore` 调用 `queryAppUsage`（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:1781-1816`；`queryAppUsage` 委托该 store 所持 SQLite db，`apps/zcode-cli/packages/adapters/src/storage/session-store/sqlite-session-store.ts:854-856`）。
- **本机服务能力与 UI 目标路由**：UI 必须从 base/local services 调用上述 facade，不得用 active-workspace `useServices()`，也不得用 `useWorkspaceServices()` 按当前 workspace 解析；远端 active workspace 下普通 `useServices()` 可指向远端 Host。`useBaseWorkspaceServices()` 可选择根/base services（`packages/ui/src/hooks/useWorkspaceServices.tsx:127-135`），但它在无已注册 base services 时会 fallback 到 context；此外 `Root` 会在所有平台（包括 Web）把传入的 services 注册为 base（`packages/ui/src/Root.tsx:335-340`），因此仅凭当前 baseServices 非空不能证明它是用户桌面本机 Host。实现必须增加独立的、仅由 Desktop renderer 启动时以可信本地 ServicePort 注册的可选 local-base services capability；其 hook 不得 context fallback，Web/SSR 和未注册场景返回 unavailable。services facade 不构造 workspace target；Agent service 使用自身的本机管理 ProcessManager 连接 V4 usage RPC。UI 不拼接管理路径、不接受外部远端 target，不绑定当前活动项目的 session/runtime，也不为统计启动远端 Agent。services 侧还须只在 Host 明确装配为 `runtimeSurface === "desktop_local_host"` 且 `serviceAuthorityMode === "desktop-local"` 时启用 usage 读取，其他 authority（包括 desktop-attached-remote 和 standalone-server）拒绝调用，避免把服务进程本机误当成 Desktop 用户本机。
- **无活动 workspace / 无可用本地 Host**：App Usage 不依赖活动项目路径；Desktop 本地 host 的 Agent service 使用其既有 management ProcessManager 查询本机数据库，不向页面或 active workspace 传递 workspace target。若当前平台没有已确认的本地 base services，页面显示本地统计不可用状态，且不触发查询、不将空数据或远程数据替代为本地事实。存在本地 base services 但查询失败时，显示错误与重试操作，不得静默 fallback 到 active `useServices()`、远端 workspace 或零值快照。对既有 `getUsageStats` 返回的合法零值快照仍按空数据处理；本地路由失败则是不可用/错误，不得伪装成合法零值结果。
- **UI hook**：放在 `packages/ui/src/hooks/`，通过 base/local services 的既有 hook 接入 facade；管理 `loading / data / error / request version` 与 `refresh()`，接收页面传入的 `range`，不接收当前项目/远程 workspace target，也不在 hook 内另存 range。组件禁止直接调用 RPC client、Host 或 repository。可参考现存异步查询 hook stale-request 防护模式（`packages/ui/src/hooks/useModelTrajectory.ts:30-86`）。
- **页面**：`SettingsPage` 为 `activeSection === "usage"` 分派重建的 App Usage section；页面为范围状态唯一所有者，默认 `30d`，改变范围时将新值传入 hook；保留现有 `settings.usageTitle` 导航 ID（`packages/ui/src/settings/settingsPageConfig.ts:145-149`）。图表模型颜色复用 `appUsageChartPalette.ts`。

### 4.3 事件顺序图

```text
采集（不由统计页触发）：
Agent Runtime        UsageStorePort / SQLite       Bootstrap 聚合
    | model/turn/tool 事件   |                            |
    |---------------------->| 写入/幂等 upsert            |
    |                       |                            |
    |                       |  用户打开/刷新后才查询       |
    |                       |<---------------------------| queryAppUsage
    |                       |--------------------------->| AppUsageQueryResult
    |                       |                            | build snapshot

读取与刷新（同一顺序；无活动 workspace 时相同；range 仅由页面拥有）：
用户    AppUsagePage(range owner)  Hook            Base/local services  Services facade   Agent management PM   本机 SQLite
 | 打开 / 改范围 / 刷新  |             |                    |                  |                  |                    |
 |-------------------->| 设置 range  |                    |                  |                  |                    |
 |                     |------------>| 收到 range         |                  |                  |                    |
 |                     |             |------------------->| getAppUsageStats |                  |                    |
 |                     |             |                    |----------------->| usage/stats(range,tz)
 |                     |             |                    |                  |------------------->| query
 |                     |             |                    |                  |<-------------------| rows
 |                     |             |                    |<-----------------| snapshot           |
 |                     |             |<-------------------|                  |                  |                    |
 |                     |<------------| 仅最新 request version 提交 data/error                   |                    |

远端 workspace 当前激活：
UI 不调用 active remote services / useWorkspaceServices；仍只调用 Base/local services → 本地 facade → Local Host → 本机 SQLite。
无可确认 Base/local services：UI 显示「本地统计不可用」，不触发 Host/RPC，不回退到 context/远端 services。
```

读请求失败不得覆盖已有较新请求结果；改变筛选或刷新产生的新 request version 使旧结果失效。统计数据是查询时快照，无实时推送承诺。

无活动 workspace 时，页面调用 base/local services 的无 workspace 入参 facade，由 Agent service 自身的 management ProcessManager 查询本机 session store，不要求打开或选中项目；若无已确认的 base/local services 则不调用任何 Host。主动切换到远端 workspace 时仍只调用 base/local facade；远端 workspace service 不参与 App Usage 数据链。不能假设 `useBaseWorkspaceServices()` 在任何缺注册情形都会报错：当前实现无注册时 fallback 到 context services（`packages/ui/src/hooks/useWorkspaceServices.tsx:138-145`），故页面接入需能区分确认的 base/local service 与 context fallback。

## 5. 页面与设计规范

- 只提供「应用用量 / App Usage」内容，不恢复个人套餐 tab、供应商 usage tab 或在线额度状态。
- 页面建议层次：范围与刷新操作区 → 汇总指标 → 活动热图 → 每日模型趋势 → 模型/工具排行。桌面宽屏可并列图表；窄屏改为单列、图表容器可缩放/滚动但页面无整体横向溢出。
- 遵循 `DESIGN.md`：系统 / Light Theme（Zai Light）/ Dark Theme（Zai Dark）三种主题模式（`DESIGN.md:41-49`）；验证 Light/Dark 活跃体验和 System 跟随。颜色只用语义 token 与现有 usage 图表色板，不用 ad hoc 颜色；状态颜色只表达真实状态（`DESIGN.md:51-120,164-175`）。
- 所有应用 UI 字体使用 `text-ui-xl/lg/base/caption/sm/xs` 角色阶梯，禁止 Tailwind `text-base/sm/xs` 与任意字号；图表坐标装饰不作为新增文本层级例外（`DESIGN.md:6-17,187-233`）。
- 保持 dense、信息密度优先，复用现有卡片/图表/UI primitives；主容器遵循 `bg-background`，正常指标卡用 `bg-card`/`bg-surface`，避免营销式大留白或渐变（`DESIGN.md:19-39,262-280,401-412,453-458`）。
- 桌面和移动 Web 都需可读可操作；窄屏调整 grid/flex/可视区域，不改变功能语义或隐藏核心操作（`DESIGN.md:484-498`）。键盘操作、可见焦点、对比度和较长翻译均需满足（`DESIGN.md:500-507`）。图表不能只靠颜色表达数值，需有文本标签/可访问名称。

## 6. i18n 盘点

以当前目标分支 `packages/ui/src/i18n/locales/zh-CN.ts` 和 `en-US.ts` 的 `settings.usage.*` 键统计：两种语言各 **143 条**；按 key 集合比对，zh-CN 独有 **0**、en-US 独有 **0**，现存键已成对。现有条目包含 App Usage 可复用的范围、loading、refresh、error、empty、summary、heatmap、daily/model/tool chart 文案；也混有远端/供应商/Coding Plan 等本页非目标文案（中文文件约 `:2551-2752`，英文约 `:2684-2894`）。

实施规则：

1. 先按新页面实际消费清点 key，不把「存在」误作「仍需呈现」；本页只消费本地 App Usage 文案，不连接或渲染远端/套餐旧文案。
2. 新增或修改的 `settings.usage.*` 文案必须在 `zh-CN.ts` / `en-US.ts` 同一变更成对补齐；校验 key 集合差异为 0。
3. 若实现过程中确认旧 Coding Plan/remote 专属键无任何存活消费者，可在本包同步清理；不得为清理而删除其他页面仍使用的键。必要时新增明确的「仅在本机统计，不会上传」隐私说明，并双语成对添加。

## 7. 验收场景

1. **空数据态**：使用无 model/turn/tool usage rows 的 store 请求 `all`、`7d`、`30d`。页面显示本地统计空态及清晰说明；数字为零/空排行不误显成服务错误；没有 Coding Plan、账号或在线服务内容。另单独模拟 RPC reject，确认显示错误与可重试操作，而非零值空态。
2. **有数据态**：准备多个模型、多个日期、工具调用及错误记录。确认摘要总量、模型/工具排行、热图和日趋势来自同一个 snapshot，model/tool 排序与 schema 返回一致，favorite model 与首位模型一致；cache hit rate 不二次叠加 cache breakdown；页面不显示费用。桌面与移动 Web 均可完整访问所有区块。
3. **时区偏移**：以同一组跨 UTC 午夜的记录分别请求 `Asia/Kolkata` 和 `America/Los_Angeles`。两边汇总数量保持一致，快照保留各自 `timeZone`，按本地日期展示的热图/日趋势可以不同且与所传偏移一致；DST 转换日期按当前固定偏移规则验证并保留最多约一小时的已知限制，不在本包引入新的时区算法。
4. **刷新**：页面加载后追加一条本地 usage 记录，再点击刷新。页面发起新查询、保留当前 range，成功后展示更新的快照与 `generatedAt`；快速连续刷新/切换 range 时旧响应不能覆盖新响应；失败后重试可恢复。
5. **本机路由及无 workspace**：有本地 base services 时，不论当前选中本地项目、远端 workspace 或没有活动 workspace，App Usage 均用 `useBaseWorkspaceServices()`，由 Agent service 自身的 management ProcessManager 查询与本机会话共享的 session DB，不传递 workspace target 或 remote identity。确认页面结果为本地来源，不调用 active remote services。Web/SSR 或其他无 base services 场景显示「本地统计不可用」，不发 RPC、不回退至 `useServices()`。模拟本机 management 连接或 RPC 失败时展示错误与重试，不显示零值空态。DB 同一性由路径配置/装配静态保证，不为此增加运行时 DB 测试；services authority gate 由单测验证。
6. **范围单一所有者**：仅 App Usage 页面持有 range（初始 `30d`）；hook 接收此值并仅持有加载/数据/错误/请求版本。切换范围应恰好按页面新值查询；hook 不暴露第二个 setRange，也不能出现页面与 hook 中 range 不一致。
7. **布局与国际化**：System、Zai Light、Zai Dark 下对比度及图表颜色可读；窄屏无整体横向溢出，图表和文本仍可访问；zh-CN/en-US 的页面消费键成对且布局可容纳长文案。

## 8. 非目标

- 不新增或修改协议 schema 字段、存储表、埋点类型、统计维度或聚合算法。
- 不恢复 WP-05 云遥测/ARMS、远程采集、relay 数据保存、官方账号/在线服务、供应商 usage/额度/Coding Plan。
- 不拓展保留期限、费用估算、自定义日期、90 天等窗口，不承诺超过本地 store 保留的数据。
- 不将页面统计与 conversation usage 混成新协议；不改会话状态面板的 token/cumulative 展示。
- 不增加导出、跨机器汇总、后台定时刷新、实时推送或可写操作。

## 9. 依据与复核说明

- 工作包范围和明确本地、不重建云上报：`local/feature-eval-20260922/DECISIONS-AND-PLAN.md:29-33,122-127`；同一文件 `:138` 记录 E1b 当前存活/删除面及 4 个 UI 文件重写、services 聚合恢复要求。
- 写入事实：`apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts:54-119,130-199,201-331`；store 与 30 天保留：`apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts:16-18,334-350,383-390`。
- 存储端口：`apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts:982-1051,1070-1076`。
- builder / RPC：`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/usage-stats-builder.ts:82-240`；`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:1763-1817`。
- schema 与 v4：`packages/shared/src/usage-stats.ts:5-7,15-95`；`packages/shared/src/zcode-protocol-v4/transport.ts:338-342,737-748`。
- 页面分派缺口与保留导航：`packages/ui/src/SettingsPage.tsx:982-1089`；`packages/ui/src/settings/settingsPageConfig.ts:145-149`。色板：`packages/ui/src/settings/usage-stats/appUsageChartPalette.ts:1-14`。本次评审补充的 Host/workspace 路由证据：`packages/services/src/zcode-agent/zcodeAgentPluginParams.ts:7-12`、`packages/ui/src/hooks/useWorkspaceServices.tsx:127-145`、`packages/ui/src/hooks/useServices.tsx:20-26`，以及本地 management carrier 模式 `packages/services/src/zcode-agent/zcodeAgentService.ts:414-420,2351-2385`。
- i18n 现存键及 143/143、无不成对 key：`packages/ui/src/i18n/locales/zh-CN.ts:2551-2752`、`packages/ui/src/i18n/locales/en-US.ts:2684-2894`；计数与集合差异以本次对两 locale 的 `settings.usage.*` key 集合检查为准。
- 设计约束：`DESIGN.md:6-17,19-49,164-175,187-233,262-280,484-507`。
