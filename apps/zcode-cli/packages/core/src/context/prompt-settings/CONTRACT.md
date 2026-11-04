# 主会话提示词组装

getSystemPromptCatalog 只读生成当前程序的默认文本，无磁盘、模型或会话副作用。applySystemPromptSettings 消费已校验的创建期快照，仅返回新 sections。内部 legacy custom prompt 与 workflow actor 不进入此路径。UI 只消费目录契约，不能导入 Runtime。

runtime-template.ts 从现有 builders 提取规则与当前能力事实，目录使用合成情景，实际组装使用当次 ContextBuilderConfig。桌面/Memory/Skill 条件不由用户文本推导。默认字节保持；替换和关闭规则保留能力、位置和活动输出风格。整体替换保留这些事实与启用的动态数据。

完整入口 index.ts 导出草稿预览和观察能力；builder 只依赖底层 contract.ts，避免循环导入。完整草稿预览复用 ContextBuilder 的合成输入。SystemPromptObservation 每 runtime 一份，仅从真实模型请求的投影片段捕获；比较使用复制的 builder 输入，不能从新磁盘状态补造。正文超出 1 MiB 或片段无法证实在最终投影中时明确 unavailable。生成开关重新启用或合并块不能按来源拆开时比较不可用，原文仍可读。
