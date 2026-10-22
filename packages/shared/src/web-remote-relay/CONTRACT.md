# web-remote-relay

定义 HMAC relay wire、证明向量、二维码参数与通用连接时序。contract.ts 是消息和二维码合同；domain 只计算退避和心跳间隔，adapters 拥有定时器。每个 transport 独占 retry/heartbeat，stop 清理两个定时器。凭据归 Desktop credentialService，relay 不持有 task/workspace 状态。

配对使用 sid/hash/t 和 nonce proof；设备注册、认证挑战与认证应答按同一 HMAC 合同执行。通用 retry/heartbeat 保留原公开名称，避免与本轮无关的调用迁移。
