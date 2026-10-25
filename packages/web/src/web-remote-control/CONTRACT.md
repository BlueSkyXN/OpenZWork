# Web Remote Control

手机经二维码或粘贴链接中的参数和 passHash HMAC proof 连接桌面直连网关或 V1 relay；transport 管理 socket、配对、心跳和连接代次。设备发现和官方账号登录不属于本模块。

Main 转发到已有 Host attachment，Host / CLI 继续拥有任务状态。手机通过 replayable snapshot、frame gap recovery 和 bridge generation 恢复展示，不创建第二个 Agent 或任务队列。

bootstrap 请求只读取响应。version guard 校验当前请求代次和版本后，同步通过 `onAccepted` 提交查看 epoch；过期、已释放或版本不匹配的回包不提交。task-view publisher 在隐藏或卸载时撤销实际查看声明，任务已读由 Host 唯一 owner 写入。

裸 HTTP /remote/ 入口展示配对链接输入页，完整配对链接直接连接。显式 relay 参数覆盖 origin 默认值，HTTPS 页面拒绝 WS 混合内容；HTTP 的密码运算使用共享兼容实现。
