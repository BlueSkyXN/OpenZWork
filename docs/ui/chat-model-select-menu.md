# Chat Model Select Menu

> **当前状态**：聊天侧已经迁移到 V4 composer。

## 目标

聊天输入框复用 `ModelConfigSelect`，模型选择交互使用简单菜单承载，减少搜索型 Command 列表在小范围模型切换里的操作成本。

## 当前实现

- `packages/ui/src/v4/composer/V4ComposerToolbar.tsx`
  - 只负责把聊天 toolbar 的模型分组、锁定状态和切换回调传入 `ModelConfigSelect`。
- `packages/ui/src/v4/ConversationComposer.tsx`
  - 模式、模型、思考深度三个配置 picker 共享 composer-local 的打开状态；任一时刻最多一个
    picker 展开。点击另一个 trigger 时，旧 picker 必须先退出可见状态，后点击的 picker
    保持打开。
  - 关闭旧 picker 的迟到回调只能清理它自己，不能把已经接管的兄弟 picker 一并关闭。
  - picker owner 只在当前 `workspaceKey + sessionId/draft scope` 内有效；scope 切换时必须
    同步清空。`ConversationComposer` React 实例可以跨 task/draft 复用，但打开状态不得跨 scope
    保留或自动弹出。

## 兼容边界

- 桌面端和 Web 端共用同一个 React 组件，菜单交互不引入平台专属逻辑。
- picker 互斥只属于单个 composer 实例，不进入全局 store，也不跨 pane、window 或
  desktop continuous / web-remote replayable 边界同步。
- 手机 Web 端继续避免关闭菜单后强制恢复输入框焦点，防止触控设备拉起系统键盘遮挡菜单；模型 trigger 不保留手机专用的固定宽度、文字截断或 provider 裁剪逻辑，统一依赖 composer 的可用空间裁决。
- ZCode Agent 的 provider 模型菜单按 runtime endpoint format 过滤，当前目录可以包含
  Anthropic-compatible、OpenAI-compatible Chat Completions 和 OpenAI Responses 模型；Bot `/model`
  入口复用同一 provider 能力边界。
- 已有 session 的选择通过 V4 `switchModelConfig` 写 CLI；草稿选择由 `useDraftConfigControl` 写
  `draftConfigRef`、workspace default 和预热 session。远程恢复必须保持 workspaceIdentity /
  remoteSessionId，不经过 legacy task model write。
