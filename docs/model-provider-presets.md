# Model Provider Presets

## 当前边界

- 内置目录只保留三个中性协议模板：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses。
- 三个模板不携带厂商 Base URL、Logo、模型目录或能力差异；用户新增 Provider 时填写自己的 endpoint、Key 和模型。
- 不再在刷新预置供应商时补齐任何第三方厂商模板。
- codex/claude/gemini 官方 OAuth 不再作为模型供应商设置入口，也不再暴露 model provider service RPC。

## 远端模型能力补齐

- `client/configs.builtinModels` 下发的是按模型 ID 复用的官方模型事实，不只服务于 builtin provider。
- 模型 ID 使用 `trim + lowercase` 后的完整字符串匹配；不做别名、前后缀、子串或模糊匹配，命中后仍保留本地 provider 中的模型 ID。
- `reasoning` 采用 fill-only 规则：本地没有时使用远端事实，本地已经配置时完整保留。`modalities` 在 `modalitiesConfigured !== true` 时按 input/output 分侧合入；用户明确配置后完整保留本地值。该链路不覆盖 context window、max output tokens 或其它本地模型 metadata。

## 旧数据迁移

读取本地 provider store 时会清理旧 `default-*` 供应商：

- `apiKey` 为空：视为用户从未启用，直接删除。
- `apiKey` 非空：视为用户已有自定义配置，按普通 custom provider 保留，不再享受默认模板排序或自动补齐。

刷新预置供应商只更新 builtin provider 元信息；普通预置刷新不会隐式修改用户 API Key。
