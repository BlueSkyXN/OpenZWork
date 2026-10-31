# session-external-import

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：把外部客户端（Codex CLI/Desktop、Qoder/Qoder CN）的原生会话历史一次性导入为
OpenZWork 真实会话。claude 来源留在 `claude-native`（历史模块），本模块只承载新来源；
spec 见 `docs/spec/external-session-import.md`。

不变量：

- 来源只读：扫描/解析/复制不写外部目录；唯一写动作是复制到我方 `agent-config/<provider>/` 备份与建会话。
- 防统计污染：导入任务必须带各自 `migrationSource` 新值（codexCli/qoder，禁止复用 claudeCode），
  且 `externalImport` 指纹（provider/sessionId/sourceContentSha256）随任务落 meta_json。
- 不迁移运行态：来源模型名、mode、usage 一律不落到我方 snapshot（codex 的 token_usage_record 直接忽略）。
- 幂等：同 provider+sessionId 且来源 sha256 未变 → skipped，不建新会话；来源变化后重导 = 新会话。
- 注入过滤：Codex developer 通道与 AGENTS.md/environment_instructions/app-context 注入块不进入导入消息。
- 扫描有界：头采样决定候选（codex 24 行 / qoder 16 行），目录遍历跳过外部产品派生目录（codex `archived`）。

与其它模块的交集：

- `session/taskIndexRepo`：仅经由 adapter 回调读取（listTaskMetas 查幂等指纹）；本模块不直接持有索引写路径。
- `zcode-agent/zcodeAgentService.createSession`：经 adapter 注入的 `createImportedSession` 回调间接调用（importedHistory）。
- `session/claude-native`：qoder 解析复用其 jsonl 头解析与可见消息提取（同构格式），不复制实现。
