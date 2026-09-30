# 迁移源父目录 alias 修复与干净提交树验证

日期：2026-10-01。代码提交：`0ebf73794f3de04e370404aab77cd2dd77834b68`，分支 `fix/identity-path-ci`。本次只修物理源/目标重叠，不扩展全产品验收。

## 复现与原因

独立 diff 指出的缺口成立：原边界仅 realpath 旧 storage 祖先；旧 cli 父目录可链接到新的 cli，源 memories 叶子 lstat 仍是普通目录，物理源/目标等同或嵌套却被放行。

新增三个测试全部通过实际 `migrateLegacyProjectMemories`，仅创建临时合成 HOME/目录：

| 修复前场景                | 返回 failures | filesCopied | 目录快照                                   |
| ------------------------- | ------------- | ----------- | ------------------------------------------ |
| 源/目标 memories 物理等同 | 0             | 0           | 死亡 PID tmp 被清理、写入 marker，发生变化 |
| 源位于目标树内            | 0             | 1           | 源 tmp 被清理，目录/marker 变化            |
| 目标位于源内              | 2             | 38          | 递归复制修改源树，后续才失败               |

没有读取或写入真实 HOME/旧数据。测试清理仅针对自身临时目录。

## 最小修复与回归

- `memoryMigrationBoundary.ts` 增加实际 sourceRoot 的 realpath，并在既有目标检查中比较双向包含关系。
- 物理源树与目标 storage 写入树等同或任一包含另一，在清理、marker 读取、复制及目录创建前返回 failures；目标不存在用已有 prospectiveRealpath 推导。
- 保留普通系统 `/tmp`、`/var` 和自定义父目录别名；保留最终文件 no-clobber、正常迁移、并发和中断恢复。
- 只修改实现、现有边界测试和对应 spec 三文件，`+89/-2`；不修改原 HOME/存储/CI/UI 补丁，不自动合并历史数据。

修复后三项分别为 failures=1、filesCopied=0、sourceChanged=false；新增正常双侧父目录 alias 正例通过。连同既有迁移测试 **31/31 通过，零跳过**。候选工作区根类型与架构通过，lint 238 warnings/0 errors。

## 干净 committed-tree 证据

创建 detached worktree，检出精确代码提交 `0ebf73794f3de04e370404aab77cd2dd77834b68`；不复制当前工作区源文件、不复用当前 dist 或 node_modules。使用 Node 24.14.0、pnpm 10.33.2，按锁文件 `install --frozen-lockfile --ignore-scripts --offline` 独立安装，包缓存仅作为锁文件依赖来源。

验证前后 `git status --porcelain` 为空，工作树没有当前 31 个未提交文件。

| 独立树验证                                         | 结果                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 根 `pnpm typecheck`                                | 通过                                                                                 |
| 根 `pnpm lint`                                     | 41 warnings、0 errors，不是候选工作区 238 的扫描范围                                 |
| `pnpm architecture:check`                          | 通过，violations/baseline/new 均 0                                                   |
| 内层 Agent 与 CLI 依赖构建                         | 通过，使用根已安装 turbo，不复用旧 task 产物                                         |
| model-option-map、Server/remote、Web 构建          | 通过                                                                                 |
| `pnpm test`                                        | services 63/63、UI 11/11，无失败/跳过，含物理重叠负例                                |
| identity + remote-chain UAT                        | 8/8，无失败/跳过                                                                     |
| cleanup 门禁                                       | 39/39，无失败/跳过                                                                   |
| 完整 Node CLI/Web 归档                             | 临时输出目录执行成功                                                                 |
| 仓库外解包 + 真实 install.sh 安装后的 CLI 技能检查 | 均识别 bundled dynamic-workflows，正文 92,391 字节，必需引用文件字节一致；模型请求 0 |

独立干净提交归档 SHA-256：

```text
4e93e00ecdad52846391edbe29a70aedfe23f9ea2366b5acd72f86a4e7b57c6a
```

首次在独立树内的 dist 输出打包已生成归档，但最终清理返回 ENOTEMPTY。只读核查残留仅 `.DS_Store`；该次命令记为失败。改用全新临时输出目录复跑打包、解包、真实安装均成功，没有为了消除该环境残留扩大修复范围。

干净树计数不同于候选工作区 68/16，原因是它不包含未提交 HOME/存储和 UI 新增测试/实现；不得把这些既有补丁写成已包含在本提交。

## 保留边界

原有 31 个未提交文件的内容指纹均保持不变。本次未强推、合并 main 或发布。Windows/Linux runner、真实 Electron/完整 Agent/模型工作流、SSH/WSL/Docker 和离线场景未执行；当前预检查也不宣称防恶意进程并发换链。上述未完成项不因干净构建通过自动关闭。
