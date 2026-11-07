# Chat Context Usage Refresh Action

## Behavior

- 当额度远端刷新正在进行时，操作位隐藏“更多/详情”按钮，显示 loading 图标。
- 当刷新从 loading 结束且没有错误时，操作位显示绿色成功勾 1 秒。
- 成功勾自动消失后恢复“更多/详情”按钮。
- 额度明细仍可在缓存快照存在时继续展示，本变更只影响 header 操作位。
- 有缓存额度时更新失败不占据内容区：保留缓存额度条，只在“更多”旁边显示 warning 色 info 图标，tooltip 提示失败原因。
- 无可展示额度时使用 info notice：左侧信息图标，中间用户文案，右侧刷新图标按钮。
- 失败提示不展示 provider/raw error（例如 timeout code），避免把后台刷新细节直接暴露在 hover 面板。

## Implementation Notes

- `silent` access refresh 在已有缓存快照时会保持 `entitlement.loading=false`，避免缓存内容闪回 checking；因此 hover 触发的刷新图标由 `ChatContextUsage` 跟踪 `onAccess` promise 后通过 `refreshing` 传入。
