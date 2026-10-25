# 系统提示词配置契约

contract.ts 提供严格 schema、章节标识、默认配置和纯文本解析。无 IO 和全局可变状态；Host 是持久化 owner，CLI 是运行上下文 owner。

未知章节、生成内容的静态替换、空替换和超限内容被拒绝。默认文本不经 trim；追加/替换只修剪首尾空白。目录由 CLI 当前版本提供，预览和运行时共用 resolveSystemPromptSection。见 docs/spec/system-prompt-settings.md。

目录 version 2 含严格校验的情景模板；设置仍为 version 1。resolveSystemPromptRuntimeSection 先判断 available，再处理规则，替换/关闭保留 runtimeBefore/runtimeAfter。整体替换只替换规则，五类动态数据的注入开关在两种模式均有效。情景不持久化，不包含当前会话数据。
