# 本地 TTFT 诊断阅读

本地时间事实以 `packages/shared/src/localTtft.ts` 和实际事件中的单位、阶段及关联 ID 为准。先判断同一输入是否经过排队、用户确认、重试或连接恢复，再解释耗时。

- 首输出与首正文分别记录；思考或工具输出先到达时，两者可能相差很大。
- 跨进程阶段需要有效时钟校准；校准缺失时保留同进程事实，不填造跨进程区间。
- 并行区间按实际重叠关系解释，不能简单相加各阶段分位数。
- 缺失、时钟异常和合法零值应分开呈现。

检查入口见[本地 TTFT 事实](./local-ttft-queries.md)。本地用量聚合由 CLI session store 提供，模型请求失败详情见[模型错误诊断](../trace/model-attempt-error-diagnostics.md)。
