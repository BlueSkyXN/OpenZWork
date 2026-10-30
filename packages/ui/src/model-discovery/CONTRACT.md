# 模型拉取选择弹窗

弹窗拥有当前 Provider 的候选、选择和保存反馈；hook 通过 ProviderSettingsService 读取，不直连供应商。查询以 Provider 和打开代际隔离，关闭或切换时拒收迟到响应。保存逐项复用父组件已有 onAddModel；成功不再选，失败保留。缺配置交还现有模型编辑器，配置 owner 与当前会话选择不变。
