# Web Remote Control UI

展示三种 V1 连接方式、连接配置草稿和 HMAC 配对状态，并报告手机当前实际查看的任务。打开弹窗不启动连接；用户显式开启后经 platform 提交，运行期间配置只读，停止后可更改。

Main 负责配对和既有 Host attachment 的调度；弹窗只持有 UI 投影。目标比较同时检查 workspaceIdentity、workspacePath 与 remoteSessionId。`WebRemoteControlTaskViewReporter` 只发送已提交导航和可见性，任务已读由 Host 唯一 owner 写入。

官方 V1 旧页的任务索引由 root 平台同步桥读取已有 WindowController registry，只有运行的官方模式才订阅；Main 仅转发完整派生快照，停止和作用域变化丢弃迟到读取。
