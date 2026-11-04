# Model Provider Presets

## 当前边界

- 内置目录只保留三个中性协议模板：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses。
- 三个模板不携带厂商 Base URL、Logo、模型目录或能力差异；用户新增 Provider 时填写自己的 endpoint、Key 和模型。
- 模型能力在独立规则库中按模型 ID、协议和公共 endpoint 匹配，Personal 覆盖优先。当前合同与验收见[模型能力与渠道匹配](spec/model-capability-matching.md)。
- 不再在刷新预置供应商时补齐任何第三方厂商模板。
- codex/claude/gemini 官方 OAuth 不再作为模型供应商设置入口，也不再暴露 model provider service RPC。

## 模型能力解析

- 目标 Host 的 `ModelConfigRules` 解析模型、协议、站点与 Personal 层；设置页和执行 Registry 消费同一份生效结果。
- 模型规则使用声明的匹配范围；匹配不会改写请求中的模型 ID。自定义别名和网关差异可通过对应 Provider／模型的 Personal 配置表达。
- 设置页区分模型推荐、渠道推荐与通用配置。来源是解析投影，不持久化；实际规则随应用版本维护。

## 旧数据迁移

读取本地 provider store 时会清理旧 `default-*` 供应商：

- `apiKey` 为空：视为用户从未启用，直接删除。
- `apiKey` 非空：视为用户已有自定义配置，按普通 custom provider 保留，不再享受默认模板排序或自动补齐。

刷新预置供应商只更新 builtin provider 元信息；普通预置刷新不会隐式修改用户 API Key。
