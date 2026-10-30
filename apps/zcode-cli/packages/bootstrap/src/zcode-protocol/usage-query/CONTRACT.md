# Host 用量查询协议适配

沿已有 requestClient 双向通道请求所属 Host，使用严格输入/输出 schema、30 秒超时与调用方 AbortSignal。只传项目选择和时间范围，不读写 Host 项目库。端口只提供报告读取。
