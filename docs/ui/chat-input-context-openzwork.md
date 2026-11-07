# Chat Input Context

> **当前状态**：本文已按 V4 composer 接线校准。上下文用量来自 V4 conversation snapshot，
> 不再读取 legacy task runtime/store。

## 目标

把聊天输入栏底部的上下文用量，从静态文本改成 AI Elements 的 `Context` compound component。

## 当前实现

- `packages/ui/src/components/ai-elements/context.tsx`
  - 增加了 0 上限保护，避免进度百分比出现无效值
  - 改为跟随当前环境 locale 格式化百分比、compact 数字和货币
- `packages/ui/src/i18n/locales/en-US.ts`
- `packages/ui/src/i18n/locales/zh-CN.ts`
  - 补充了 hover card 的说明文案

## 结果

- 输入栏底部仍保留简洁的 context 入口
- 组件形式与 `elements.ai-sdk` 的 context 文档保持一致
