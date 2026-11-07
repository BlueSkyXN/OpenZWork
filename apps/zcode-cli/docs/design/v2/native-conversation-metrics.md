# 原生会话指标摘要

产品指标字典、归属与验收见 [统一规格](../../../../../docs/specs/native-conversation-metrics-openzwork.md)。

Core 为每个主链 model step 在现有 step-start part 保存有界 `modelMetrics`。结算后发布 `model_metrics_settled`，ProductProjection 与 cold transcript synthesis 使用同一 summary schema。网络尝试按 requestId + attempt 去重；querySource 限定主链/当前子任务，标题、compact、verifier 等旁路不进入本轮。持久化失败沿原有存储错误路径，不改变模型调用、重试或权限策略。

新数据恢复依赖消息 part，独立于保留 30 天的 usage DB 和 bounded session debug。查询统计只读，不激活子 runtime。无 SQL schema migration。

累计缺项随可选 `SessionUsageState.cumulativeIncompleteFields` 发布。冷恢复在已读取的消息上校验 mainUsage，缺项 seed 与可选上下文 seed 一起交付；缺少上下文不能阻断累计完整性。累计只保存已报告和，不回填旧记录。Adapter 必须在 SDK 合计丢失 raw usage 前保存缓存字段是否上报的证据，显式 0 与缺项分开，重试按 attempt 隔离。具体显示和验收仍以统一规格为准。
