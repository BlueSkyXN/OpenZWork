# 资源管理器网络页退役与诊断入口

OpenZWork 资源管理器只提供 CPU、内存和存储页。原网络页、窗口级 captureId、Main/Host/CLI 请求批次传递及其专属采集器已移除。

## 当前入口

- 查看本机进程占用和存储：[资源管理器](resource-manager.md)。采样由窗口观察状态控制。
- 查看模型使用量、TTFT、耗时和错误率：[本地 App Usage](../spec/app-usage-settings.md)。使用本机数据库已有事实。
- 导出排障材料：[日志导出范围](../desktop/log-export-retention.md)；归档工具边界见[本地诊断归档](../feedback-log-export-alignment.md)。
- 检查模型请求记录：[ModelIO 保留设置](../model-io-full-retention-setting.md)。全量保留默认关闭，凭据脱敏持续生效。
- 开发网络调试：`apps/zcode-cli/packages/debug/server/network-capture.ts` 属于独立 CLI debug server 的代理工具。它有自己的启动配置，与资源窗口无接线关系。

## 维护边界

`ResourceManagerApp.tsx` 的 tab 集合为 `cpu | memory | storage`；专用 preload 只公开采样与存储桥。调整资源窗口时沿现有 Host observation、取消请求和存储 Worker 路径维护。

旧网络页的 NET-01～07 场景及 2026-09-28 验证记录保留在 Git 历史中。它们对应已退役实现，不能作为当前入口或当前通过记录。MCP/Bot 网络请求、代理/CA 配置、Browser Use 和远控业务链继续按各自合同维护。
