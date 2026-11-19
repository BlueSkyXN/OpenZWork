# 飞书 SDK 长连接缺陷（OW-P038）

登记：[下游补丁清单](downstream-patches.yaml)的 `OW-P038`。

## 问题与所有者

3.18.2 的 services 声明 SDK 1.64.0，desktop 声明 1.61.1，均早于下面两项 SDK 修复。

| 触发条件                        | 旧版本表现                                                           | SDK 修复提交                    |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| 在 WebSocket 握手结束前关闭连接 | 移除监听器后，迟到的 socket `error` 可能成为未捕获异常，导致宿主退出 | `larksuite/node-sdk` `37d241ee` |
| 入站帧解码或分派抛错            | 入站处理没有记录该异常，事件丢失难以诊断                             | `larksuite/node-sdk` `af41737d` |

启动超时或取消时，`feishuProvider.ts` 的 `closeClient` 会调用 SDK 的 `close()`。连接生命周期仍由 provider 管理；`packages/services/package.json` 声明开发与服务运行时的 SDK，`packages/desktop/package.json` 声明桌面安装包的 SDK。桌面 bundler 将该模块列为外部依赖，安装包运行时从依赖目录加载。

## 规则

1. 两处声明使用相同的稳定版本且不低于 1.74.0，本补丁固定为 1.74.0。用 pnpm 重算锁文件，只接受 SDK 及其所需的传递依赖变化。
2. 保留 `isConnecting` 与 `wsConfig.getWSInstance()` 探测方式，不切换到 `onReady`。补丁标记位于 `packages/desktop/scripts/bundle.mjs` 的外部依赖项旁，provider 源码不变。
3. 上游两处声明均采用相同且不低于 1.74.0 的稳定版本后，核对修复仍在发布包内，撤销补丁并保留回归。

## 验收

- 核心套件 `retained-bot-delivery-and-runtime` 运行 `packages/services/test/feishuSdkVersion.test.ts`，防止两处版本不一致或低于修复版。
- 冻结安装后，检查 desktop 与 services 的实际解析。用本地 macOS 候选的 `app.asar` 核对 SDK 版本，并读取发布的 JS：关闭 socket 前安装 `error` 监听，入站帧处理捕获并记录异常。
- 真实飞书长连接单独验收：在授权测试机器人上确认建立连接、接收事件，以及启动超时或取消时 Host 仍存活。声明和包内检查不覆盖该场景。
