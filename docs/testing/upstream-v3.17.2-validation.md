# ZCode v3.17.2 整合验证

本记录对应 `3.17.1+openzwork.2` → `3.17.2+openzwork.1` 的源码整合，产品范围见 [整合 spec](../spec/upstream-v3.17.2-integration.md)。本轮检查在 2026-11-05 的 macOS arm64 上执行，使用 Node 24.14.0、pnpm 11.28.6 和冻结锁文件安装的依赖。

- OpenZWork 基线：`e48ed9266e1a38e61d72060e8f943b170bd910ac`。
- 上游 tag：`v3.17.2`，提交 `a9fe401eede6e6e5e01be9048679c206fe6f02d9`。
- 采用双亲 merge 保留上游历史；版本、README、第三方声明和下游补丁复核记录同步更新。
- 本文记录本轮执行结果。覆盖矩阵中注明“上游”的历史记录保留其来源；云端结果以本次 PR 的 Actions 为准。

## 静态检查与运行时回归

| 检查                                              | 本轮结果                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 根 `pnpm typecheck`                               | 通过                                                                                |
| CLI `pnpm --dir apps/zcode-cli typecheck --force` | 30/30 任务通过，未使用任务缓存                                                      |
| Desktop `typecheck:e2e`                           | 通过                                                                                |
| 根 `pnpm lint`                                    | 0 errors，17 warnings                                                               |
| CLI `pnpm --dir apps/zcode-cli lint`              | 0 errors，87 warnings；14 项原样上游行数诊断按现有规则接纳                          |
| `architecture:check --changed`                    | 0 violations                                                                        |
| `db:schema:check`                                 | 8 项检查通过；Host 与 CLI 两个 schema baseline 兼容                                 |
| 净化扫描与下游补丁登记检查                        | 51/51 通过                                                                          |
| CLI 受影响测试                                    | contracts 7、adapters 51、core 337、bootstrap 246、CLI 入口 8，共 649 项通过        |
| 固定核心套件 `test:ci:core`                       | 63 文件、378 项通过                                                                 |
| 仓库脚本 `test:repo-scripts`                      | 192/192 通过，含真实 oxlint 进程回归                                                |
| CI 配置回归                                       | 99/99 通过                                                                          |
| 工程测试：E2E 准入、分片、平台裁剪                | 3 文件、33 项通过                                                                   |
| 工程测试：afterPack 与 native 打包策略            | 2 文件、18 项通过                                                                   |
| 会话 E2E 覆盖目录审计                             | 通过；6 份生成文档无陈旧项                                                          |
| 第三方声明                                        | 按实际生产依赖图 1125 个包版本重新生成，`readVerifiedNotices()` 验证 1,940,830 字节 |

CLI 入口测试使用 `node:test`，按 custom command、shell blocks、facade-reserved、unresolvable slash 和 command load failure 选择受影响场景。contracts 和 adapters 在冻结安装后再次执行并通过。

真实 Host SQLite 场景另有 16 项通过：远端父链归属、歧义 root、缺失或跨 workspace 父任务、已有归属与本地合法 NULL、时间和置顶/归档/未读字段保持、历史 migration checksum、ACK 与事实两种顺序、重复 ACK 后用户移动、关库重开幂等性。场景通过当前 migration 与 repository 创建隔离数据库，未操作用户数据。

## Electron 与手机 Web 场景

以下均运行真实 Electron、Host 和 Agent；需要模型响应的场景使用本地受控 replay。手机场景通过隔离 relay 连接同一个 Host，并使用 Chromium 窄屏页面。每次运行的 `summary.json`、测试结果、截图及 replay capture 保留在本地验收目录。

| 场景                              | 通过数 | 运行编号                                                |
| --------------------------------- | -----: | ------------------------------------------------------- |
| 本地 HTML 签名预览与访问边界      |      1 | `desktop-e2e-20261105085131760-p45386-276bc4144ab27598` |
| 自定义命令 shell handoff          |      2 | `desktop-e2e-20261105090213214-p64121-1efe7f70d8900654` |
| Explore 子代理审批委托            |      1 | `desktop-e2e-20261105090530741-p64946-5a56c40aeb210f24` |
| Plan MCP 审批与拒绝               |      1 | `desktop-e2e-20261105091310190-p66888-565b475fc8cd2b29` |
| MCP 失败诊断：桌面与手机恢复      |      2 | `desktop-e2e-20261105093221563-p72137-94d2148592dbe2b9` |
| 插件市场、草稿 MCP 与完全访问授权 |      1 | `desktop-e2e-20261105091859378-p68681-1330d3f374245f78` |

合计 6 组、8 个用例通过。插件场景验证未创建 session 父行时的草稿授权、绑定保持和作用域隔离。MCP 场景验证真实进程启动错误、敏感字段脱敏、刷新后旧错误消失，并复核中英文、明暗主题的手机截图。候选 E2E 仍保留原准入状态。

## 整合中修正的验证问题

- CLI Lint 原入口继承根目录对整个内层 CLI 的排除，导致部分包输出 `No files found`；全局补 `--no-ignore` 又会解析工作流图体语料。现在仅对没有包级 `.oxlintrc.json` 的包补该参数，并为已有存量大文件补齐包内相对路径。真实进程回归验证源码错误仍阻断、语料排除保留、800/801 行阈值与存量告警在两个锁定 oxlint 版本下成立。
- Bash、Explore、CLI 命令及插件夹具仍引用已退役遥测/CUA 或旧用户目录。按现有 OpenZWork 合同修正夹具，保留实际退出码、提示词正文、工具池、trace、权限和隔离断言。
- WDIO 默认排除范围与显式候选选择不一致；改用共享 glob 并允许显式执行候选。相关受控 replay 补齐固定项目、协议与模型能力配置。
- 手机 MCP 夹具按需动态加载 Vite，使用端口 0 时回填真实监听端口。截图等待弹层透明度与动画完成，避免把淡入中间帧作为布局证据。
- 恢复 Plan MCP E2E 使用的通用本地 server 夹具，保留官方 MCP 身份头专属代码与夹具的裁剪范围。

## 范围与剩余验证

- 16 项有效下游补丁已对 v3.17.2 逐项复核；3 项 retired 条目保持退役。OW-P012 的冷恢复测试随上游更新时保留既有模板复用、隔离断言和编号。其余相关上游文件未变化。
- CLI 类型检查仍有内层 workspace 的 Turbo 入口发现、lockfile 依赖闭包及 `office-runtime#build` 的 `outputs` 提示；30 个任务均强制执行成功。Lint 的 warning 和原样上游行数诊断已在上表列明。
- 全变更格式扫描报告 11 个文件的样式差异；对原始 v3.17.2 文件执行同一 formatter 可复现全部 11 项，其中 `architecture-policy.yaml` 在升级前已有差异。此次保留这些继承样式，未进行全文件格式重写。整合补充的脚本、测试、WDIO 配置及本文单独检查；`git diff --check` 通过。
- 覆盖目录审计沿用仓库现有状态：211 项产品场景中 112 项 covered、36 项 decision-needed；本轮验收范围是上表列出的升级场景。
- Windows/Linux 安装包、各平台原生 GUI、跨机器 SSH/远端草稿预热、外部 relay/tunnel 与真实模型 provider 尚未完成本轮实机验收。本机没有可用 Docker CLI，因此未执行容器远端场景。Host 数据归属与连续/可重放链路已有 SQLite 场景及 CLI 回归证据。
- 本轮交付源码与 PR；发布、安装和生产部署另行执行。
