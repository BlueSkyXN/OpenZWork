# 会话指标合同

纯 schema 与转换，不读取服务或存储。`modelStepMetricsSchema` 用于内部事件和持久 part 的共同校验，`conversationMetricsSchema` 用于 V4 turnHeader 与直接子任务摘要。缺少 usage 表示未上报，合法 0 保留；cache 已在 input 内。`mergeMetrics` 只接收独立事实，所有者负责幂等去重。速度只使用同一成功请求首有效内容之后的生成区间。

`mainUsage` 仅携带主链成功 result；live 累计仍消费 ModelComplete，cold 通过同一 settled 事实重建。失败尝试和子代理用量不会进入该累计。
