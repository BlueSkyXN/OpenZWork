# ZCode v3.17.1 整合验收

## 基线与保留范围

- 上游固定为 `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`（镜像仓 `Program/ZCode` main，官方 tag v3.17.1，Source-Commit `73158b64`）；从 OpenZWork `3a6f31bd`（PR#57 后的 main）继续，以 merge commit 保留上游历史。合并基 `3c5b2276`（v3.16.2 sync 提交）。
- 延续 [3.16.2 的产品边界](upstream-v3.16.2-integration.md)：标准 MCP、ToolSearch、node_repl、Browser Use、动态工作流、GenUI/MCP Apps、本地/远程工作区和第三方模型配置继续保留；用户级目录 `.openzwork`、项目 `.zcode`、无账号 HMAC 配对、owner/lease 与 stale run 防护不变。
- 官方账号、套餐（codingPlan/startPlan/off-peak/Highspeed）、云端分享与反馈、遥测（ARMS/OTel）、自动更新、原生 CUA、官方网关路由与签名层、`zcode_official` 鉴权依赖官方 JWT 的内置插件（zcode-site/image-search 等 `auth.type=zcode_official`）保持移除；上游对已退役文件的修改逐项审查，不恢复整文件。

## 上游变更规模与结构

- 官方自删约 2058 文件（e2e fixtures、contract tests、旧 onboarding/remote-sync UI），新增约 900 文件（data-sync 域、zcode-site-plugin、CUA Windows 输入、engineering 测试框架、kimi-k3/minimax-m31 模板）；Electron 41.0.3→44.7.0、electron-builder→26.17.0；根 scripts 重组（`test:unit`→`test:engineering`，`verify:pre-push` 新增 worktree/remote-targets/stale-phrases 门禁）。
- 预演合并冲突约 3042：其中约 2531 为我方净化删除 vs 上游修改（delete/modify，保持删除），约 511 为双方修改（CLI runner/protocol、ui、desktop、services、shared 集中），逐文件按下方规则解决。

## 吸收的功能增量（预期）

1. data-sync 域（`packages/services/src/data-sync/` + 设置页「数据同步」）：本机配置推送远端设备。走既有 SSH/WSL/Docker 远端链路，无官方账号依赖，预期保留；但其「模型配置 Provisioning 下发」若依赖官方通道则裁剪该子项。
2. Electron 44 升级链（main/renderer/preload API 变化、electron-builder 26.17、镜像校验脚本）：随上游吸收，安装包构建矩阵复验。
3. engineering 测试框架与 pre-push 门禁重构（`test:engineering`、worktree 检查、stale-doc-phrases）：吸收框架；与我们 `.husky` 既有钩子的接线以最小改动适配。
4. 内置模型模板扩充（kimi-k3-1-pro、minimax-m31-flash 等 `docs/builtin-provider-maintenance/`）：属第三方模型配置域，保留。
5. 会话流、subagent 迁移、provider regression 工具、native-search 修正：按上游吸收。
6. CUA Windows 输入系列（docs/cua/*、9 个新增文件）：CUA 属已退役域（D-14），不吸收实现，spec 与测试不引入。
7. 上游对保留域的重构（mcp/plugins/tool-search/runner 既有文件的双修改冲突）：以「上游结构 + 我方净化语义」合成，官方端点与鉴权引用剥离。

## 冲突解决规则

1. delete/modify（我方已删、上游有改）：一律保持删除；但需比对上游改动是否含保留域修复（如既有 MCP 文件的安全修复），若有则把修复移植到存活的等价文件。
2. both-modified：先取上游版本，再重放我方净化语义（`.zcode`→`.openzwork` 身份、官方端点移除、遥测剥离）；无法机械合成的文件逐个人工审查。
3. `pnpm-lock.yaml`：依赖清单实际改变后按获准口径官方重算（`pnpm install --lockfile-only --ignore-scripts`），禁手编。
4. 上游新增文件中的官方域（off-peak runtime、highspeed、`@arms/rum-electron`、official-coding-plan-gateway、cua、zcode_official auth）：同步后统一剥离，不留死代码。

## 验证与交付

- 必须执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`、`pnpm db:schema:check`；新 scripts 门禁（stale-phrases、e2e-remote-targets）如被 pre-push 引用则一并跑通。
- 净化残留扫描：全仓 off-peak/codingPlan/ARMS/highspeed/official-gateway 引用为零（豁免清单除外）；`stage1` 升级检查同步更新。
- 上游来源缺陷按 [下游补丁清单](downstream-patch-registry.md) 对 v3.17.1 逐项复核未撤销条目。
- 交付可审查的 PR（含冲突解决策略与净化复检证据）；合并、正式 tag、Release 按用户明确授权执行，不移动现有发布 tag。
