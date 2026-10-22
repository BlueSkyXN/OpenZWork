# 模型请求错误诊断

流式请求可能把底层网络异常包装成 `TerminalStreamChunkError`。包装器通过 `cause` 保留
`adapterError.cause ?? adapterError`，同时保留原消息与 `adapterError` 身份，供错误分类器
读取连接重置、DNS、TLS、HTTP 状态与重试相关事实。

## 当前字段与所有者

- `apps/zcode-cli/packages/adapters/src/model/runner-retry.ts` 持有终止流包装器和重试规则。
- `failure-inspection.ts` 沿 `cause` 查找状态码、响应头和错误码，使用已访问对象集合防止循环。
- `runner-telemetry.ts` 提供模型失败字段的纯转换：`errorCode`、`errorPhase`、
  `exceptionType`、`retryAfterMs`，以及 provider 错误分类信息。
- `modelFailureAttributionFields` 把错误映射为 `transport`、`provider_business`、
  `api_call`、`protocol` 等有限类别，供模型状态和错误载荷使用。

诊断时先按请求阶段与错误类别定位，再结合本地日志检查底层原因。提取或导出错误内容时
沿用现有日志脱敏处理，不加入请求正文、鉴权凭据或完整响应内容。

## 验收边界

`runner-retry.test.ts` 覆盖存在和缺少底层 `cause` 的包装行为；
`failure-classifier.test.ts` 覆盖嵌套 provider 错误与 `retry-after` 读取。
验证应同时检查错误消息、包装对象身份和重试规则，避免诊断字段改变请求行为。
