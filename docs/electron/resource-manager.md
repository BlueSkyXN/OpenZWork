# Resource Manager — 资源管理器

本文说明 OpenZWork 桌面资源窗口的现行接口、采样所有者与测试入口。

## 功能概述

桌面端通过 macOS 原生 Help 菜单或桌面帮助菜单（`WorkspaceHelpMenuButton`）打开同一个独立窗口。Web 不提供该窗口入口。窗口有 **CPU、内存、存储** 三个 tab。

- **CPU / 内存**：显示本机 OpenZWork 进程与系统占用，按基础服务、内置插件、社区插件分组。两个 tab 共用一份快照，每秒串行查询；切到存储页后停止采样。
- **存储**：显示存储服务解析出的本机 `.openzwork` 数据根及分类占用，支持扫描、下钻和按既有策略清理。数据根由 `packages/services/src/storage/adapters/rootsResolver.ts` 解析；窗口只消费扫描结果。
- **进程归属**：Host 直管的内置插件、`mcpSource: "builtin"` 的 MCP 子树及 Browser Use guest renderer 归入内置插件；其它 MCP 子树归入社区插件；Electron、Host、Agent 与普通工具子进程归入基础服务。原生 Computer Use 已退役。

网络页及其跨 Main/Host/CLI 采集链已移除，迁移说明见 [网络页退役与诊断入口](resource-manager-network.md)。

## 本地诊断职责

| 入口                                                      | 数据与所有者                                                              | 启动与输出边界                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 资源窗口 CPU / 内存                                       | Window Host 采样，Main 合并 Electron 和系统指标                           | 页面观察时启用；切页、关窗或 renderer 退出后取消；不创建远端 Agent                       |
| 资源窗口存储                                              | Main 持有 `StorageService`，Worker 遍历文件                               | 存储页发起扫描并可取消；清理由显式操作触发                                               |
| [设置中的 App Usage](../spec/app-usage-settings.md)       | 本机 Agent SQLite 使用事实，service 只转发读取                            | 仅已确认的 Desktop Local Host 可查询；保留 token、错误率、TTFT、回合耗时，不维护云端账本 |
| [本地日志导出](../desktop/log-export-retention.md)        | Desktop `exportLogs()` 收集既有日志与配置，脱敏后生成 ZIP，失败时回退目录 | 帮助菜单或平台导出动作触发；归档留在本机                                                 |
| [ModelIO 保留设置](../model-io-full-retention-setting.md) | CLI ModelIO writer 按 App 偏好记录模型请求与响应                          | 全量保留默认关闭；关闭时沿用有界记录，凭据脱敏在两种模式下均保留                         |
| CLI debug 网络调试                                        | `apps/zcode-cli/packages/debug/server/network-capture.ts`                 | 属于独立 debug server；配置和代理生命周期由该工具管理，资源窗口不启动它                  |

产品遥测的 ARMS、OTLP 上传与专属采集链保持移除。上述本地读取、归档、业务使用事实和开发工具沿用各自入口。

## 存储 tab 数据通路

该窗口按设计不接 RPC / MessagePort（见 `preload/resourceManager.ts`），因此存储服务不走 Window Host，而是由 **main 进程持有唯一的 `StorageService` 实例**（`@zcode/services` 的 storage 模块），遍历放在 `worker_threads` 里（entry `main/storageScanWorker`），不阻塞 main 事件循环；这与「main 禁止起外部进程采样」不冲突，扫盘只是 fs 遍历。

```
Resource Manager Renderer            preload (window.resourceManager.storage)        Main
  │ 切到存储 tab → startScan() ──────► ipc invoke StorageStartScan ─────────────────► resourceManagerStorage.ts
  │                                                                                   │ 懒创建 StorageService(Worker runner)
  │◄─ subscribeScanProgress ◄──────── ipc on StorageScanProgress ◄────────────────── │ onScanProgress → webContents.send
  │ 切走 / 关窗 → cancelScan(jobId) ─► ipc invoke StorageCancelScan ────────────────► │ 窗口 closed 也会取消最近 job
  │ clean({rootId,categoryId}) ─────► ipc invoke StorageClean ─────────────────────► │
  │ revealPath(abs) ────────────────► ipc invoke StorageRevealPath ────────────────► │ 校验路径在数据根内 → shell.showItemInFolder
```

- 通道：`PlatformChannels.StorageStartScan / StorageCancelScan / StorageGetSnapshot / StorageClean / StorageRevealPath`（invoke），`StorageScanProgress`（main → renderer 推送）。
- 类型：`packages/shared/src/storage.ts`（`StorageUsageSnapshot`、`StorageManagementBridge` 等），services / main / UI 共用。
- UI：`packages/ui/src/resource-manager/storage/*`，`useStorageUsage({ bridge, enabled: tab === "storage" })`。

## 口径

- **CPU 统一为整机归一化百分比**：`100%` = 整机所有逻辑核心全部占满。左侧灰色条即 `os.cpus()` 两次采样间 busy/total；OpenZWork 占用 = 所有进程行 CPU 之和；各进程行也用同一口径，因此分组小计与总计可以直接相加。旧版进程监视器在 macOS 上按 Activity Monitor（单核 = 100%）展示，本版不再沿用。
  - Electron 自身进程来自 `app.getAppMetrics().cpu.percentCPUUsage`：darwin / win32 已是整机口径；linux 上 Chromium 返回单核口径，进入快照前除以逻辑核心数（`normalizeElectronCpuToMachinePercent`）。
  - 外部进程（Agent / MCP / 终端）由 Host 侧采样器按 `Δcputime / Δwall / 逻辑核心数` 计算，首个样本没有差分基线，CPU 记 0。
- **内存**：Electron 进程用 `workingSetSize`；外部进程用 RSS（macOS/Linux）或 WorkingSet（Windows）。整机总量 `os.totalmem()`，整机已用 `total - os.freemem()`（macOS 上与 `top` 的 PhysMem used 同口径，包含文件缓存）。
- Chromium 进程之间的共享内存会被重复计数，与 Task Manager / Activity Monitor 的进程列表一致，不做去重。
- 远程 workspace（SSH/WSL/Docker/Server）的 Agent 运行在远端，不在本机可观测范围内，不展示。

## 架构

```
Resource Manager Renderer         Main (Electron)                 Window Host (utility)                 Agent CLI
   │ 1s 轮询                          │                                 │                                    │
   │─ invoke GetResourceUsageSnapshot ►│                                 │                                    │
   │                                  │─ ResourceUsageSnapshotRequest ─►│  (fan-out 到每个存活 Host,          │
   │                                  │   {requestId}                   │   900ms 超时, 超时用上次结果)        │
   │                                  │                                 │─ 异步 ps / /proc / CIM ────┐        │
   │                                  │                                 │◄───────────────────────────┘        │
   │                                  │                                 │─ request process/childProcesses ───►│
   │                                  │                                 │◄─ {processes:[{pid,serverName,     │
   │                                  │                                 │     mcpSource,pluginName?}]}        │
   │                                  │                                 │  按 Host 子树归属: agent / mcp 根   │
   │                                  │◄─ ResourceUsageSnapshotResult ──│                                    │
   │                                  │   {requestId, processes[]}      │                                    │
   │                                  │ + app.getAppMetrics()           │                                    │
   │                                  │ + os cpu/mem 总量               │                                    │
   │                                  │ + Agent 注册表兜底 (未采到=0)    │                                    │
   │◄──────── ResourceUsageSnapshot ──│                                 │                                    │
```

### 只读采样生命周期与回归约束

- Main 的资源管理器窗口是采样启停的唯一 owner：CPU/内存页挂载后启用；切到存储页、窗口关闭或 renderer 退出时停用。未启用或非该窗口发来的查询不得向 Host 发请求。
- 每个 Host 最多一轮在途采样。Main 的 900ms 展示等待超时只返回缓存，不追加采样；完成后才允许下一轮。停用时按 requestId 取消在途请求，迟到结果不得写回缓存或投影。Host 不保存采样队列。
- `process/childProcesses` 是 observation 请求：只查询已经存在且存储已就绪的 runtime，不等待迁移、不启动进程；失败、超时和取消只影响该次查询，不发布 runtime 故障、不回收进程，也不刷新业务空闲计时。普通业务 RPC 的 watchdog 保持原有语义。
- Host 将取消传到进程表读取和 CLI 查询；取消只终止本次采样创建的辅助命令，不能终止被观察的 Agent/MCP。Linux 文件读取完成后的迟到结果也必须丢弃。
- 采样只覆盖本地进程，不创建远端连接，不改变桌面 continuous / 手机 replayable 的业务消息恢复边界。

```text
CPU/内存页 → Main 启用 → 单轮 Host 采样 → OS 进程表 + CLI observation
切页/关窗 → Main 停用 → cancel(requestId) → 取消 IO/查询，丢弃迟到结果
CLI observation 超时 → 本轮无映射；Agent 生命周期与业务 idle 计时不变
```

验收：未打开零查询；慢采样不积压；切页/关窗取消在途且不再查询；重新打开不接收旧结果；观测超时后业务请求仍可执行；观测成功或挂起均不延长 mcp-status 的空闲寿命。

### 为什么这样分层

- **main 进程禁止起外部进程采样**（历史 bug：同步 `ps` / PowerShell 曾把整个 App 卡死；异步 `execFile` 的 CreateProcess 阶段同样会阻塞 main）。所以外部进程的 CPU/内存一律在 **Window Host（utility 进程）** 内异步采样，且只在资源管理器窗口发起请求时才采样；窗口关闭后 Host 不再有任何周期性开销。
- **MCP 插件归属由 CLI 提供**：`McpTelemetryTracker.listProcesses()` 读取现有进程注册表，`process/childProcesses` 返回 pid、来源与插件名；Host 用该映射完成归属。Host 直管的内置插件由 Host 自身的 pid 注册表补充。
- **Host 做进程树归属**：Host 是 Agent 的父进程，一次 `ps -axo pid=,ppid=,rss=,cputime=,comm=`（darwin）/ 扫描 `/proc/*/stat` + `/proc/<pid>/status`（linux）/ `Get-CimInstance Win32_Process`（win32）就能覆盖 Host 全部后代。每个后代按“最近的已知祖先”归属：MCP 根 pid → 对应插件；Agent pid → 基础服务 `cli`；无归属 → 基础服务 `host` 子进程。
- **main 只合并**：`app.getAppMetrics()`（Electron 进程）+ 系统总量 + Host 回报；Agent 注册表里已知但 Host 尚未回报的 Agent 仍会出现在列表中（`sampled=false`，指标为 0），保证拓扑始终可见，E2E 也依赖这一点。

### 数据类型（`packages/shared/src/protocol.ts`）

```ts
type ResourceUsageCategory = "base" | "builtin-plugin" | "community-plugin";

interface ResourceUsageProcess {
  pid: number;
  name: string; // zcode-main / zcode-renderer-main / zcode-agent-<provider>-<ws> / MCP server name / 命令名
  category: ResourceUsageCategory;
  groupKey: string; // base: main|gpu|renderer|host|cli|utility；插件: 插件名或 MCP server name
  groupLabel: string; // 分组展示名（插件名 / server name）
  cpuPercent: number; // 整机归一化
  memoryBytes: number;
  sampled: boolean; // false = 仅拓扑已知，指标尚未采到
}

interface ResourceUsageSnapshot {
  sampledAt: number;
  logicalCpuCount: number;
  system: { cpuPercent: number; memoryTotalBytes: number; memoryUsedBytes: number };
  app: { cpuPercent: number; memoryBytes: number }; // = processes 之和
  processes: ResourceUsageProcess[];
}
```

### CLI 查询协议（`packages/shared/src/zcode-protocol/index.ts`）

- `zcodeProtocolMethods.processChildProcesses = "process/childProcesses"`，params `{}`。
- 结果 `zcodeProcessChildProcessesResultSchema`：`{ processes: Array<{ pid, serverName, mcpSource: "builtin"|"plugin"|"custom", pluginName?: string }> }`。
- CLI 实现：`McpTelemetryTracker.listProcesses()` 直接读取已注册连接的 `process.pid`、`serverName`、`mcpSource`；`pluginName` 由 `plugin:<name>:<key>` 命名空间或官方插件 `hostMcpServerNames`（`node_repl` → `browser-use`）解析。不做任何 I/O。

### main ↔ host 消息

- main → host `HostMessageTypes.ResourceUsageSnapshotRequest { requestId }`。
- host → main `HostResponseTypes.ResourceUsageSnapshotResult { requestId, sampledAt, processes: HostResourceUsageProcess[] }`，其中 `HostResourceUsageProcess = { pid, name, category, groupKey, groupLabel, cpuPercent, memoryBytes }`。
- 校验在 `packages/shared/src/validation.ts` 的 `hostIncomingMessageSchema` / `hostResponseMessageSchema` 中。

### Host 侧采样（`packages/services/src/process/processResourceSampler.ts`）

- `createProcessResourceTableReader()`：创建接收 AbortSignal 的异步进程表读取函数，返回 `{ pid, ppid, rssKb, cpuTimeMs, command }`。macOS 的 ps 限时 3s、Windows CIM 限时 5s；Linux 读取 `/proc`。采样失败或取消由 Host 丢弃本轮结果。
- `createProcessResourceSampler()`：保存上一轮各 pid 的 `cpuTimeMs` 与时间戳，输出整机口径 `cpuPercent`；pid 消失后基线自动淘汰。
- `attributeHostProcessTree()`（纯函数）：输入进程表、Host pid、Agent 列表（pid/workspacePath/provider）、各 Agent 的 MCP 子进程映射，输出 `HostResourceUsageProcess[]`。

Host 入口 `packages/desktop/src/host/hostResourceUsage.ts` 把上述三者与 `IZCodeAgentService.collectLocalRuntimeChildProcesses()` 串起来，收到请求后回帖结果。

## 架构治理决策记录

当前采样链的所有者与边界：

```text
owner:            main 进程 resourceManagerWindow（Host / Agent pid 注册表 + 快照合并）；
                  外部进程指标的瞬时事实由 Window Host 采样器持有（cputime 差分基线）；
                  MCP 子进程 ↔ 插件映射只由 CLI McpTelemetryTracker 持有
command path:     renderer invoke GetResourceUsageSnapshot → main buildResourceUsageSnapshot
                  → HostMessageTypes.ResourceUsageSnapshotRequest → host createHostResourceUsageResponder
                  → CLI process/childProcesses（纯内存）
derived views:    ResourceUsageSnapshot（main 合并 Electron 指标 + 系统总量 + Host 回报）；
                  UI 的 groupResourceUsage 只做分组/排序/格式化，不持有任何指标状态；
                  main 的 lastHostResults 是超时兜底缓存，不是第二份事实源
ordering:         每个 Host 最多一轮在途采样；Main 超时返回缓存但复用原 requestId，Host 不排队；
                  活跃请求迟到回帖可更新缓存，取消后的回帖丢弃；pid 复用靠 command 变化 / cputime 倒退重建基线
idempotency:      请求无副作用，可任意重放；Host 不维护定时器，窗口关闭后零开销
delivery:         desktop-only（独立 BrowserWindow + 专用 preload）；不接 conversation continuous / replayable 链路
reuse decision:   未复用 services/process/processTreeSnapshot.ts（同步 spawnSync，为 app quit 设计，列不同）
                  资源采样需要异步 cputime 差分并在 Host 内执行；
                  PowerShell CIM 命令格式与 processTreeSnapshot 相近，职责保持独立
contracts/spec:   packages/shared protocol.ts / channels.ts / validation.ts / zcode-protocol；本文；
                  本文末尾列出的 Desktop、Services、UI、CLI 当前回归
```

## 文件清单

| 文件                                                                                                                                        | 职责                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/resourceManagerWindow.ts`                                                                                        | 单例窗口、Host / Agent 进程注册表、`buildResourceUsageSnapshot()`、系统 CPU 差分                           |
| `packages/desktop/src/main/resourceManagerHostSampling.ts`                                                                                  | main → Host 采样 fan-out：requestId 关联、900ms 超时、上一轮结果兜底                                       |
| `packages/desktop/src/main/resourceManagerProcessNames.ts`                                                                                  | 非 BrowserWindow renderer（WebContentsView / DevTools / webview）的显示名                                  |
| `packages/desktop/src/main/desktopHostProcess.ts`                                                                                           | 转发 `ResourceUsageSnapshotResult`；采样 fan-out 由 `resourceManagerHostSampling.ts` 负责                  |
| `packages/desktop/src/host/hostResourceUsage.ts`                                                                                            | Host 侧采样 + 归属 + 回帖                                                                                  |
| `packages/desktop/src/preload/resourceManager.ts`                                                                                           | 暴露 `window.resourceManager.getSnapshot()` 与 `window.resourceManager.storage`（StorageManagementBridge） |
| `packages/desktop/src/main/resourceManagerStorage.ts`                                                                                       | 存储 tab 的 ipc 面：持有 StorageService、进度推送、关窗取消、定位路径校验                                  |
| `packages/desktop/src/main/storageScanWorker.ts` / `storageScanWorkerClient.ts` / `storageScanWorkerProtocol.ts`                            | 扫描 Worker 入口与 ScanRunnerPort 实现                                                                     |
| `packages/ui/src/resource-manager/storage/*`                                                                                                | 存储 tab UI（磁盘卡片、类别列表、明细、清理确认）与 `useStorageUsage`                                      |
| `packages/desktop/src/renderer/resource-manager.html` / `src/resource-manager.tsx`                                                          | 独立 renderer 入口，挂载 `@zcode/ui` 的 `ResourceManagerApp`                                               |
| `packages/ui/src/resource-manager/ResourceManagerApp.tsx`                                                                                   | 窗口 UI（指标卡 + 分组列表），组件放在 `packages/ui` 内以纳入 Tailwind 扫描                                |
| `packages/ui/src/resource-manager/resourceUsageView.ts`                                                                                     | 分组聚合与格式化纯函数                                                                                     |
| `packages/services/src/process/processResourceSampler.ts`                                                                                   | 跨平台进程表读取、CPU 差分、进程树归属                                                                     |
| `packages/services/src/zcode-agent/zcodeAgentService.ts`                                                                                    | `collectLocalRuntimeChildProcesses()`                                                                      |
| `packages/shared/src/protocol.ts` / `channels.ts` / `validation.ts` / `zcode-protocol/index.ts`                                             | 类型、IPC 通道、host 消息 schema、CLI 协议                                                                 |
| `apps/zcode-cli/packages/adapters/src/mcp/telemetry.ts` / `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/process-child-processes.ts` | `listProcesses()` 与 `process/childProcesses` 处理                                                         |

## UI 细节

- 顶部 tab 用 `Tabs variant="line"`（与设置页插件 tab 同款胶囊触发器），test id `resource-manager-tab-{cpu|memory|storage}`；默认 CPU。
- 窗口 900×600，系统默认标题栏；主题与字号沿用主窗口的 `localStorage`（`zcode-theme` / UI font size），语言用 `ZCodeIntlProvider` 的本地偏好。
- 指标卡：`bg-card border-card-border rounded-xl`；进度条底色 `bg-surface-hover`、整机段 `bg-foreground-subtlest/40`（灰）、ZCode 段 `bg-brand`（彩）。
- 分组：三组固定顺序（基础服务 / 内置插件 / 社区插件），组头显示进程数、CPU 小计、内存小计；空组显示“暂无进程”。默认展开三组，可分别折叠；展开状态只存组件内。
- 列表行：名称（`font-medium`，`title` 为完整名）、PID（`font-mono`）、CPU、内存；未采样行 CPU/内存显示 `—`。
- 刷新频率 1s；请求串行（上一轮未返回不叠加）。
- 无 `window.resourceManager` 桥时展示“资源管理器接口不可用”。

## 测试入口

以下路径均相对仓库根目录；用例存在与某次运行通过分别记录。

| 范围                           | 当前测试文件                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 快照、窗口生命周期与 Host 请求 | `packages/desktop/test/resourceManagerWindow.test.ts`、`resourceManagerLifecycle.test.ts`、`resourceManagerHostSampling.test.ts`、`hostResourceUsage.test.ts`（同目录）         |
| 进程采样与树归属               | `packages/services/test/processResourceSampler.test.ts`                                                                                                                         |
| 轮询、分组与格式化             | `packages/ui/test/resourceManagerPolling.test.ts`、`resourceUsageView.test.ts`（同目录）                                                                                        |
| 存储扫描与界面状态             | `packages/services/test/storageService.test.ts`、`packages/ui/test/resourceManagerStorageUsage.test.ts`、`resourceManagerStoragePresentation.test.ts`（与前一个 UI 测试同目录） |
| CLI 子进程映射                 | `apps/zcode-cli/packages/adapters/tests/mcp-telemetry.test.ts`                                                                                                                  |

历史独立 E2E `resource-manager.test.ts` 与 `resource-manager-storage.test.ts` 已不在当前树中，不列为现行执行入口。`packages/desktop/test/e2e/helpers/resource-manager.ts` 是供其它场景使用的窗口查询 helper。
