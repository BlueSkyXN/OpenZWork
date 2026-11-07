# 本地诊断入口

- [模型请求错误诊断字段](./model-attempt-error-diagnostics.md)
- [CLI 本地用量](../../apps/zcode-cli/docs/design/v2/usage-observability.md)
- [CLI 本地 Debug](../../apps/zcode-cli/docs/design/v2/debug-observability.md)
- [本地日志与度量](../monitoring/README.md)

用量事实由 CLI session store 持有，日志和模型错误字段沿现有本地诊断流程读取。增加诊断字段时核对当前公共合同、内容截断和凭据脱敏规则。
