# 记忆迁移目标目录边界

状态：实现与临时合成目录回归已完成，见 `repair-acceptance-20261001.md`；真实产品及跨平台验收不由此自动关闭。补充 `memory-migration.md` 的旧根只读、目标 no-clobber 契约；不改变已有 Desktop 数据根对齐或独立 CLI 自定义根策略。

## 规则与所有者

- `migrateLegacyProjectMemories` 是迁移复制、专用 tmp 清理和完成标记的唯一所有者。
- 清理、复制和标记读取之前，先验证受控目标 storage root、cli、memories、递归目录与 v2；已有目录组件必须是普通目录，不允许 symlink/junction。
- 目标最终记忆文件链接仍按 no-clobber 保留，不读取其正文；完成标记文件不得是链接或非常规文件。
- 通过真实路径识别目标落入旧 storage 根（源 memories 的 cli 父级所属 storage），包括经目标父目录链接进入的别名。目标 storage 根以外的正常系统/自定义父目录链接可用，不全局禁用 `/tmp`、`/var`。
- 目标不存在时从已有父目录推导真实落点，先拒绝旧根别名，再创建目标；创建后与每次目录使用前复验。
- 边界错误计入 failures，旧根与树外不得复制、清理或写 marker；不写完成标记，修正环境后可重试。调用方既有失败不阻塞启动语义不变。
- 此修复针对已有链接与操作前检查，不承诺对恶意进程在检查/使用之间并发换链的完整防护。

```text
迁移输入 → 源存在性检查 → 目标真实路径/目录预检
  ├─ 不合法 → failures → 无清理/复制/marker → 下次可重试
  └─ 合法 → marker 读取 → 目录复验 → tmp 清理
            → 逐目录复验与 no-clobber 复制 → marker 目录复验 → 原子写 marker
```

## 验收

临时合成目录覆盖 storage/cli/memories/项目/v2 链接回旧根、memories 链到树外、marker 文件链接、目标父目录别名进入旧根、正常父目录链接、文件链接 no-clobber、异常目录修正后重试。快照证明旧根与树外字节和专用 tmp 不变。既有正常迁移、双 worker 并发、SIGKILL 恢复和 marker 幂等继续执行。

所有测试仅创建临时合成数据，不访问真实旧用户数据。真实 Desktop/Agent 双入口、跨平台安装、SSH/WSL/Docker 和离线运行验收仍独立未完成。
