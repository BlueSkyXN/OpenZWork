# 原生会话指标摘要

产品指标字典、归属与验收见 [统一规格](../../../../../docs/spec/native-conversation-metrics.md)。

Core 为每个主链 model step 在现有 step-start part 保存有界 `modelMetrics`。结算后发布 `model_metrics_settled`，ProductProjection 与 cold transcript synthesis 使用同一 summary schema。网络尝试按 requestId + attempt 去重；querySource 限定主链/当前子任务，标题、compact、verifier 等旁路不进入本轮。持久化失败沿原有存储错误路径，不改变模型调用、重试或权限策略。

新数据恢复依赖消息 part，独立于保留 30 天的 usage DB 和 bounded session debug。查询统计只读，不激活子 runtime。无 SQL schema migration。
