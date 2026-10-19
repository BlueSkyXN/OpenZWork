# 本地 TTFT 事实与检查

当前共享合同为 `packages/shared/src/localTtft.ts`。CLI 发出的时间事实经现有 Agent 服务和连接 scope 转发；归属与订阅权限由原 attachment 决定，不增加独立采集或持久化所有者。

检查一次输入时，先核对 workspace identity、session、command/input 与 turn 的关联，再区分提交、命令接纳、实际执行和首输出时间。缺失阶段保持缺失；排队等待、重试等待和用户确认应分别解释。

App Usage 展示使用 CLI session store 已有 TTFT 聚合字段，查询入口见[App Usage 规格](../spec/app-usage-settings.md)。连接隔离回归见 `packages/services/test/zcodeAgentConnectionScope.test.ts` 中本地时间事实的订阅场景。
