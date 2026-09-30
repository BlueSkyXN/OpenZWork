# 迁移、远端 UAT 与 Node 发行修复验收记录

验证日期：2026-10-01，macOS arm64，Node 24.14.0、pnpm 10.33.2。

## 提交与范围

在现有 `fix/identity-path-ci` 分支分批实施并推送到 BlueSkyXN/OpenZWork；没有强推、合并 main 或发布。

| 提交                                       | 已实现                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `0d5134c56d7cb785df8034ade051cdd9635ec884` | 迁移目标普通目录/真实路径边界，拒绝越界复制、清理及 marker 访问；合成链接回归   |
| `0f24a761d28acac1be311ef4d672534bbdf18718` | Node 权限位替换 BSD stat；缺 bundle 必须失败；缺产物及不可执行文件负例          |
| `e85853764b84cd85c30b3ac44f9ad88a65364f15` | 普通 Node CLI/Web 发行完整 bundled-skills、必需文件验证、归档和真实安装技能冒烟 |

本次仅提交这些修复及对应 spec/测试。原有 HOME 技能/命令隔离、Desktop/Host 存储对齐、CI Action/Linux、会话用量 UI 等 31 个既有文件内容指纹未变，保持未提交，不混入修复提交。不合并历史分叉数据。

## 实际执行证据

- 迁移边界新测试修复前 1/10 通过、9 项预期违约失败；修复后连同既有迁移、双 worker 并发和 SIGKILL 重启 27/27 通过。全部数据为临时合成目录，不访问真实旧数据。
- 重建真实 remote server bundle 后，路径/UAT 8/8 通过，无跳过，包含缺 bundle 子进程非零退出及非执行位负例。
- 技能资产正例和三文件缺失/目录代替文件负例 5/5 通过。
- 现有 HOME/存储补丁定向 9/9 通过；Electron app API 为测试边界，实际配置解析、文件和 Node 子进程执行，不代表完整 Electron/Agent 验收。
- 最终完整 `pnpm test`：services 68/68、UI 16/16；路径/UAT 8/8；cleanup+CI结构 48/48；均无跳过。
- 根 `pnpm typecheck` 与 `pnpm architecture:check --changed` 通过，架构 violations/baseline/new 均 0；根 lint 238 个警告、0 错误，包含 local 历史副本，不进行警告清零。
- Agent/Server/Web 实际构建成功。内层找不到 turbo 时改用根已安装工具；发行 stage 要求 model-option-map dist，补执行该包现有 build 后组装成功。未修改依赖/锁文件。
- 实际归档 `dist/zcode-repair-20261001/releases/3.14.3/zcode-3.14.3.tar.gz` SHA-256：`cf7bfd09c35a8e88e904bae53c4dd157ed9aa02f92aeb443adfe7bc39c57f268`。
- `scripts/zcode-distribution-skills-smoke.mjs` 在仓库外临时 cwd/HOME 解包，再用真实 install.sh 安装真实负载；实际 CLI list/inspect 均识别 bundled dynamic-workflows，正文读取 92,391 字节，三个必需文件与源码字节一致。模型请求 0。

复现入口：

```sh
mise exec -- pnpm exec tsx --test packages/services/test/memory-migration-boundary.test.ts packages/services/test/memory-migration.test.ts
mise exec -- pnpm --filter @zcode/server build:remote
mise exec -- pnpm exec tsx --test tests/private-cleanup/remote-chain-local.test.ts tests/private-cleanup/identity-paths.test.ts
mise exec -- pnpm exec tsx --test packages/services/test/node-distribution-assets.test.ts
mise exec -- node scripts/zcode-distribution-skills-smoke.mjs <archive.tar.gz> <install.sh>
```

构建及测试子进程移除宿主 ZCODE\_\* 注入。归档来自候选工作区，包含上述尚未提交补丁及 UI 产物，**不是干净 e858537 checkout 的独立构建证明，也不是已发布安装包**。

## 仍未完成的边界

- GNU/Linux 和 Windows runner 实跑、升级 Action 的真实缓存/artifact 验收；本机没有 Linux 容器/虚拟机运行时，不将 Node API 替换写成 Linux 已实跑。
- 真正 SSH/WSL/Docker 传输、安装包远端资源首部署与完整 Agent 工具运行。
- 模型驱动的完整工作流创作/确认/执行；本次仅用实际 CLI 技能发现和加载，不伪造 provider 历史或声明工具 E2E。
- 真实 Electron 数据目录切换/重启、模型 Memory 工具、数据库恢复、安装/离线/GATE-C；完整 Desktop 类型覆盖及既有诊断仍按原边界处理。
- 迁移防恶意并发换链属于更强操作边界，当前检查不作此承诺。

因此关闭的是对应实现与本地定向证据，不关闭 `cleanup-acceptance-status.md` 中尚缺真实运行验收的项目，不宣称全产品完成。
