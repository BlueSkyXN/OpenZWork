# Web Remote Control UI

设置 → 远程控制以手机连接与 Bot Channels 卡片展示三种 V1 连接方式、连接配置草稿和 HMAC 配对状态，并报告手机当前实际查看的任务。打开页面不启动连接，离开页面不停止连接；用户显式开启后经 platform 提交，运行期间配置只读，停止后可更改。

Main 负责配对和既有 Host attachment 的调度；页面只持有 UI 投影。目标比较同时检查 workspaceIdentity、workspacePath 与 remoteSessionId。`WebRemoteControlTaskViewReporter` 只发送已提交导航和可见性，任务已读由 Host 唯一 owner 写入。

官方 V1 旧页的任务索引由 root 平台同步桥读取已有 WindowController registry，只有运行的官方模式才订阅；Main 仅转发完整派生快照，停止和作用域变化丢弃迟到读取。

Bot 管理作为设置内子页，沿用设置面包屑返回；配置读写通过 SettingsPage 注入的本机 Host services。最近工作区的 identity 与存活 remote session 由现有 resolver 传入；无目标时仅禁止开启手机连接。工作区 Footer 仅提供设置导航快捷入口，不持有连接状态、不传递工作区目标、不启动连接；设置 back 模式隐藏该入口。独立远控配置弹窗保持退役。
