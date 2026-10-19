# Model Provider Presets

## 当前边界

- `default-*` 自定义供应商模板已移除，不再在刷新预置供应商时补齐 OpenRouter、Moonshot、MiniMax、DeepSeek、MiMo、Qwen 等默认模板。
- codex/claude/gemini 官方 OAuth 不再作为模型供应商设置入口，也不再暴露 model provider service RPC。

## 远端模型能力补齐

- `client/configs.builtinModels` 下发的是按模型 ID 复用的官方模型事实，不只服务于 builtin provider。
- 模型 ID 使用 `trim + lowercase` 后的完整字符串匹配；不做别名、前后缀、子串或模糊匹配，命中后仍保留本地 provider 中的模型 ID。
- `reasoning` 采用 fill-only 规则：本地没有时使用远端事实，本地已经配置时完整保留。`modalities` 在 `modalitiesConfigured !== true` 时按 input/output 分侧合入；用户明确配置后完整保留本地值。该链路不覆盖 context window、max output tokens 或其它本地模型 metadata。


## GLM 默认模型

- Z.ai / BigModel API Key 预置供应商的默认 GLM 模型列表固定为：`GLM-5.2`、`GLM-5-Turbo`。
- Z.ai / BigModel 的 API Key 入口允许用户自定义模型 context window；用户保存的显式值优先于预置默认值，设置页与 `config.json` 必须保持一致。
- 默认列表顺序就是 UI 和模型选择的优先展示顺序；远端或本地同步逻辑不得把已托管的旧 GLM 模型重新插入默认列表。


## 旧数据迁移

读取本地 provider store 时会清理旧 `default-*` 供应商：

- `apiKey` 为空：视为用户从未启用，直接删除。
- `apiKey` 非空：视为用户已有自定义配置，按普通 custom provider 保留，不再享受默认模板排序或自动补齐。

刷新预置供应商只更新 builtin provider 元信息；普通预置刷新不会隐式修改用户 API Key。
