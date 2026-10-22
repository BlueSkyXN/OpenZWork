# Web Remote Control

手机经现有二维码参数和 passHash HMAC proof 连接外部 relay；transport 管理 socket、配对、心跳和连接代次。设备发现和官方账号登录不属于本模块。

Main 转发到已有 Host attachment，Host / CLI 继续拥有任务状态。手机通过 replayable snapshot、frame gap recovery 和 bridge generation 恢复展示，不创建第二个 Agent 或任务队列。

bootstrap 请求只读取响应。version guard 校验当前请求代次和版本后，同步通过 `onAccepted` 提交查看 epoch；过期、已释放或版本不匹配的回包不提交。task-view publisher 在隐藏或卸载时撤销实际查看声明，任务已读由 Host 唯一 owner 写入。
