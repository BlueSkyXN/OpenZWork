# 本地诊断与度量

本目录记录本地运行日志、TTFT 查询和测试度量。App Usage 的事实由 CLI session store 持有，设置页通过已注册的本机服务只读查询。

- [进程内存本地诊断日志](./memory-diagnostics-log.md)
- [本地 TTFT 查询与验收](./local-ttft-queries.md)
- [本地 TTFT Trace 阅读](./local-ttft-trace-reading.md)
- [Session 停止来源诊断](./session-stop-source-diagnostics.md)
- [App Usage 规格](../spec/app-usage-settings.md)

服务日志使用 `createServiceLogger(scope)`。生命周期使用 info，可恢复异常使用 warn；原始协议和流式 chunk 使用 debug。
