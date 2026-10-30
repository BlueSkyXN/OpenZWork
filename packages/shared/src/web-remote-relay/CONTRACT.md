# web-remote-relay

定义 HMAC relay wire、证明向量、二维码参数与通用连接时序。contract.ts 是消息、连接设置和二维码合同；domain 计算端点、路由、退避和心跳间隔，adapters 提供计时和浏览器密码运算。每个 transport 独占 retry/heartbeat，stop 清理两个定时器。凭据归 Desktop credentialService，relay 不持有 task/workspace 状态。

配对使用 sid/hash/t 和 nonce proof；设备注册、认证挑战与认证应答按同一 HMAC 合同执行。通用 retry/heartbeat 保留原公开名称，避免与本轮无关的调用迁移。

<!-- OpenZWork 净化：官方 V1 preset（zcode.z.ai 官方网关）段落删除；保留域为 direct/self-hosted 的本地 HMAC 配对与上游 V2 契约。 -->

完整语义见 [Relay V2 spec](../../../../docs/web-remote-control/relay-v2-pairing.md)。

## 移动通知

mobilePushEventSchema / mobilePushRunSchema 只描述 HTTP 通知载荷，不进入 Relay WebSocket 消息。collectMobilePushEvents 只分类已接纳的在线状态变化，不处理 initial/recovery 或 IO。
