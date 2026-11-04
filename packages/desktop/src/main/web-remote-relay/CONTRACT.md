# desktop-web-remote-relay

提供 V1 HMAC proof、端点/窗口隔离凭据及直连网关。`createWebRemoteControlConnectionProvider` 读取 Main SettingService 的全局接入档案列表，校验模式后准备连接；成功后提交档案列表并保留旧单份配置作为回滚镜像。Manager 以窗口与 `profileId` 独占代次，取消、失败、停止和窗口关闭只释放对应运行实例；窗口关闭释放该窗口全部实例。

外部 relay 的 SID 与 passHash 一起保存到 CredentialService，key 由规范化 URL、窗口和 `profileId` 生成；旧的无端点记录不迁移、不删除。直连凭据仅驻内存，网关只接受预置身份，鉴权后转发原 V1 消息。网关不保存任务、snapshot 或已接纳输入。手机资源来自 Desktop 同级 web-remote 产物。

Manager 通过公开工厂装配 adapter；transport 独占连接及重连，Host/CLI 独占业务会话。同一窗口多个档案可并发启动，启动授权按窗口 + 档案隔离，待恢复快照按档案 + 工作区逐项认领，避免第一个窗口吞掉其他窗口可恢复的档案。产品规则见 docs/web-remote-control/v1-connection-modes.md。

<!-- fork 净化：上游此处的 Relay V2 pairing spec 链接与 MobilePushConnection 通知上报 owner
     章节描述官方账号通道（JWT/HTTP 通知），随官方 V2 通道一并剥离，不适用于本地 HMAC 配对变体。 -->
