# 已保存工作流查询的进程数量与生命周期（OpenZWork）

上游打开「自动化 → 工作流」时，每个项目组的两次读取（列表 + 运行历史）都会走
`getOrStartReadOnlyClient` 的 start-if-needed：按项目拉起并登记 chat lane 的 CLI，
且 chat manager 没有空闲回收。项目多时形成按项目的启动风暴与长期常驻。本 spec
定义 OpenZWork 的查询 lane：固定数据库条件下共用一个查询进程，空闲退出；Server/
远端保留项目隔离但同样空闲回收。补丁登记 OW-P024。

## 术语

- **lane**：一个独立 ProcessManager 管理的进程用途（chat / plugin / mcp-status / workflow-query）。
- **carrier（载体）**：启动 CLI 使用的 workspace（进程 cwd 与 manager key 的来源）。
- **target（目标）**：本次读取的真实项目；载体共用不改变 target，RPC 参数原样保留。

## 行为

### 1. 共享资格（Host 装配层唯一裁决）

新增仅供 Host 装配的开关 `shareLocalWorkflowQueryRuntime`（默认 false），经
`createLocalServices` 传入 agent service。UI / RPC 调用方不能自行开启。仅当全部满足：

- 本地 Desktop Host（`runtimeSurface === "desktop_local_host"`，非 desktop-attached remote）；
- 未注入自定义 `zcodeAgentCommandResolver`，且 Host 进程环境没有
  `ZCODE_AGENT_SERVER_COMMAND`（随包/本仓默认 resolver 链生效）；
- Host 进程环境有 Main 注入的**绝对** `ZCODE_SESSION_DB_PATH`（Main 在
  `buildHostProcessEnv` 删除旧别名 `ZCODE_SESSION_DB` 并固定该路径）。

时为 true。资格判定是纯函数（`workflow-query` 模块 contract），由 Desktop Host 调用；
判定依据是装配事实，不通过启动每个项目探测。

### 2. 载体与 key（两个 list 方法）

`listSavedWorkflows` 与 `listSavedWorkflowRuns` 中**带 workspacePath** 的分支改走独立
workflow-query manager：

| 条件                                                           | manager carrier / key                                                                            | RPC target                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 共享开关 true，且 target 无 `remoteSessionId`、identity 非远端 | `ensurePluginManagementWorkspacePath()` 所得管理面 carrier；`resolveWorkspaceKey` 后为固定单 key | `buildWorkspaceRef(params)` 原样（path/identity/remoteSessionId/workspaceKey/scope/name/limit 不变） |
| 其他带 workspace 的读取（共享关闭、自定义命令、远端/Server）   | 原 path/identity，按 `resolveWorkspaceKey(target)` 按项目分 key                                  | 原请求参数                                                                                           |
| 无 `workspacePath`（全局组）                                   | 原全局载体选择（活跃本地 runtime → 管理面）不变                                                  | 原全局参数                                                                                           |

其余三个读写方法（get / updateMeta / delete）与 move/save/forRun 保持原
`resolveSavedWorkflowCarrier` 路由。Server/远端因此保留启动峰值（最多 N 个查询 CLI），
但每个 key 独立空闲回收。

### 3. 生命周期

workflow-query manager：

- `lane: "workflow-query"`，`idleTimeoutMs` 默认 `5 * 60_000`（与 mcp-status 同源的
  既有常量语义；测试可注入短时值作确定性生命周期场景）。
- 转发控制面选项：commandResolver、presentationSurface、requestTimeoutMs、
  processLifecycleReporter、resolveSpawnEnv、waitForSpawnAdmission、spawnFallbackCwd；
  **不接入** `useSharedTaskRuntime`（查询载体不参与共享任务 runtime 分配）。
- 取得 client 后沿用 `wireClient(client, carrier, "workflow-query")`；两项请求保持默认
  operation 计数（不复用 activeClientsByWorkspaceKey、不加第二套队列/idle timer）。
- 加入 `collectLocalRuntimeChildProcesses`、`disposeAll`、`disposeAllAndWait`。
- 页面卸载不取消未完成的后端请求；新 lane 不借用/不销毁活动 chat，不进 chat active 表。
- 空闲回收沿用 manager 既有语义：pendingOperationRequestCount 归零且 storageStartup
  非等待时按既有关闭屏障回收整棵进程树；到期时有在飞请求/存储准备则等下次归零重计时。

### 4. lane 类型与资源样本

`PROCESS_RESOURCE_CLI_LANES` 追加 `"workflow-query"`（归 `cli_aux` 角色）。lane 由
Host 侧 wireClient 打标，CLI 不感知；旧远端样本无 lane 仍可接收。同版本 Desktop
Main/Host 同批发布；workflow-query lane 只在本地 Desktop Host 产生，远端 Host 不会
发出新枚举，旧 Desktop Main 不会收到未知 lane。

### 5. UI 读取状态（savedWorkflowStore）

- 列表错误与运行历史错误分别表达：`runsError` 独立于 `error`；历史读取失败时保留
  列表与上次已知 runs，显示可重试状态，不显示为「尚未运行」。
- 每个 store key 维护请求代际；成功/失败/loading 清理仅由当前代际写回。强制刷新
  （bypassCache）可与在途请求并发，旧代际结果不得覆盖新代际，也不得清掉新代际的
  loading。现有非 bypass 在途复用保留。
- 身份继续 `resolveWorkspaceKey`（remoteSessionId/scope 参与归属），不新增服务端身份
  或持久化 schema。

### 6. 数据条件与兼容

- Main 固定 DB：`ZCODE_SESSION_DB_PATH` 优先级（Env 40）高于用户（10）/项目（20）
  配置与旧别名；共享 carrier 打开的库与逐项目 carrier 相同。
- 自定义 command resolver / `ZCODE_AGENT_SERVER_COMMAND` / 改变实际数据库的启动配置
  走 false 分支（逐项目 key）。
- 结果内容与逐项目读取逐字一致：handler 以 RPC `workspace.workspacePath` 为扫描根，
  载体 cwd 不参与项目档判定；scope（缺省 project）、分页 limit、invalid 条目与产物
  归属不变。

## 状态所有者

| 状态                                 | 所有者                                              |
| ------------------------------------ | --------------------------------------------------- |
| 查询进程实例、idle timer、spawn 去重 | workflow-query `ZCodeAgentProcessManager`           |
| 共享资格事实                         | Desktop Host 装配（一次性，启动时）                 |
| 列表/历史读缓存与请求代际            | `savedWorkflowStore`（UI 局部状态，不是服务端事实） |
| 固定 DB 路径                         | Desktop Main（`buildHostProcessEnv`）               |
| chat lane 进程                       | 原 processManager（本 spec 不触碰）                 |

## 验收用例（A01–A11）

| ID  | 场景                                                                                           | 验证层                                                 |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A01 | Desktop 50 项目两项读取：workflow-query spawn=1、查询触发 chat spawn=0、各请求读到真实项目内容 | 服务场景回归（真实 Service/manager/CLI 子进程）        |
| A02 | 默认 5 分钟 idle 后完整进程树退出；重进再起一个                                                | 服务场景（实测一次默认值）+ 交错场景（短时注入）       |
| A03 | Env/用户/项目配置冲突、绝对/相对路径、目录缺失、custom command false 分支，结果等价            | CLI 配置回归（真实临时文件）+ 服务场景                 |
| A04 | 同名文件、project/global scope、远端同路径、错误与分页/artifact                                | 服务场景 + 既有 bootstrap 协议回归                     |
| A05 | 查询、离页与 idle 不影响活动任务                                                               | 服务场景 + E2E                                         |
| A06 | 并发启动、存储等待、新请求/退出交错、关闭失败与 Host teardown                                  | 服务场景（短时注入）                                   |
| A07 | Server/远端按项目隔离并空闲回收；峰值记 N                                                      | 服务场景（共享关闭分支）                               |
| A08 | 新旧 lane 枚举样本解析                                                                         | schema 回归（注册在服务场景文件内，标注证明范围）      |
| A09 | 项目查询与插件操作隔离；全局组保留原等待                                                       | 服务场景 + E2E                                         |
| A10 | runs 错误独立展示、可重试；旧请求不能覆盖新刷新                                                | UI store 回归（受控 service；不据此声称进程结论）+ E2E |
| A11 | 同 fixture ≥5 轮冷加载，项目组/完整总览中位数不高于基线，记录内存峰值                          | 性能 harness（真实 Service/CLI）                       |

## 回归入口

- 服务场景：`packages/services/test/workflowQueryRuntime.test.ts`（核心 CI，capability
  `workflow`）。
- CLI 配置：`apps/zcode-cli/packages/adapters/tests/config.test.ts`（ci.yml 点名）。
- CLI 读取协议：既有 `saved-workflows-protocol.test.ts` / `saved-workflows-run-protocol.test.ts`。
- UI store：`packages/ui/test/savedWorkflowStoreRefresh.test.ts`（受控 service 的状态
  回归，证明范围限 UI 状态机）。
- 桌面 E2E：`packages/desktop/test/e2e/automations-workflows-hub.test.ts` 扩充。

## 上游跟进与撤销

官方等效修复通过适用验收条目后，只保留一个实现并退役本模块/接线，回归保留。官方仅
修回收而保留启动风暴时，保留仍有必要的共享入口。跟踪面：两个读取点、全局选择、
Main DB/旧别名、配置优先级、spawn env、ProcessManager/client、CLI 请求队列、读取
handler 与 schema、lane 类型、Host 装配/关闭（见 OW-P024）。
