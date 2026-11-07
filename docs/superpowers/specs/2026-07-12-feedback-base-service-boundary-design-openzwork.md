# SSH 断连场景反馈服务边界设计

## 非目标

- 不修改 `ZCODE_REMOTE_WORKSPACE_DISCONNECTED` 断连代理的保护规则。
- 不让 workspace-scoped 服务在断连后普遍回退到本机 services。
- 不调整反馈表单、截图、日志归档、附件上传或反馈 API 协议。
- 不处理 SSH 自动重连或远程 session 生命周期问题。

## 方案

反馈中心的挂载位置、store、弹窗生命周期和当前任务/模型上下文读取方式保持不变，避免扩大 UI 行为变化。

## 错误处理

- SSH 断连不再成为反馈提交错误来源。
- 反馈 API、附件上传或本机日志归档的真实错误继续按现有流程展示，不新增吞错或重试。
- 远程 workspace 的其他 service 调用仍由断连代理返回 `ZCODE_REMOTE_WORKSPACE_DISCONNECTED`，防止远程路径误路由到本机。

## 兼容性

- 桌面本地 workspace：传入的实例与现有实际使用的 base feedback service 相同。
- 桌面 SSH 已连接：当前合并 services 中的反馈实例本就来自 base services，改动后调用对象不变。
- 桌面 SSH 连接中/已断开：由断连代理切换为 base feedback service，这是本次唯一预期行为变化。
- 手机 Web 远控：继续使用入口注入的 unsupported feedback service，不新增远程业务状态，也不绕过 replayable 恢复边界。
- macOS、Windows、Linux：仅调整依赖选择，不引入平台分支。

## 测试设计

新增回归测试验证反馈服务选择不依赖 workspace-scoped services：

| 场景                 | workspace services     | feedback service | 预期                 |
| -------------------- | ---------------------- | ---------------- | -------------------- |
| 本地 workspace       | base services          | base feedback    | 行为不变             |
| SSH 已连接           | merged remote services | base feedback    | 行为不变             |
| SSH session 尚未绑定 | disconnected proxy     | base feedback    | 可提交，不抛断连错误 |
| SSH 已断开           | disconnected proxy     | base feedback    | 可提交，不抛断连错误 |

测试应直接断言 `FeedbackHost` 接收显式的 base feedback service，并避免仅依赖对象展开恰好保留该字段。现有 feedback submission 测试继续覆盖 `getDeviceSnapshot`、工单创建、附件和日志流程。

## 验证

- 运行新增/相关 UI 单元测试。
- 运行 `pnpm typecheck`。
- 运行 `pnpm lint`。
- 检查桌面本地与 SSH service 边界未发生额外 diff。
