# data-directory

提供业务根迁移的路径映射、严格离线命令合同和跨进程使用门禁，不读取业务数据库。
`acquireUse` 在业务 I/O 前登记 PID/token，正常结束释放；崩溃记录只在确认 PID 退出后回收。
租约使用私有临时文件原子发布，临时文件不参与使用者扫描。历史残缺记录仅在正式文件名的 PID 已退出时回收；无法确定 owner、PID 存活或正文与文件名的 PID 冲突时保留并拒绝迁移。
`exclusive` 使用既有 atomicFileLock 串行化准入，拒绝活跃使用者，不杀进程。
门禁资料位于根目录的同级目录，不随业务复制；迁移去向标记阻止旧根重新接受写者。
路径只映射 BUSINESS_DATA_ENTRIES 内绝对路径和 file URL；固定 HOME 配置不变。
路径派生的 ID、数据库 JSON、记忆索引由各自 owner 转换。计划只操作 staging，失败不得发布。
