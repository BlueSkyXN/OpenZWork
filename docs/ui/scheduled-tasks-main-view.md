# 定时任务主视图入口

# 目标

定时任务管理从设置页分区迁移为 workspace 主视图入口。用户在左侧点击「定时任务」后，左侧仍保持 workspace 队列 / 任务列表，右侧主内容切换为定时任务管理页。

# 产品语义

- 定时任务属于当前 workspace 的工作流管理，不属于全局设置。
- 打开定时任务不创建 Settings tab，不改变左侧队列列表，不卸载 workspace sidebar。
- 选择任务、新建任务时，右侧主内容回到聊天或对应 workspace 主视图。
- 定时任务页继续复用现有 `AutomationsSection`，按 `workspaceIdentity?.trim() || workspacePath` 加载对应 workspace 的 automations。

## 立即运行语义

- 「立即运行」是独立的 manual run，不是把 cron 的 `next_run_at` 改成当前时间；不得修改原计划的 `next_run_at`、`run_count`、启停状态或生命周期。
- 定时调度实际触发和用户点击「立即运行」产生的 prompt，都必须在用户消息气泡上方展示与左侧任务列表一致的时钟图标和「由定时任务发送」来源文案。消息级来源以持久化 `userInput.sourceCommandId` 对应的 automation runId 为准：`automationId:scheduledAt`（`trigger=schedule`）与 `automationId:manual:uuid`（`trigger=manual`）均展示；同一 cron 会话内的普通手动输入不展示。该标识由 row 自身推导，桌面 continuous 与手机 Web replayable 恢复保持一致，不读取 task 上粘性的 `cronAutomationId`。
- 当前 desktop host 必须在 `runAutomationNow` RPC 内直接恢复或创建目标会话并提交 prompt。正常路径不经过 scheduler 的轮询、wake 或二次认领；RPC 成功只表示 prompt 已被 host 接受，可能仍处于 runtime queue。
- `runAutomationNow` 必须在认领前确认当前 service 已注入 manual dispatcher；dispatcher 缺失时直接失败，
  不创建 `automation_runs` 台账、不设置 `running` claim。能力确认后 manual run 才写入台账；若 host 在
  认领后的派发过程中崩溃，scheduler 只可在认领超时后回收该台账作为故障恢复，不得影响原 cron 节奏。
- manual run 的 automation `running` single-flight 锁必须覆盖 queue 等待和实际 turn：`sendPrompt`
  admission 后继续持有，直到对应 `runId/inputId` 的 `turn.completed` / `turn.failed` 终态才释放。
  同一 automation 在锁持有期间再次 Run Now 必须拒绝，不得向同一 task 追加第二条 queued prompt。
- scheduler 仅用于 stale manual run 的故障恢复。恢复派发收到 host `cron-dispatch-result ok` 时只回写
  `automation_runs.dispatch_status = dispatched`，不得释放 manual claim；host 已建立的 terminal outcome
  subscription 与 heartbeat 接管后续生命周期，并在真实 turn 终态释放。只有 dispatch result 失败时
  scheduler 才立即释放 claim。
- `runAutomationNow` 管理 RPC 必须显式返回 `queued` 或 `duplicate`。只有本次成功创建并派发 manual run
  的 `queued` 才展示「已触发」成功提示；single-flight 拒绝的 `duplicate` 展示「上一条正在运行」
  信息提示，但不刷新列表、不得重复展示成功提示。禁止把无内容的 RPC success 同时解释成这两种状态。
  UI 只在本次 RPC 请求尚未返回时使用瞬时操作态防止同步重入；请求返回后立即恢复「立即运行」入口，
  不根据运行历史持续禁用或轮询入口状态。活动 run 的重复触发统一交由 host single-flight 返回
  `duplicate`，并由 UI 展示上述信息提示。
- terminal outcome 回写或 claim 释放失败只记录独立错误，不得覆盖原始 dispatch / turn 结果；host
  存活且 run 仍在 queue / running 时必须定期续租 `claimed_at`，避免长任务被 stale 误释放；host
  崩溃后续租停止，再依赖 stale claim 回收。
- 会话内创建的定时任务若目标 session 当前未激活，直接派发前必须先恢复该 session，再应用任务保存的权限、模型和思考强度。
- UI 手动创建且未绑定会话的任务，执行时新建的空 session 必须使用 deferred persistence；首条 `sendText` admission 先持久化 session 主记录，再写带外键的 `session_input`，禁止用延时规避创建/首发提交顺序。
- automation 派发创建或恢复带 `automationId` 的执行 task 时，必须通过 session
  `toolDenylist: ["CronCreate", "CronUpdate", "CronDelete"]` 在 runtime 工具注册边界隐藏
  automation 写工具，只保留只读 CronList 与只作用于本轮 automation 的 CronPauseSelf。不要把
  runId 写入 task meta：
  runId 属于 `automation_runs` 台账，写进 task meta 会污染 UI 立即执行和绑定会话恢复路径。
- 对已经 active 的绑定会话，`session/resume` 不会重建 runtime；host 派发 prompt 时还必须把
  `automationId` 随本轮 `sendText/sessionSend` 透传。该字段必须来自 Host 调度派发，`inputId`/runId
  只用于追踪和幂等，不能恢复或替代授权身份。CLI 在该 turn 的 provider 请求中临时移除
  `CronCreate/CronUpdate/CronDelete`，让模型无法递归创建、自改或自删；`activeAutomationId` 与
  `automation-port` 的 CronCreate 拒绝逻辑继续作为伪造创建调用的兜底，命中时不得调用
  `automation/create`。同一个 `automationId` 也是 `CronPauseSelf` 的唯一目标来源，普通用户轮
  不暴露该工具，规则见 `docs/automation-edit-status.md`。turn 结束后恢复原工具面，普通用户输入不受影响。
- Highspeed 期间仍允许用户调用 `CronCreate`；创建记录保存会话稳定 `modelSelection`，不保存当前 Turn
  指向加速卡内建 Provider 的临时选型。后续定时执行以 `automationId` 为最终门禁，使用记录中保存的
  provider/model，并忽略误传的加速 `modelSelection` / `modelExecution`，因此不会抽取、复用或安装
  Highspeed 卡。
- 若目标 session 正处于 active/routing busy，turn-scoped `toolDisallowlist` 必须随 automation 输入进入
  deferred queue item，并在 replay、重排和 drain 后原样传给 `startPromptTurn`；不得只在立即启动或
  `steerTurn` fallback 路径隐藏 automation 写工具。
- 已归属定时任务的 task（`cronAutomationId` 已写入 task meta）后续普通用户输入也必须随
  `sendText/sessionSend` 下发 turn-scoped automation 写工具隐藏规则，防止下一次 model step 绕过
  当前任务的归属边界继续创建、自改或自删。

```text
runAutomationNow RPC
  -> INSERT manual automation_run（不触碰 automation.next_run_at）
  -> desktop host resume/create task（新 session 使用 deferred persistence，automation 执行 task 隐藏写工具）
  -> apply mode/model/thought
  -> sendPrompt（本轮携带 automationId；可能 queued）
  -> ACK: 回写 dispatched，继续持有 running claim
  -> queue drain / turn start
  -> turn terminal: 回写 outcome，按 workspaceKey 释放 manual claim

scheduler stale recovery
  -> host sendPrompt ACK / cron-dispatch-result ok
  -> scheduler 只回写 dispatched，不释放 claim
  -> host heartbeat + terminal subscription
  -> turn terminal: host 释放 manual claim

busy session
  -> enqueueDeferredInput(toolDisallowlist=[CronCreate,CronUpdate,CronDelete])
  -> queue replay / drain
  -> startPromptTurn(toolDisallowlist=[CronCreate,CronUpdate,CronDelete])
  -> 保留 Host 显式注入的本轮 automationId（不从 inputId/runId 推导）
  -> provider automation tools 只保留 CronList + CronPauseSelf

第二次 Run Now（首个 run 未终态）
  -> repo.runNow 看到 running=1
  -> RPC 返回 duplicate / no-op，不创建第二条 manual run
  -> 展示“上一条正在运行”信息提示，不展示“已触发”成功提示
```

# UI 边界

```text
窗口
┌────侧边栏────┬──────── Automations main ────────┐
│              │              Toast               │
│              │                │                 │
│              │          main 横向中心            │
└──────────────┴──────────────────────────────────┘

main resize / layout scroll
            │
            ▼
getBoundingClientRect()
            │
            ▼
body portal 更新 fixed left
```

```text
用户选择 task A
      |
      v
[task A] --打开 Automations--> [automations / automationId?]
      ^                              |
      |----------- 后退 ------------|
      |----------- 前进 ------------>

历史条目身份：workspaceIdentity?.trim() || workspacePath
路径执行语义：workspacePath
```

- 自动化主视图与编辑页复用共享菜单规则：Dropdown Menu、Context Menu 与 Select 浮层中的相邻选项统一保留 2px 纵向间距；创建方式、任务操作、工具栏和调度选择不得再各自覆盖为无间距列表。
- 新建表单既没有 canonical conversation workspace、也没有有效本地项目候选时，工作区选择必须收敛为 `null`，以普通弱提示引导用户先打开可用项目，并禁用创建；模型预览和提交边界均不得回退到 `defaultWorkspacePath` 或不可用目录。候选恢复后优先保留仍有效的当前选择，其次选择仍在候选中的默认目标，最后选择首个有效目标。编辑已有任务不受当前候选过滤影响，继续使用任务已持久化的 `workspacePath` / `workspaceIdentity`。
- 桌面远程 workspace 的「通过对话创建」不得绕过本地项目限制；手机 `/remote` 完全隐藏 Automations 导航和路由，陈旧路由回退聊天。
- 「通过对话创建」切回当前 workspace 的会话草稿时，输入框预填可直接发送的 Showcase“每个工作日 9 点，汇总当前项目的代码变更和待跟进事项。”，用一句话示范“周期 + 项目范围 + 任务目标”，但不得自动发送；用户可继续修改。桌面 continuous 与普通 Web 草稿使用同一预填语义，手机 `/remote` 不暴露该入口。
- 工作区选择器必须传递完整 workspace 身份，选中态、模型预览、保存和派发统一按 `workspaceIdentity?.trim() || workspacePath` 判定，禁止只传 `workspacePath` 后反查候选。它复用普通会话的工作区菜单时，定时任务项目 chip 不显示脱离项目的 `X`，但下拉菜单必须保留一个「不在项目中工作」固定项，并复用会话侧文案、`MessageCircle` 图标和选中态；conversation backing workspace 不得再作为普通项目行渲染。进入已有任务详情时也必须按 automation 的 workspaceKey 与当前 canonical conversation workspace 候选匹配恢复 purpose：匹配成功后锁定的项目字段继续展示「不在项目中工作」和 `MessageCircle`，不得退化为 `default` 与项目文件夹图标；无法匹配的历史目标才回退到普通路径名称。普通会话草稿仍保留 `X` 与「不在项目中工作」，不得为了定时任务修改全局 hover/focus 交互。
- 会话轮尾的定时任务创建卡片是本轮工具结果的最终状态投影，不是所有成功 `CronCreate` 的历史列表。
  UI 必须按 `automationId` 顺序归并成功的 `CronCreate` / `CronDelete`：后续成功删除会移除对应创建卡片，
  删除失败或取消不影响卡片；普通工具历史仍完整展示。多个未被删除的创建结果继续按创建顺序展示。
  `CronPauseSelf` 只出现在 automation 执行轮，以通用工具行展示，不生成也不移除卡片；暂停后的状态
  在列表挂载或手动刷新时读取。
- 会话内 `CronCreate` 成功卡片点击「去到定时任务」时，必须携带结果中的 `automationId` 进入定时任务主视图；列表数据就绪后直接打开对应任务详情，而不是停留在列表。导航目标是 renderer-local 一次性状态：成功定位后立即消费；列表加载完成仍找不到目标时提示任务不存在、消费意图并停留列表，避免失效意图长期保留。该状态不得进入 relay、main 或 session realtime 状态。
- 已创建任务区最多同时展示 8 张卡片；桌面双列展示 4 行，手机单列展示 8 行，超出部分在卡片区内纵向滚动查看，不改变任务的数据加载和排序。
- 已创建任务卡片不展示所属项目名称或文件夹图标，保持标题、指令、运行状态与次数为主要信息；任务的 workspacePath / workspaceIdentity 仍保留用于编辑、执行和隔离。
- 卡片的「下次运行」时间在 1 个月内展示相对时间；超过 1 个月展示本地绝对时间，避免远期任务出现难读的超大天数。
- 已创建任务区与下方「更多灵感」之间使用整宽分割线区分内容层级；分割线使用与 Card 描边一致的 `card-border` 语义颜色，保证 Light / Dark 下层级清晰。

<!-- 闲时任务按钮/名额与首页 Client Scenes 云端模板（scheduled-task scene，营销触达域）属净化域，相关条目不随上游引入；其余 Automations UI 规则随上游 -->

- 模板图标把远程 prompt item 的 `img` 解释为 Lucide canonical 名称并按名动态加载，不再发起图片 URL 请求。SVG 使用 `currentColor` 继承图标槽字色；空白值、未知名称或模块加载失败都进入本地回退。回退图标继续按远程 item id 的已知任务语义映射为 Lucide：morning/standup 使用 `Target`、risk/CI 使用 `Activity`、release/file 使用 `FileText`，其它动态模板统一回退 `List`；`imgs` 不参与图标选择，也不得为未知服务端模板临时引入页面内近似图标。
- Settings 页当前仍通过 `settingsPageConfig.ts` 暴露 Automations 分区，并直接渲染 `AutomationsSection`；该入口没有工作区主视图的 Automations `main` 锚点，因此其 Toast 必须走全窗口居中回退。若未来移除此兼容入口，再同步删除本条事实说明。
- 定时任务主视图不渲染 `WorkspaceHeader` 或草稿标题栏占位，避免出现聊天 / 项目顶部栏。
- 定时任务管理操作失败时，底层 RPC / Agent 错误只写入 UI logger 供诊断；主视图不得把原始错误以持久红色横幅或原文 toast 暴露给用户。用户侧仅显示与当前动作对应的简短本地化提示，避免重复反馈和泄露 session、command、reasoning effort 等实现细节。
- 自动化管理 UI 统一上报三个可通过 `automation_id` 关联真实运行结果的生命周期事件：手动创建接口终态 `automation_create_result`、确认立即运行意图 `automation_run_now_ck`、确认删除意图 `automation_delete_ck`。事件区域固定为 `app.automations`，列表与编辑页通过 `action_source` 区分且不得重复上报；模板创建携带配置平台下发的稳定 `template_id`，`item-*` 原值透传，不兼容或归一化为旧的无前缀本地 ID。不得上报标题、任务指令、工作区信息或完整 endpoint，自定义 provider 只允许携带 hostname；埋点失败不得中断业务流程。
- `automation_create_result`：成功时 `error_code` / `error_msg` 均为空；失败时 `error_code` 为固定枚举 `limit` / `timeout` / `network` / `auth` / `validation` / `unknown`。只在本地按已知错误码或错误模式匹配分类，匹配顺序同上述枚举；不能识别或没有错误文本时使用 `unknown`，不宣称精确根因。`error_msg` 非空原文为 `[redacted]`，空值保持空，不上传路径、URL、凭据或原文片段。
- `agent_step` 中成功完成的 `CronCreate` 工具步骤必须携带该工具结果新生成的 `automation_id`；执行中、失败、取消和其它工具不得猜测或携带该字段。该 ID 表示“本步骤创建出的任务”，不得与当前 automation 派发上下文的任务 ID 混用。
- 主视图容器使用普通 workspace 背景与受限内容宽度；桌面与普通 Web 模式保持同一布局语义，手机 `/remote` 按上面的产品边界隐藏 Automations。

```text
CronCreate(A) success  -> final cards: [A]
CronDelete(A) success  -> final cards: []
CronCreate(B) success  -> final cards: [B]
assistant turn complete -> render [B]
```

# 兼容性

- 新建与编辑定时任务的标题、调度和 Instructions 输入外框统一参考设置搜索框：采用 large 输入尺寸、`h-9`（单行控件）、`rounded-xl`、`bg-input` 与 `border-input-border`，并继承标准输入的 hover/focus 边框状态。标题与 Instructions 内容使用 12px 内边距（`px-3` / `p-3`）；Schedule 保留 8px 紧凑内边距及原有删除操作位。复合输入内部工具栏和调度标签继续保留各自的紧凑层级。
- Schedule 行内的频率、日期、时间、自定义周期等子菜单触发按钮统一使用 `rounded-full` pill；展开后的菜单容器与菜单选项继续遵循标准 menu 样式，不改为 pill。

- 桌面端 `continuous` session 主链路不受影响；该改动只切换 UI 主视图，不修改 stream、snapshot、queue 或 owner command。
- 手机 Web 远控不展示 Automations，不新增独立 runtime、host 或远控业务状态。
- 远程 workspace 的存量任务继续按 `workspaceIdentity?.trim() || workspacePath` 隔离；本次不新增远程任务。
