# CUA 占位影响与验证

## Feature Summary

| 字段                          | 内容                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Developer intent / Capability | 保留空兼容入口，取消原生 CUA 产品支持                                                                          |
| Change layer / Operating mode | presentation、validation、commit-effect；planning                                                              |
| Primary seeds                 | `computer-use-producer.mjs`、`dev-desktop-env.mjs`、`prepare-runtime-assets.mjs`、`electron-builder.config.js` |
| Out of scope                  | Browser Use 页内控制、第三方通用 MCP、会话与远控协议、用户数据迁移                                             |

## UI Surface Matrix

| 场景 / UI 入口  | 共享实现与状态 owner            | 默认、校验与提交                                     | 模式与隔离要求                                    |
| --------------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| 设置与 Composer | 已无 CUA 组件或 store           | 不新增开关、授权或不可用卡片；无 CUA 提交路径        | Desktop / Web / Mobile 一致；Browser Use 设置独立 |
| 插件和技能发现  | 官方 definition / CLI discovery | 保持不注册 CUA；保留 Browser Use 与 `node-repl-host` | 第三方来源仍走通用机制                            |
| 资源管理说明    | Renderer i18n 文案              | runtimes 描述只列 Agent 运行时和插件                 | 中英文一致；不修改数据盘点与清理规则              |

## Shared And Divergent Behavior

| 关注点                 | 共用行为                     | 独立行为 / 本次处理                  |
| ---------------------- | ---------------------------- | ------------------------------------ |
| UI / option source     | 通用插件、技能与工具展示保留 | 无 CUA 专属入口或样式                |
| Default / validation   | 兼容占位固定不可用           | 不读取本机 producer，旧 env 无法启用 |
| Commit effect          | 普通 dev 与打包步骤继续执行  | CUA 编译、资源准备与环境注入不执行   |
| Persistence / recovery | 现有数据与远控恢复不变       | 无 CUA 新状态或迁移                  |

## Feature Relationships

| Rank           | From → Semantic edge → To                          | 理由与证据                                                                               |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| must-inspect   | dev → prepares → Helper                            | `scripts/dev-desktop-env.mjs` 曾按本机 producer 恢复构建与 env                           |
| must-inspect   | runtime preparation → stages → 原生资源            | `prepare-runtime-assets.mjs` 与 `ensure-local-runtime-assets.mjs` 曾要求权限浮窗定位程序 |
| must-inspect   | packaging → ships → 原生资源                       | `electron-builder.config.js` 曾携带定位程序及 CUA 签名例外                               |
| should-inspect | resources UI → describes → runtime 类别            | 中英文描述曾包含 Computer Use                                                            |
| invariant-only | CUA 占位 → must-remain-isolated-from → Browser Use | 浏览器 `cua` / `dom_cua` 不属于原生桌面 CUA                                              |

## State Owners And Commit Sinks

无新增状态。兼容入口只返回固定空结果；正常构建 owner 仍为既有脚本。UI 无 CUA 草稿、提交命令或持久化落点；Host/session、workspace identity 与 replay owner 不变。

## Must-Preserve Invariants

- Browser Use、`node_repl`、通用 MCP 与插件发现继续使用既有入口。
- 不读取、改写或清除用户 CUA 缓存、权限、签名或配置。
- CUA 旧环境变量和残留 producer 不触发 native IO。
- macOS、Windows、Linux 的占位策略一致，保留一般原生资源与发布签名规则。

## Codegraph Evidence

当前工具环境没有 codegraph 接口或索引；以下为源码直接引用检查，不能声称完成 codegraph 分析。

| Seed                             | 查询与直接路径                                  | Depth | 解释                       |
| -------------------------------- | ----------------------------------------------- | ----- | -------------------------- |
| `readComputerUseProducer`        | producer detector → dev / runtime preparation   | 2     | 移除激活路径，保留空接口   |
| `stageDevCuaPluginRuntime`       | `build-desktop-agent-cli.mjs` 三个兼容调用点    | 1     | 调用形式保留，暂存无副作用 |
| `resolveDevDesktopWindowsCuaEnv` | dev launcher                                    | 1     | launcher 不再注入 CUA 环境 |
| macOS window bounds helper       | dev 自检 / runtime preparation / extraResources | 2     | 三个消费点均解除依赖       |

## Graph Drift Candidates

原图没有原生 CUA 退役边界。已确认的 Browser Use 节点继续表示浏览器内控制；不能据其 `cua` 名称扩展到桌面控制。

## Graph Delta

增加 `capability.cua-placeholder-boundary` 及与 Browser Use 分发、共享 node_repl 的隔离边；记录用户确认的不可用策略与兼容入口，不增加 UI surface。

## Unresolved Questions

无。用户已明确“保留占位留空，但是 UI 等不对此纳入支持”。

## Planning Handoff

| 项目                           | 落点与状态                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| Spec                           | `docs/specs/cua-placeholder-boundary-openzwork.md`；已明确规则                |
| Case catalog / Coverage matrix | 本文 CUA-001～006；随执行补充证据                                  |
| Decision backlog               | 无未决产品问题                                                     |
| E2E handoff                    | 无新交互；保留 UI 缺席与 Browser Use 隔离检查，不生成 CUA 操作用例 |

## Clarification Log / Boundary Decisions

本次用户决定取消原生 CUA 支持，保留空占位。接受 CUA-001～006；不恢复官方 producer、Helper、权限 UI 或插件。不更改用户数据和第三方通用 MCP。

## Domain Scope / Concept Map

包含工程构建、能力发现和资源说明；排除会话执行、远端恢复与模型行为。占位表示无实现与无副作用；Browser Use 表示内置浏览器页内控制。

## State Owners / Dimensions

无 CUA owner。保留会改变验证结果的维度：producer 缺失/真实/占位/损坏，旧 env 有/无，macOS/Windows 入口，中英文 UI。其他 workspace、主题和远控组合由无新增状态与入口的不变量剪枝。

## Candidate Combinations / Pruning Decisions

| ID      | 状态、事件与目标                        | Guard / effect                          | 决定     |
| ------- | --------------------------------------- | --------------------------------------- | -------- |
| CUA-001 | 各 producer 状态 → detector             | 固定不可用，无清单读取                  | accepted |
| CUA-002 | 旧 env / 缺失目录 → compatibility entry | 空结果，无文件副作用                    | accepted |
| CUA-003 | 各平台 Helper 命令 → native build       | 直接结束，无 native 子进程              | accepted |
| CUA-004 | 正常启动与资源自检                      | 保留一般步骤，省略 CUA 步骤             | accepted |
| CUA-005 | 打包配置                                | 无 CUA 专属资源与签名规则               | accepted |
| CUA-006 | 设置 / Composer / 插件 / 中英文         | 无 CUA 支持入口与声明，保留 Browser Use | accepted |
| CUA-P01 | CUA 权限、执行、重连、升级组合          | 未注册执行链，无状态 owner              | pruned   |

## Questions For User

无。

## Accepted Cases / Matrix Backfill

| Case         | Setup / Action / Assertions                                                    | Evidence / E2E status        |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------- |
| CUA-001～003 | 临时 producer 与目录夹具，调用真实兼容函数及 CLI，断言不可用、空结果与无生成物 | 真实函数与空命令工程测试通过 |
| CUA-004～005 | 检查真实入口与打包配置，断言无 CUA 准备或资源依赖                              | 真实配置与入口边界检查通过   |
| CUA-006      | 检查实际 UI 入口、官方定义与中英文文案；保留浏览器协议                         | 源码边界检查；不计作桌面 E2E |

验证集中使用现有 producer / Sharp 工程套件并纳入固定核心清单；无会话 case catalog 或状态空间变更。

## E2E Handoff Notes

不需要模型 provider fixture、真实账号或 CUA 权限。文件夹具全部位于临时目录；占位调用不等待定时器、不启动 native helper。没有新增交互，因此本项不声称 CUA 桌面操作 E2E 通过。

## 执行证据

- Node 使用 `mise.toml` 固定的 24.14.0，pnpm 11.28.6。
- `pnpm test:engineering packages/desktop/test/placeholderProducerDetection.test.ts packages/desktop/test/sharpComputerUseRequirement.test.ts`：2 文件、16 项通过。
- 相邻工程回归：`desktop-native-package-policy.test.ts`、`desktopProductIdentity.test.ts`、`devDesktopRemoteProdScript.test.ts`，共 25 项通过。
- `pnpm typecheck`：通过；`pnpm lint`：0 error，15 项告警均位于本次未修改的文件。
- `pnpm architecture:check --changed`：0 violation；CUA 图节点、文档、精确代码 seed 与隔离边检查通过。该架构检查对旧工程脚本的覆盖有限，副作用边界另由上述工程回归验证。
- 新工作区的迁移回归依赖 CLI storage 构建产物；先运行 `pnpm --filter @zcode/adapters... build` 生成工作区依赖，不修改产品源码。
- `pnpm verify:pre-push`：通过；SQLite schema 回归 8 项、架构工程回归 51 项、固定核心套件 65 文件 / 394 项全部通过。私有远端队列不存在时，目标检查按原规则跳过。
- 未构建三平台安装包，未执行桌面 UI E2E；UI 证据为入口缺席与支持文案检查，不作为运行截图验收。
