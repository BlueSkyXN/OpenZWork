# 系统提示词配置契约

contract.ts 提供严格 schema、章节标识、默认配置和纯文本解析。无 IO 和全局可变状态；Host 是持久化 owner，CLI 是运行上下文 owner。

未知章节、生成内容的静态替换、空替换和超限内容被拒绝。默认文本不经 trim；追加/替换只修剪首尾空白。目录由 CLI 当前版本提供，预览和运行时共用 resolveSystemPromptSection。见 docs/spec/system-prompt-settings.md。
