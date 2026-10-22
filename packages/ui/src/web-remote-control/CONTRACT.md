# Web Remote Control UI

展示桌面 HMAC 配对状态，并报告手机当前实际查看的任务。

Main 负责配对和既有 Host attachment 的调度；弹窗只持有 UI 投影。目标比较同时检查 workspaceIdentity、workspacePath 与 remoteSessionId。`WebRemoteControlTaskViewReporter` 只发送已提交导航和可见性，任务已读由 Host 唯一 owner 写入。
