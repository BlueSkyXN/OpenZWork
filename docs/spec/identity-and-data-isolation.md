# Spec：产品身份与用户级数据根隔离（WP-03）

状态：现行有效。本文落实 `local/implementation-design/WP-03-identity.md` §3 步骤 5 要求的 spec 交付物
（设计稿原定路径 `docs/openzwork/specs/`，按仓库现行 spec 约定落位 `docs/spec/`，见 DEVELOPMENT_PLAN.md §8 维护记录）。

## 目的与范围

OpenZWork 是 ZCode 上游的私有净化分支。产品必须在用户机器上与官方 ZCode 的用户级数据
（`~/.zcode`）完全隔离：不读取、不写入、不复用其目录与命名空间，避免隐式继承官方账号、
凭据、配置与运行状态。本 spec 约束**用户级数据根**的解析与引用；项目仓库内部目录不在其列。

## 唯一事实源与核心不变量

- 产品数据根目录名常量唯一来源：`packages/shared/src/productIdentity.ts` 的
  `OPENZWORK_DATA_DIR_NAME = ".openzwork"`。TypeScript 业务路径派生自该常量（直接或经
  既有 env/布局链）；发行 shell 模板和远端部署根不能直接导入运行时常量，其落点须由 CI
  路径行为测试及结构断言与 `.openzwork` 契约保持一致，不得另开可配置的用户级真相。
- **核心不变量**（各进程必须最终同源）：Main、Host、Agent、CLI、Server 五类进程对
  「用户级数据根」的解析都落到 `{base}/.openzwork`（`base` 沿用上游既有的 HOME 链或
  `ZCODE_DATA_BASE_DIR` 链）。例外：`setting.json` 固定
  `{resolveUserHomeDir()}/.openzwork/v2/setting.json`。
- 远端链（SSH/WSL/Docker workspace）同源约束：
  - 部署目标与启动命令必须共用 `packages/server/src/remote/deployShared.ts` 的
    `REMOTE_BASE = "~/.openzwork/server"`；
  - shell 双引号串内 `~` 不展开，env 赋值用 `REMOTE_BASE_HOME_EXPR`（`$HOME/.openzwork/server`）；
    命令路径位置的 `~` 在词首未加引号可直接用 `REMOTE_BASE` 拼接；
  - `connect.ts` 启动远端 server 时注入 `ZCODE_SERVER_RUNTIME_ROOT`；
    `zcodeAgentBundleWrapper.ts` 的兜底值必须与 `REMOTE_BASE` 同源；
  - 远端 agent 复用该根下的 node 与 `zcode-server.cjs`，并经 `ZCODE_SERVER_RUNTIME_ROOT`
    解析 runtime tools。
- 发行安装脚本（`scripts/zcode-distribution/installer.mjs`）：`INSTALL_DIR` 默认
  `$HOME/.openzwork/runtime`，`ZCODE_DIST_HOME` 可显式覆盖。
- 全局 saved workflows：`{home}/.openzwork/workflows`（contracts 的
  `SAVED_WORKFLOW_GLOBAL_DIR` 派生自 `OPENZWORK_DATA_DIR_NAME`）。

## 登记豁免（B/D 类，允许出现 `.zcode` 字样）

1. **项目级目录**：`<cwd>/.zcode/**`（saved workflows 项目档、workflow-drafts、项目级
   AGENTS.md 候选等）位于用户仓库工作区内，属上游既有项目级约定，不在用户级隔离范围
   （D-03）。技能与命令的自动项目扫描必须排除用户主目录本身（含 realpath 等价路径）；
   即使 HOME 是 Git worktree 根，也不能把其中的官方用户目录当作项目配置。HOME 下的
   普通项目仍保留 `.zcode` 与 `.agents` 兼容扫描，用户级 `.agents` 仍可用。CLI 与设置页
   使用同一个 Node-only HOME 判定工具；设置页不得向 HOME 的原生项目命令目录写入。
2. **WP-E1a 记忆迁移**：`packages/shared/src/node/memoryMigration.ts` 及其 UI 文案
   （memoryMigrationHint、i18n locales）一次性**单向读取**旧根 `~/.zcode` 复制记忆数据，
   是唯一获批的旧根读取点；不得反向写入。其用户文案的测试夹具
   （`packages/services/test/memory-migration.test.ts`）逐字镜像上述文案，随本条一并豁免。
3. **政策与修复依据文本**：本 spec 与 `docs/spec/memory-migration.md` 以旧根路径定义
   隔离边界本身；`scripts/zcode-distribution/installer.mjs` 的注释引用被替换的旧默认
   目录（`$HOME/.zcode/runtime`）作为默认值变更的修复依据。开发态诊断/重放工具描述的
   是本产品自身的数据位置，不豁免——必须随数据根一并迁移（2026-09-27 已修
   README/NOTICE/shadow-replay/prompt-trajectory 六处过时引用）。
4. 其余如需豁免，必须在本节登记并由用户批准，不得以"注释/文案"为由绕过。

## 失败语义与验收

- 违反核心不变量 = 隔离破洞（设计稿 A 类），按"必须清零"处理，不算可兜底缺陷。
- 结构断言：`tests/private-cleanup/cleanup.test.cjs` 的 WP-03 块——按 **git 追踪清单**做
  全仓文本扫描（`ts/tsx/js/jsx/mjs/cjs/json/md/sh/yaml`，新增目录自动入列），用户级
  `.zcode` 引用（`~/.zcode`、`$HOME/.zcode`；`.zcode` 后不得再跟字母或连字符，排除
  `.zcode-dev-home` 等恰好同前缀的其他目录名）在豁免清单之外必须为 0；并正查关键落点
  （REMOTE_BASE 同源、installer 默认目录、全局 workflows 常量派生、内置技能全局目录说明
  必须与 `SAVED_WORKFLOW_GLOBAL_DIR` 一致）。
- CI 行为测试（`tests/private-cleanup/identity-paths.test.ts`）：在临时 HOME 下执行由
  `connect.ts` 生成的 shell 命令，核对实际可执行路径与注入的运行根；执行 wrapper 的兜底
  分支；以临时目录保存、列出并读回全局 saved workflow——HOME 内**预置旧根工作流**
  （旧根独有 + 与新根同名各一份），验证它们不被列出、不被解析、逐字节不变，同时证明
  不读且不写旧用户根。测试必须在内层 Agent workspace 构建之后运行，以使用实际
  contracts/core 导出。
- 本地 UAT（`tests/private-cleanup/remote-chain-local.test.ts`，CI 同跑）：真实 esbuild
  产物 zcode-server.cjs 从部署落位启动、完成 zcode-hello/ack 握手并物化配置到
  `.openzwork/v2`；真实 `LocalUploadAssetInstaller.installFile` 走完 staging→chmod→mv
  链；真实 install.sh 默认装到 `.openzwork/runtime` 并接好 bin 命令。三者都断言旧根
  `.zcode` 从未创建。传输层用本地 /bin/sh 后端替换 SSH/WSL/Docker；随包 agent 运行时
  与发行包内真实 CLI 负载（UAT 用 stub）不在其列。子进程一律用最小净化 env，防宿主
  （官方 App 终端）注入的 `ZCODE_DATA_BASE_DIR` 等变量把数据根吸回官方目录。
- 行为断言：`packages/services/test/paths-isolation.test.ts` 断言数据根解析为
  `.openzwork` 且非 `.zcode`。上述临时 HOME 测试不等于 SSH/WSL/Docker 实机连接或安装包 UAT。

## Desktop 子进程数据根对齐（2026-09-30）

- **唯一所有者**：Desktop Main 已选定的 `getDataBaseDir()`；Host、调度器、存储预备 Worker
  和本地 Agent 只继承 Main 构造的环境，不另行选择桌面持久化目录。
- `buildHostProcessEnv` 无条件下发 `ZCODE_DATA_BASE_DIR = dataBaseDir`、
  `ZCODE_STORAGE_DIR = join(dataBaseDir, OPENZWORK_DATA_DIR_NAME)` 和
  `ZCODE_SESSION_DB_PATH = join(storageRoot, "cli", "db", "db.sqlite")`，清除继承的旧
  `ZCODE_SESSION_DB` 别名。不能仅注入 storage.dir，留下独立默认的 sessionDbPath。
- Desktop 环境中这三个值覆盖 shell、dotenv 与 CLI 配置文件中的存储字段，避免界面与
  Agent 双根；直接启动 CLI 的 env > config > default 优先级不变。用户配置文件和
  `setting.json` 的既有固定 HOME 位置不变，远端机器不接收本机数据路径。
- **迁移边界**：本修复不自动搬迁旧默认根的新记忆或数据库、不合并两份会话库；已有
  数据保留原位。切换目录沿用既有 Desktop 数据目录复制与重启流程。

```text
Desktop setting.json → Main getDataBaseDir（唯一所有者）
  ├─ 记忆迁移 → 当前 dataBaseDir/.openzwork/cli/memories
  └─ buildHostProcessEnv → Local Host / scheduler
       ├─ services memory catalog → 同一根（只读投影）
       ├─ prepare-storage Worker → 同一 sessionDbPath
       └─ Agent config env → storage.dir / sessionDbPath → 记忆读写与会话持久化
```

## 新增回归验收

- `packages/services/test/home-resource-isolation.test.ts`：临时 HOME 中预置合法旧技能、旧命令
  与新根资源，CLI 发现/加载与设置页列表不读旧根；HOME 含 `.git`、子目录、等价路径均
  不放行 HOME；普通项目兼容资源仍可用，旧文件逐字节不变，HOME 项目命令创建被拒绝。
- `packages/services/test/desktop-agent-storage.test.ts`：执行真实 `buildHostProcessEnv`
  （Electron app API 替换为 Node 测试宿主，services/node 边界转导出真实 paths 模块，
  未使用的 SSH 列表入口禁止调用），经真实 CLI 配置解析，验证默认与自定义根、冲突
  shell/dotenv/config 值和 DB 别名；两个真实 Node 子进程继承此环境并解析到同一根，
  但不替代真正的 prepare-storage Worker 或 Agent runtime 启动。真实文件系统记忆文件
  由 CLI 根定位并经 services catalog 与 recall 读取，重载后仍是同一文件；远端 env
  过滤器不转发本机路径。
- 子进程脚本的 ESM 模块说明符必须由 `pathToFileURL(configModule).href` 生成，Windows 盘符、空格与特殊字符不能被误当作 URL 协议或片段；配置与 cwd 仍使用普通文件系统路径。该用例在 Windows CI 执行，不新增平台 skip。
- 定向自动化不等同于真实 Electron 重启、安装包、SSH/WSL/Docker 或模型请求验收。

### 2026-09-30 本地验证记录

- 两个新增测试文件共 9 项通过；修复前的 HOME 隔离与 Desktop 目录对齐场景先确认失败。
- `pnpm test`：services 53 项、UI 16 项通过；`identity-paths.test.ts` 3 项通过；
  `cleanup.test.cjs` 39 项通过。
- `pnpm typecheck`、根 `pnpm lint`、`pnpm architecture:check --changed` 通过；
  CLI adapters 类型检查与本次两个 roots 文件的定向 Lint 通过。
- 扩展检查未全绿：CLI adapters 全包 Lint 有 23 个既有错误；Desktop Main 单独类型
  检查有 73 个错误。用 TypeScript Compiler API 在内存中替换回 HEAD 的 desktopRuntimeEnv
  后，前后错误集合相同（73 项、零新增），未恢复或修改工作树以进行基线对照。

### 2026-10-03 子进程导入路径修复

- Desktop 存储测试生成的 ESM import 改为 file URL，消除 Windows 盘符被识别成协议的问题，不修改普通配置路径与 cwd，不跳过 Windows。
- Node 24.14.0 的 macOS 定向 Desktop 存储测试 4/4，完整包测试 services 79/79、UI 16/16；真实 Windows runner 验证尚未执行。
- 全部未跟踪文件用临时索引纳入私有化结构扫描后 39/39。Computer Use 文档已独立撤回旧方案并区分工程归属，本轮保留现有内容，未增加隔离豁免、未恢复 CUA 或引入官方二进制。

## 迁移边界

产品未正式发布，无既有用户数据兼容义务；官方旧数据不自动迁移（WP-E1a 记忆迁移的单向
复制除外）。远端机上的旧官方 `~/.zcode/server` 不被读取、不被复用、不被覆盖。
