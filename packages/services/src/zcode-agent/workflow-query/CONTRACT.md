# workflow-query

已保存工作流「自动化 → 工作流」总览两项读取（workflows/list、workflows/runs）共用的
独立查询 lane。spec：docs/specs/saved-workflow-query-lifecycle-openzwork.md（OW-P024）。

## 公开面

- `contract.ts`：`WORKFLOW_QUERY_LANE_IDLE_TIMEOUT_MS`、共享资格纯函数
  `resolveShareLocalWorkflowQueryRuntime`（Host 装配层唯一裁决入口）。
- `workflowQueryRuntime.ts`：`createWorkflowQueryRuntime` manager 工厂与
  `resolveWorkflowQueryCarrier` 载体选择。

## 不变量

- **carrier ≠ target**：共享分支的载体是管理面 workspace（固定单 key、单进程），
  RPC target 原样携带真实项目的 path/identity/remoteSessionId/workspaceKey。
- 资格判定只读启动事实（runtime surface、自定义命令、Main 固定绝对 DB），不逐项目
  探测；默认 false。UI/RPC 调用方不能自行开启。
- manager 是控制面 lane：`lane: "workflow-query"`、默认 5 分钟 idle 回收、转发控制面
  选项；不接入 `useSharedTaskRuntime`，不进入 chat active client 表，不借用/销毁活动
  chat 进程。
- 两项请求保持默认 operation 计数；不新增第二套请求队列、idle timer 或名额调度器。
- 非 workspace 的全局读取与三个写方法（get/updateMeta/delete）不走本模块。
- 生命周期语义全部沿用 `ZCodeAgentProcessManager`：spawn 单飞、storageStartup 等待、
  关闭屏障含后代树、disposeAll/disposeAllAndWait 与
  `collectLocalRuntimeChildProcesses` 接线由 agent service 完成。
