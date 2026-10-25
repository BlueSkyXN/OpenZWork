# Runtime 指标

`buildModelStepMetrics` 从当前步骤的网络终态构建有界摘要，requestId + attempt 去重，过滤旁路 querySource。无终态时只接受 result 的真实 usage，不推算时间。结算与持久化接入在既有 `recordMainTurnModelUsage`；不影响准入、重试、工具和权限。
