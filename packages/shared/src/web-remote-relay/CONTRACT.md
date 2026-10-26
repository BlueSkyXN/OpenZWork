# web-remote-relay

定义 HMAC relay wire、证明向量、二维码参数与通用连接时序。contract.ts 是消息、连接设置和二维码合同；domain 计算端点、路由、退避和心跳间隔，adapters 提供计时和浏览器密码运算。每个 transport 独占 retry/heartbeat，stop 清理两个定时器。凭据归 Desktop credentialService，relay 不持有 task/workspace 状态。

配对使用 sid/hash/t 和 nonce proof；设备注册、认证挑战与认证应答按同一 HMAC 合同执行。通用 retry/heartbeat 保留原公开名称，避免与本轮无关的调用迁移。

连接模式为 direct、self-hosted、official，均用 V1 HMAC。二维码 relay 参数可指定独立 WS 地址；缺省按页面 origin 推导。HTTP 浏览器通过相同 SHA-256/HMAC 算法生成 proof 与摘要。官方地址只供显式选择的 V1 preset 使用。

官方 preset 的 `pageVersion` 固定手机网页资源版本 `3.14.3`，与设备握手中的真实桌面版本分开。Main 只在该模式省略 bootstrap 的可选 `desktopAppVersion`，让旧网页保留已选择的资源；直连和自建模式继续报告真实桌面版本。
