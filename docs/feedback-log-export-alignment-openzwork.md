# 本地诊断归档边界

OpenZWork 已移除官方云端反馈表单与工单上传。桌面帮助菜单和平台动作调用 `packages/desktop/src/main/exportLogs.ts` 的 `exportLogs()`，将既有日志与配置脱敏后写为本地 ZIP；ZIP 写入失败时尝试目录导出。手动导出范围见[日志保留规则](desktop/log-export-retention.md)。

`packages/services/src/feedback/feedbackLogArchive.ts` 保留 `createFeedbackDiagnosticArchive()` 本地归档工具。`exportLogs.ts` 中的 `createFeedbackLogArchiveFromExportLogs()` 是该工具的适配入口，当前主要由回归测试直接覆盖；普通 `exportLogs()` 走自身的归档路径。保留 `feedback` 文件名不表示存在云端提单消费者。

## 归档工具的读取规则

- 日期范围按归档开始时的本地时区计算，以文件修改时间筛选当天 `[00:00，次日 00:00)`；显式配置文件可设置 `onlyCurrentDay: false`。手动日志导出的三天范围单独维护。
- 打开文件后复查修改时间和大小，只读取当时大小以内的前缀。追加部分留待下一次归档；提前 EOF 的文件跳过。
- 单文件读取上限 8 MiB，总读取上限 32 MiB（compact 2 MiB）；普通日志超过单文件或剩余预算时，只读取固定快照末尾的有界窗口，舍弃首尾不完整行，仅保留可识别的独立日志记录，再做完整脱敏。配置和 CLI 内存记录必须完整解析，超限仍跳过。编码检查、CLI 配置白名单和诊断文本脱敏在写 ZIP 前执行。
- 为避免一类日志耗尽其余来源的预算，在实际存在的来源之间预留字节与遍历额度；CLI 内存记录仍优先处理。`about.txt` 记录收集数量、截尾数量与细分的跳过原因分类（非当天、硬链接、单文件/来源/总量限额等，不再混为 `metadata-policy`），不记录被跳过文件的名称或路径。UTF-8/UTF-16 截尾保持完整字符与记录；无可识别记录则跳过。
- 崩溃诊断仅在导出时处理已有的 `ZCode agent process exited unexpectedly` 完整日志记录：原始 `stderr` 继续按正文删除，只从有界尾部选择错误摘要和栈帧，经过共享 Agent 崩溃诊断器及脱敏生成 `agentCrash` 安全投影，保留错误类别、错误码、摘要、位置和指纹；不保留任意 stderr 对象转储、工具正文、环境变量或源码行。安全投影完成后先移除原始 stderr 再序列化，避免转义引号经文本脱敏后破坏诊断对象。错误栈按行处理：保留 `FATAL ERROR:`、`XxxError:` 结构前缀，只从前缀后的摘要剥离附加键值字段；native 编号/地址帧（含 `0x` 前缀地址及已验证的 Windows 16 位裸十六进制地址 + 简单符号名 + 十进制 `+offset`）与 JS `at` 帧不参与该字段剥离，仍经过完整隐私脱敏。无符号/偏移或未知裸地址格式舍弃。只读导出不调用 CLI、不改变退出时机或添加进程生命周期依赖。
- 诊断文本中的 URL 仅保留协议、主机和端口，非空路径替换为 `[REDACTED]`，并去除 userinfo、query 和 fragment；凭据、正文与工具输入输出沿用共享诊断脱敏。归档工具只返回本地文件路径和大小。

## 运行时安全诊断字段

Windows helper 的退出摘要和 Main 调度延迟汇总以固定标记及独立 JSON 对象写入现有 app 日志。仅保留随机运行标识、PID、固定原因/事件枚举、数字错误码/退出码、布尔状态和 count/max，不包含命令、路径、环境、业务正文或任意 stderr。原生 helper 摘要在现有逐行 stderr 入口严格投影后落盘，复用现有归档与手动导出脱敏，不扩大收集范围、不放宽通用正文删除规则。

运行时验收：`node packages/desktop/scripts/cli-diagnostic-evidence-smoke.mjs`，覆盖真实子进程异常/OOM 到本地 ZIP 的证据链、full/compact 大日志、`agentCrash.errorStack` 帧完整性、脱敏与采样位置；原始采样验证见[内存诊断规格](monitoring/memory-diagnostics-log-openzwork.md)。

源码与测试入口：`packages/services/src/feedback/feedbackLogArchive.ts`、`packages/desktop/test/exportLogs.test.ts`。资源、使用统计与开发诊断的职责对照见[本地诊断职责](electron/resource-manager-openzwork.md#本地诊断职责)。

手动导出在收集文件时排除凭据库、文件密钥、来源标记、插件密钥及这些文件的所有备份。ZIP 与目录回退使用同一份清单。POSIX 下归档目录仅所有者可进入，ZIP 仅所有者可读写。CLI 日志和轨迹取自活动业务根，CLI 用户配置取自固定 HOME。

手动导出按来源核对文件的真实位置。共享日志链接须指向允许收集的日志或配置，固定 HOME 只收集指定的 CLI 配置文件。当前配置指定的凭据库、密钥及其备份也须排除。写入 ZIP 或目录前再次核对文件身份，采样、脱敏及二进制复制使用同一个已打开的文件。轮转或换链导致身份变化时跳过该项。
