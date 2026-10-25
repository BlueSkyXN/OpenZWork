# 本地诊断归档边界

OpenZWork 已移除官方云端反馈表单与工单上传。桌面帮助菜单和平台动作调用 `packages/desktop/src/main/exportLogs.ts` 的 `exportLogs()`，将既有日志与配置脱敏后写为本地 ZIP；ZIP 写入失败时尝试目录导出。手动导出范围见[日志保留规则](desktop/log-export-retention.md)。

`packages/services/src/feedback/feedbackLogArchive.ts` 保留 `createFeedbackDiagnosticArchive()` 本地归档工具。`exportLogs.ts` 中的 `createFeedbackLogArchiveFromExportLogs()` 是该工具的适配入口，当前主要由回归测试直接覆盖；普通 `exportLogs()` 走自身的归档路径。保留 `feedback` 文件名不表示存在云端提单消费者。

## 归档工具的读取规则

- 日期范围按归档开始时的本地时区计算，以文件修改时间筛选当天 `[00:00，次日 00:00)`；显式配置文件可设置 `onlyCurrentDay: false`。手动日志导出的三天范围单独维护。
- 打开文件后复查修改时间和大小，只读取当时大小以内的前缀。追加部分留待下一次归档；提前 EOF 的文件跳过。
- 单文件读取上限 8 MiB，总读取上限 32 MiB；编码检查、CLI 配置白名单和诊断文本脱敏在写 ZIP 前执行。
- `about.txt` 记录收集数量与跳过原因分类，不记录被跳过文件的名称或路径。
- 诊断文本中的 URL 仅保留协议、主机和端口，非空路径替换为 `[REDACTED]`，并去除 userinfo、query 和 fragment；凭据、正文与工具输入输出沿用共享诊断脱敏。归档工具只返回本地文件路径和大小。

源码与测试入口：`packages/services/src/feedback/feedbackLogArchive.ts`、`packages/desktop/test/exportLogs.test.ts`。资源、使用统计与开发诊断的职责对照见[本地诊断职责](electron/resource-manager.md#本地诊断职责)。
