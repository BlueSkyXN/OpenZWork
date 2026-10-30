# QueryUsage

只读调用 Host 的 UsageQueryPort；不直接打开数据库或推算 Token。入参为时间范围、可选项目 ID / null 未归类及 IANA 时区。未指定项目时返回本机概览和可供后续选择的项目 ID。只在端口存在时注册。汇总和分页查询共用 until，报告含全量 totals、totalCount 和前 50 个主会话。结果是有界的用量报告字符串，保留查询时间、范围和 30 天保留口径；无端口或查询失败返回错误。
