# 记忆迁移目标目录边界

状态：实现与临时合成目录回归已完成，见 `repair-acceptance-20261001.md`；真实产品及跨平台验收不由此自动关闭。补充 `memory-migration.md` 的旧根只读、目标 no-clobber 契约；不改变已有 Desktop 数据根对齐或独立 CLI 自定义根策略。

## 规则与所有者

- `migrateLegacyProjectMemories` 是迁移复制、专用 tmp 清理和完成标记的唯一所有者。
- 标记读取之前，只做有界安全检查：验证物理源与目标 storage 根不重叠、目标不落入旧 storage 根，并验证 storage root、v2 与标记文件；已有目录组件必须是普通目录，标记不得是链接或非常规文件。此阶段不创建目录、不枚举或检查 cli/memories 子树。
- 有效完成标记直接返回 `noop-marker-present`，不访问 cli/memories；标记缺失、损坏或读取失败时，在任何临时文件清理、复制及目录创建之前，完整预检受控 cli、memories 与递归目录，并复验标记路径。全树预检仍拒绝目录 symlink/junction，不能为了快速跳过而放松实际迁移边界。
- 目标最终记忆文件链接仍按 no-clobber 保留，不读取其正文；完成标记文件不得是链接或非常规文件。
- 通过真实路径识别目标落入旧 storage 根（源 memories 的 cli 父级所属 storage），包括经目标父目录链接进入的别名。还必须对实际 sourceMemoriesRoot 做 realpath：仅解析旧 storage 祖先不足以识别源父目录链接。物理源树与目标 storage 写入树等同或任一包含另一时，在 marker 读取、清理、复制及目录创建前拒绝；目标不存在时推导其真实落点。目标 storage 根以外的正常系统/自定义父目录链接可用，不全局禁用 `/tmp`、`/var`。
- 目标不存在时从已有父目录推导真实落点，先拒绝旧根别名，再创建目标；创建后与每次目录使用前复验。
- 边界错误计入 failures，旧根与树外不得复制、清理或写 marker；不写完成标记，修正环境后可重试。调用方既有失败不阻塞启动语义不变。
- 此修复针对已有链接与操作前检查，不承诺对恶意进程在检查/使用之间并发换链的完整防护。

```text
迁移输入 → 源存在性检查 → storage root / v2 / marker 有界安全检查
  ├─ 不合法 → failures → 无清理/复制/marker → 下次可重试
  └─ 合法 → marker 读取
       ├─ 有效 → noop-marker-present（不访问 cli/memories）
       └─ 缺失/损坏/读取失败 → 完整目标树预检
            ├─ 不合法 → failures → 无清理/复制/marker → 下次可重试
            └─ 合法 → 目录复验 → tmp 清理 → 逐目录复验与 no-clobber 复制
                      → marker 目录复验 → 原子写 marker
```

## 验收

临时合成目录覆盖 storage/cli/memories/项目/v2 链接回旧根、memories 链到树外、marker 文件链接、目标父目录别名进入旧根、正常父目录链接、文件链接 no-clobber、异常目录修正后重试。快照证明旧根与树外字节和专用 tmp 不变。既有正常迁移、双 worker 并发、SIGKILL 恢复和 marker 幂等继续执行。

新增快速路径回归记录真实文件系统 IO：有效标记存在时，cli/memories 下的 readdir、lstat、stat、realpath 调用均为零，不使用耗时阈值断言；已有标记也不能绕过不安全的 storage root、v2、marker 或源目标重叠。标记缺失或损坏时，预置深层目录链接与陈旧 tmp，断言全树预检先拒绝、tmp 和标记原样保留，修正后仍能重试。

所有测试仅创建临时合成数据，不访问真实旧用户数据。真实 Desktop/Agent 双入口、跨平台安装、SSH/WSL/Docker 和离线运行验收仍独立未完成。

## 2026-10-03 快速路径修复验证

- 新增 `packages/services/test/memory-migration-marker.test.ts` 共 7 项：改实现前快速路径用例失败、其余 6 项安全回归通过；修复后全部通过。IO 观测使用 Node 内置 mock 并同步命名导出，调用真实文件系统，结束时恢复，不依赖耗时阈值。
- 迁移标记、目录边界、既有迁移与 Desktop 存储四文件定向测试 42/42；完整包测试 services 79/79、UI 16/16。既有双 worker、SIGKILL 恢复与 no-clobber 用例继续通过。
- Node 24.14.0 下 `pnpm typecheck`、`pnpm lint`（238 warnings / 0 errors）、`pnpm architecture:check --changed`（0 baseline / 0 new）通过；本轮文件格式检查通过。
- 用临时 Git 索引把全部新增文件纳入扫描后，私有化结构门禁 39/39；真实索引未改动，没有增加豁免。合成 800 个空项目的诊断耗时约 1 ms，仅作性能复测，不作为自动化断言。
- 本轮本地验证不等同于真实 Windows/Linux runner、Electron 启动或跨平台安装包验收。
