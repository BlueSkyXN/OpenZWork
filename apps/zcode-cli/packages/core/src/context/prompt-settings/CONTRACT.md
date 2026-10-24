# 主会话提示词组装

getSystemPromptCatalog 只读生成当前程序的默认文本，无磁盘、模型或会话副作用。applySystemPromptSettings 消费已校验的创建期快照，仅返回新 sections。内部 legacy custom prompt 与 workflow actor 不进入此路径。UI 只消费目录契约，不能导入 Runtime。
