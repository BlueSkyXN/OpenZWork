# Spec：WP-E1a 记忆数据迁移与可见性修复（P0）

- 工作包：WP-E1a（快赢包，诉求 6「记忆功能显示更全」的 P0 切片）
- 状态：**实现已落地；临时目录定向自动化检查通过；真实 Desktop/CLI 启动、真实 UI 开关操作及 Desktop+agent 双触发验收仍待完成**。本 spec 定型记忆数据根迁移（`~/.zcode` → `~/.openzwork`）的产品规则、触发点、幂等边界与验收场景，是 E1a 实现与验收依据；未完成项不能视作通过。
- 依据：`local/feature-eval-20260922/DECISIONS-AND-PLAN.md` §WP-E1（E1a）、§4 不变纪律；`local/feature-eval-20260922/REPORT.md` §诉求 6（含审阅意见：CLI recall 同读不到旧根）。
- 代码基线：`wp-e1a/memory-migration` 分支，HEAD `412188a`。文中 `path:line` 均为该基线实测位置（报告原文行号已按此基线修正漂移）。
- 上下游：后续 WP-E6（记忆内容查看器与列表增强）以本 spec 的数据根结论为前提；WP-E5（从 ZCode 导入）负责 `~/.zcode` 下**其余**数据（插件/技能/MCP 配置），与本文范围互斥。

---

## 1. 背景与已证实事实

WP-03（783be9f）把用户数据根从 `~/.zcode` 改名为 `~/.openzwork`，但**没有迁移任何记忆数据**（该提交 96 个文件中无 memories 迁移条目，仅保留了 MCP 的 legacy 读取）。后果是老用户的既有记忆对 UI catalog 与 CLI recall 双边不可见。

数据布局与链路（本基线逐环实测）：

- 记忆数据 = CLI 进程写下的 Project Memory 文件树：`<storageRoot>/cli/memories/projects/<slug>-<16位hash>/memory/`（`MEMORY.md` 索引 + `.md` 主题文件）。目录名由 `resolveProjectMemoryRoot` 生成：hash = workspaceIdentity（回退 workspacePath）的 SHA-256 前 16 位（apps/zcode-cli/packages/core/src/memory/project-root.ts:10-24）。
- UI 读根：`getZCodeDataRootDir() + cli/memories/projects`（packages/services/src/memory/memoryService.ts:19-21；getZCodeDataRootDir = `{dataBaseDir}/.openzwork`，packages/services/src/paths.ts:42-45）。目录不存在时 catalog 返回 `[]`（memoryService.ts:117-123 ENOENT 容错）。
- CLI 读写根：`resolvePath(config.storage.dir)`（默认 `~/.openzwork`，apps/zcode-cli/packages/contracts/src/config/index.ts:301-303），经 `getCliStorageRoot` 拼出 `cli` 子目录（apps/zcode-cli/packages/bootstrap/src/app/paths.ts:5-7），注入 `config.memory.cliStorageRoot`（create-app.ts:198-199），recall 的 manifest 扫描以该根单根递归（core/src/memory/recall/manifest.ts，上限 200 文件）。**仓内无任何记忆 legacy 回读。**
- 本机（2026-09-23 spec 撰写时复核）：`ls ~/.zcode/cli/memories/projects | wc -l` = **28** 个项目目录（`*/memory` 子目录 28 个均在），其中含 `MEMORY.md` 索引者 **19** 个（评估报告口径 18，差异不影响结论；spec 以 19 为准）；`ls ~/.openzwork` = **No such file or directory**。即：memoryService 的 catalog 在本机恒空，CLI recall 同样扫不到任何历史记忆。
- `memoryEnabled` 默认 false（并列因素）：settings schema `z.boolean().default(false)`（packages/shared/src/validationAppSettings.ts:436）、onboarding 回填 `?? false`（packages/services/src/onboarding/onboardingRecordService.ts:156）、UI 读取 `=== true`（packages/ui/src/SettingsPage.tsx:265）、Host 会话偏好 `=== true`（packages/services/src/node.ts:620）；关闭时 CLI 被强制 `memory:{enabled:false}` 完全停写（apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts:3265-3267），且设置页 viewer 整块渲染 null（packages/ui/src/settings/MemorySettingsSection.tsx:177）。
- 自定义目录分叉（并列因素）：desktop host 读根跟随 `setDataBaseDir`/`ZCODE_DATA_BASE_DIR`（paths.ts:29-40），但 desktop spawn agent 时只在 `dataBaseDir !== homedir()` 时下发 `ZCODE_DATA_BASE_DIR`（packages/desktop/src/main/desktopRuntimeEnv.ts:507），而 CLI 配置只认 `ZCODE_STORAGE_DIR`（apps/zcode-cli/packages/adapters/src/config/env-config.adapter.ts:26-28）→ 自定义 dataBaseDir 下 agent 写 `~/.openzwork`、UI 读 `<custom>/.openzwork`。

## 2. 必答项裁决

### 2.1 一次性迁移 vs legacy 回读 → **一次性单向复制迁移**

**裁决：一次性单向复制（copy）迁移，不做 legacy 回读。** 理由：

1. **数据布局同构**：旧根与新根的 `cli/memories` 目录树结构完全一致（仅数据根改名，无格式转换），copy 迁移零转换成本。
2. **legacy 回读必然长期双根**：recall（manifest 单根递归）与 catalog（memoryService 单根枚举）是两条独立读链，回读要求两条链都加 fallback；而 CLI 写入永远落新根，同一 workspace 的记忆会分裂在旧根（历史）与新根（新写入）两处，recall 的 200 文件截断语义混乱，且违反「单一数据根」纪律。
3. **仓内先例均为 copy**：`copyDataDirectory`（services/src/paths.ts:227-251，`cp recursive + force:false` + filter 排除/跳过 symlink）与 `migrateUserSubagentMarkdown`（shared/src/node/subagentMarkdownMigration.ts:69，tmp+rename 原子写、失败保留原文件）。本迁移为满足并发 no-clobber，改用同目录唯一 tmp + 硬链接排他提交（见下文），不复用可覆盖目标的 rename。
4. **可回滚**：旧根只读保留、绝不删除（报告风险条款），迁移错误最坏情况是新根多出可删目录。

**迁移规则**：

- **源（固定）**：`{homedir()}/.zcode/cli/memories` 整棵树。改名历史是绝对路径事实，不因目标自定义而改变。源不存在（ENOENT）→ **no-op 直接返回，不写幂等标记**（每次启动仅一次 lstat，可忽略；这样「先跑新版、之后旧根又出现数据」的边缘序列仍能被下次启动拾起）。
- **目标（参数化）**：调用方传入的当前生效 storageRoot 下的 `cli/memories`（desktop 侧 = `getZCodeDataRootDir()/cli/memories`；CLI 侧 = `resolvePath(config.storage.dir)/cli/memories`）。目标已存在的文件**不覆盖**。
- **复制语义 = 逐文件 no-clobber**：目标文件存在 → 跳过；不存在 → 复制到同目录 `.{name}.memory-migration-{randomUUID}.{pid}.tmp` 后以硬链接原子提交目标，目标一旦出现即为完整内容。普通 `rename` 在 POSIX 会替换并发中新出现的目标文件，不能满足 no-clobber；同目录硬链接排他创建遇 `EEXIST` 即跳过。跳过 symlink（对齐 memoryService 的 symlink 拒绝边界与 copyDataDirectory 的 filter 先例；迁移进去的 symlink 会被 catalog 忽略但可能被 recall 跟随，故不迁）。目录递归创建（mkdir recursive）。
- **范围 = 仅 `cli/memories` 一棵树**（本机实测旧根 memories 下仅 `projects` 一个子目录）。不迁 `~/.zcode` 下其余数据（db/plugins/config/skills 等，归 WP-E5 与其它包），不删旧根任何内容。
- **tmp 残留清理**：迁移开始时仅清理符合本迁移格式且所属 PID 已不存在的目标树 tmp 残留（中断进程遗留）；保留当前/并发活跃 PID 的文件，避免并发首启删除仍在复制的 tmp。硬链接提交后正常路径无残留。
- **hash 不重算**：目录名（`slug-<hash16>`）原样搬运。catalog 按目录枚举，不受 hash 影响；recall 命中依赖目录名与现行生成规则一致（本机旧目录名形状 `2026ai-2f055f2c1683c5b6` 与 project-root.ts:13-18 现行规则一致）。若个别项目的目录名来自更老的 hash 算法，表现为「该项目记忆不出现在该项目会话的 recall 注入中，但仍可在设置页 catalog 查看」，**不做 hash 重写**（会破坏目录与历史 journal 的一致性），记入 §8 已知限制。

**幂等标记**：

- 位置：`{targetStorageRoot}/v2/memory-migration.json`（bootstrap/状态区，与 agents-state.json 同层，先例 bootstrap/src/subagents.ts:53；**不放** `memories/` 内，避免污染 CLI 数据树）。
- 内容（zod schema，见 §5）：`{ version, source, target, completedAt, filesCopied, filesSkipped }`，`atomicWritePrivateTextFile`（shared/src/node/privateFilePersistence.ts:88）原子写入。
- 判定顺序：标记存在 → 直接跳过（**性能幂等**：免每启扫描；一旦迁移完成，后续即使旧根再变化也不重迁——一次性语义，防长期双根写入歧义）；标记不存在 → 执行逐文件 no-clobber 迁移（**行为幂等**：自身可重入）→ 写标记。
- **中断恢复**：迁移中途崩溃 → 标记未写 → 下次启动重入；已复制文件因 no-clobber 跳过、未复制文件续传；tmp 残留被清理。无需断点记录。
- **双进程并发**（desktop main 与其 spawn 的 agent 同启）：文件级 tmp 唯一名 + 硬链接排他提交，两个写者内容同源（同一旧根文件）；遇目标 `EEXIST` 时保留先提交者，最终一致、无撕裂或覆盖；仅写者清理自己的 tmp，启动清理仅移除所属 PID 不存在的本迁移 tmp。标记原子写不撕裂。**不加进程锁**——文件提交本身满足 no-clobber，不需要串行启动。定向自动化覆盖两个独立 worker 并发 helper；实际 Desktop + spawned-agent 双触发仍待集成验收。

### 2.2 迁移触发点：desktop 与 CLI 双入口，同一实现

**实现落点：`packages/shared/src/node/memoryMigration.ts`（新文件），经 `@zcode/shared/node` 公开导出。**

> 与报告建议的落点（packages/services/src/memory/）不同，原因：CLI 的 bootstrap 与 adapters 均不依赖 `@zcode/services`（apps/zcode-cli/packages/bootstrap/package.json 依赖表实测仅 `@zcode/shared` 等），迁移逻辑落 services 则 CLI 侧无法复用、必然双实现。shared/node 是 desktop main（先例 desktopDataBaseDirBootstrap.ts:5 已同时 import `@zcode/services/node` 与 `@zcode/shared`）与 CLI bootstrap 的共同最低层，且已有 subagentMarkdownMigration 先例。

| 入口 | 触发点 | 目标根 | 时机保证 |
| --- | --- | --- | --- |
| **desktop** | `packages/desktop/src/main/index.ts`，`setDataBaseDir(bootstrapSettings.dataBaseDir)` 之后（:1061-1063，该处注释明确「在所有 host 进程启动前生效」） | `getZCodeDataRootDir()/cli/memories` | main await（try/catch，失败 warn 不阻塞启动）；赶在窗口创建与 agent spawn 之前，renderer 首次 `listProjectMemories` 必见迁移后数据 |
| **CLI（无桌面）** | `bootstrap/src/app/create-app.ts`，`storageRoot = resolvePath(...)`（:198）之后、`loadZCodeAgentProfiles`（:204，同为「loader 前迁移」先例）之前 | `join(storageRoot, "cli", "memories")` | app 构造期 await，先于任何 session/recall。TUI、headless prompt、app-server 全部经 `createZCodeApp`（zcode-protocol-entrypoint.ts:16、cli/src/prompt-command.ts 实测），单点覆盖所有 CLI 形态 |

- 双触发的幂等：默认场景（无自定义目录）两侧的标记文件是同一路径（`~/.openzwork/v2/memory-migration.json`）——先到者迁移并写标记，后到者读标记直接跳过；并发首启由 §2.1 的 no-clobber 语义兜底。
- 迁移函数接收调用方 logger（desktop main 的 main logger / bootstrap 的 loggerFactory，module 名 `memoryMigration`），**不在 shared 内自建日志器**；UI 与服务日志纪律按 AGENTS.md（本函数属 shared 工具，非 services 服务，不引入 createServiceLogger 依赖）。

### 2.3 memoryEnabled 默认值 → **维持 false**（建议裁决，可推翻但需新理由）

维持现状四处一致的 `false` 默认（validationAppSettings.ts:436、onboardingRecordService.ts:156、SettingsPage.tsx:265、node.ts:620）。理由：

1. **隐私默认**：开启即允许 CLI 把 workspace 内容写入用户目录 Markdown 并注入后续会话系统提示词（token 成本 + 内容外泄面），默认关闭符合最小惊讶。
2. **迁移与开关正交**：E1a 修复的是「数据可达性」；开关管「功能启用」。迁移后**已开启用户立即恢复可见**；未开启用户打开开关即见（`MemorySettingsSection` 的 effect 会在 `memoryEnabled` 变 true 时自动拉取 catalog，MemorySettingsSection.tsx:90-101），无需数据层面强开。
3. **改动面大**：默认改 true 需四处联动 + 协议语义复核（server-operations.ts:3267 只在关闭时写 override，强开会反向覆盖用户已有的 CLI 禁用配置），是独立产品决策，不属于 P0。

**配套切片（入 E1a 范围）——开关引导文案**：`memoryEnabled === false && projectMemoryViewerAvailable` 时，设置页开关卡片下方渲染一条中性说明（zh/en 成对新增 `settings.memory.migratedHint`，复用 SettingsGroupCard 现有结构）：说明开启后将读取本机 `~/.openzwork/cli/memories` 下的工作区记忆、旧版本（`~/.zcode`）数据会在启动时自动迁移。**静态文案、无 IPC、不读迁移标记**（迁移是否发生与文案无关，避免把迁移状态引入 UI 状态域）；「检测到 N 条记忆」之类的动态空态归 WP-E6。Web/远端维持 localOnly 占位不变（MemorySettingsSection.tsx:173-176）。

### 2.4 自定义 storage.dir / dataBaseDir 在场时的优先级

| 场景 | 判定 | 行为 |
| --- | --- | --- |
| 默认根（storage.dir 解析为 `~/.openzwork` 且 dataBaseDir = homedir） | 绝大多数用户 | 自动迁移（§2.1） |
| **CLI 显式自定义 storage.dir**（`ZCODE_STORAGE_DIR` env 或 config 文件覆盖，解析结果 ≠ 默认根） | 用户主动选址 | **跳过自动迁移**，记一条 info（含源与目标路径）。理由：显式自定义与「改名遗留」是两类意图（如新机器复用旧 home 的场景），自动搬运可能违背用户预期；跳过是保守 fail-open——旧数据原样留在旧根，用户可手动复制。源 == 目标（显式指回 `~/.zcode`）同样跳过（no-op 防护） |
| **desktop 自定义 dataBaseDir**（bootstrapSettings.dataBaseDir / `ZCODE_DATA_BASE_DIR`） | desktop 设置的「数据目录迁移」功能 | **照常迁移**，目标 = `{dataBaseDir}/.openzwork/cli/memories`（读哪个根就迁到哪个根，UI catalog 立即可见）。已知限制见 §8：该场景下 CLI agent 的新写入仍落 `~/.openzwork`（P0-2 分叉），完整对齐不在 E1a |

判定实现：迁移函数新增「目标根是否为默认根」的判定**由调用方做**（desktop：`getDataBaseDir() === homedir()` 可直接比对 paths.ts:34-40 的输入；CLI：`resolvePath(config.storage.dir)` 与 `resolvePath(默认值 "~/.openzwork")` 字符串比对），shared 函数只收 `source`/`target` 两个显式参数保持纯函数可测性；「跳过自定义」是调用点策略，不是 shared 逻辑。

## 3. 产品规则

1. **一次性**：每台机器、每个数据根至多自动迁移一次（幂等标记判定）。迁移完成后旧根变化不重迁。
2. **只读保留旧根**：任何路径不删除、不修改 `~/.zcode` 下内容；迁移是纯增量复制。
3. **迁移与开关解耦**：迁移无条件于 `memoryEnabled`（关闭时数据也要就位，开开关即见）；开关默认维持 false（§2.3）。
4. **不覆盖新数据**：目标已存在的文件一律跳过（no-clobber）；用户已在新版产生的记忆优先于旧根同名文件。
5. **迁移失败不阻塞启动**：desktop main 与 CLI create-app 均为 try/catch + warn，迁移异常不改变启动结果；下次启动因无标记而自动重试。
6. **自定义 storage.dir 不自动搬**：用户显式选址视为拒绝自动迁移（§2.4），但 info 日志必须可诊断。
7. **零运行时耦合**：迁移完成后，读写链路（catalog/recall/写入）不感知旧根存在——不存在回读分支、不存在双根合并。

## 4. 状态所有者与写入路径

| 状态 | 唯一所有者 | 写入路径 | 说明 |
| --- | --- | --- | --- |
| 记忆数据文件 | CLI 进程（runtime Memory 工具链，`config.memory.cliStorageRoot` 为根） | Memory 写入链（project-root.ts 定位） | 迁移是**唯一例外**的一次性引导期写入：仅 touch 目标根 `cli/memories` 树 + `v2/memory-migration.json`；运行期无第二条写入路径 |
| `memoryEnabled` | `{envHome}/.openzwork/v2/setting.json`（appSettings.memoryEnabled，钉在 env HOME，**不跟随 dataBaseDir**，settingService.ts:40-49 + copyDataDirectory 排除 setting.json 的注释） | UI `updateSharedSettings`（SettingsPage.tsx:424）+ onboarding record 同步（onboardingRecordService updateRecordPreferences） | 会话偏好经 node.ts:620 读取下发给 protocol 层，server-operations.ts:3265-3267 只在关闭时强制停写 |
| 迁移幂等标记 | `{targetStorageRoot}/v2/memory-migration.json` | 仅迁移函数（shared/node），原子写 | desktop 与 CLI 双触发共写同一文件（默认场景），标记即「该数据根已迁移」的唯一事实 |
| dataBaseDir | setting.json 的 `dataBaseDir` 字段 | `updateDataBaseDir`（settingService.ts:294-314，copy 时排除 setting.json） | 决定 desktop 侧 getZCodeDataRootDir 的根 |
| CLI storage.dir | CLI config（env ZCODE_STORAGE_DIR > config 文件 > 默认 `~/.openzwork`） | CLI 配置体系（adapters） | 决定 CLI 侧记忆读写根 |

**禁止事项**：UI 不感知迁移（无迁移状态 store/IPC）；memoryService 不新增写入面；不把旧根路径引入运行时读链。

## 5. 接口

新增（`packages/shared/src/node/memoryMigration.ts`，经 `packages/shared/src/node.ts` 导出）：

```ts
export interface MemoryMigrationResult {
  status: "migrated" | "noop-source-missing" | "noop-marker-present";
  filesCopied: number;
  filesSkipped: number;   // no-clobber 跳过 + symlink 跳过
  failures: Array<{ path: string; error: string }>; // 单文件失败不中断整体
}

/** 一次性单向复制迁移：source → target，逐文件 no-clobber，幂等标记在 target 的 v2 下。 */
export async function migrateLegacyProjectMemories(input: {
  sourceMemoriesRoot: string;   // 旧根 cli/memories（调用方拼好）
  targetStorageRoot: string;    // 新 storageRoot（函数内部拼 cli/memories 与 v2 标记）
  logger?: { info: (m: string, ctx?: object) => void; warn: (m: string, ctx?: object) => void; debug: (m: string, ctx?: object) => void };
}): Promise<MemoryMigrationResult>;
```

标记文件 schema（zod，shared）：

```ts
export const memoryMigrationMarkerSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  target: z.string(),
  completedAt: z.string(),   // ISO 8601
  filesCopied: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
});
```

调用点改动：

- `packages/desktop/src/main/index.ts`（setDataBaseDir 之后）：默认根判定 → 调用迁移。
- `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`（:198 之后）：默认根判定 → 调用迁移。
- `packages/ui/src/settings/MemorySettingsSection.tsx` + zh/en i18n：开关引导文案（§2.3）。
- 修复性注释用中文说明原因与依据；zh/en 文案成对。

## 6. 事件顺序图（文本时序）

### 6.1 desktop 链

```
desktop main 启动
  │ applyEarlyDataBaseDirBootstrap() ── setDataBaseDir(早期，防 logger 先建目录)
  │ mainSettingService.get() ── setDataBaseDir(bootstrapSettings.dataBaseDir)  [main/index.ts:1061]
  │
  ├─【新增·所有者=迁移函数】migrateLegacyProjectMemories(target = getZCodeDataRootDir())
  │    ├─ dataBaseDir ≠ homedir？──是→ 照常迁移到 {dataBaseDir}/.openzwork（§2.4）
  │    ├─ lstat ~/.zcode/cli/memories ── ENOENT → return noop（不写标记）
  │    ├─ 读 {target}/v2/memory-migration.json ── 存在 → return noop（幂等边界：此后旧根变化不重迁）
  │    ├─ 逐文件 no-clobber 复制（唯一 tmp + 排他 link；跳过已存在/symlink；单文件失败入 failures 不中断）
  │    └─ atomicWritePrivateTextFile 写标记 ── 迁移完成
  │    （try/catch：异常 → warn，不阻塞启动；无标记 → 下次启动重试）
  ▼
窗口创建 → renderer Local Host（services node.ts:719 注册 createMemoryService，只读）
  ▼
用户打开设置页 → MemorySettingsSection
  ├─ memoryEnabled=false → viewer 不渲染（MemorySettingsSection.tsx:177）+ 引导文案（§2.3 新增）
  └─ memoryEnabled=true → listProjectMemories()
        → requireProjectMemoriesRoot({dataBaseDir}/.openzwork/cli/memories/projects)
        → 读到迁移后的 28 个项目目录 → catalog → UI 渲染
（desktop spawn 的 CLI agent 若启动，其 createZCodeApp 触发同一迁移 → 读同一标记 → skip）
```

### 6.2 CLI 链（无桌面）

```
zcode 命令（TUI / headless prompt / app-server）→ createZCodeApp
  │ config 加载：storage.dir = ZCODE_STORAGE_DIR > config 文件 > 默认 "~/.openzwork"（contracts index.ts:301）
  │ storageRoot = resolvePath(config.storage.dir)                    [create-app.ts:198]
  │
  ├─【新增·所有者=迁移函数】migrateLegacyProjectMemories(target = storageRoot)
  │    ├─ storageRoot ≠ 默认根？──是→ skip + info（§2.4 自定义不自动搬）
  │    ├─ 源 ENOENT → noop；标记存在 → noop
  │    └─ no-clobber 复制 + 写标记（与 desktop 首启并发时靠 no-clobber 收敛，见 §2.1）
  ▼
loadZCodeAgentProfiles（既有 loader 前迁移先例，create-app.ts:204）→ session 创建
  ▼
memoryEnabled=true 的会话：resolveEnabledProjectMemoryRoot（core project-memory.ts:5-13）
  → scanMemoryManifest(rootDir = storageRoot/cli/memories/projects/<ws>/memory)   [单根递归]
  → 迁移后的历史记忆进入 manifest（≤200 文件截断）→ 注入 recall prompt
（memoryEnabled=false：server-operations.ts:3267 强制 memory:{enabled:false}，不读不写——迁移已使数据就位，开开关即生效）
```

## 7. 验收场景

1. **旧根有数据 → 两端可见**：完整产品验收须用实际 Desktop 与 CLI 启动链（不是仅调用 helper）：Desktop 首启后 `~/.openzwork/cli/memories/projects` 与旧根项目/文件一致，设置页 catalog 列出项目；随后通过 CLI `createZCodeApp` 启动且 `memoryEnabled=true` 的实际会话，recall 注入的 manifest 包含迁移主题文件。本次定向自动化以 tmpdir 调用实际 CLI 迁移入口，确认 services catalog 与 `scanMemoryManifest` 可看到迁移项目/主题文件；不启动 Electron 或真实 `createZCodeApp`，不能替代产品级 Desktop/CLI 验收。本机原旧根样例为 28 项目/19 索引，但真实用户数据启动验收不得与 tmpdir 集成测试混称。字节一致抽查与 catalog/recall 的真实端到端通过记录须在验收日志填写。
2. **空旧根 → no-op**：`~/.zcode/cli/memories` 不存在的机器（新用户）→ 启动不创建任何目录、不写标记、无用户可感知差异（debug 日志一条）。临时目录单测验证 helper 的 ENOENT no-op，不等同于真实 Desktop/CLI 启动验证。
3. **自定义 storage.dir 在场**：`ZCODE_STORAGE_DIR=/custom` 经真实 CLI 启动链 → 不迁移、旧根原样、一条 info 日志含源与目标路径；默认根 `~/.openzwork` 不因此被创建。自动化实际调用 `migrateDefaultCliStorageMemories` 接线函数，断言 custom storage 不创建默认目标、不改 source 且发 info 日志；尚未在真实进程对 `createZCodeApp` 环境注入做验收。
4. **自定义 dataBaseDir 在场（desktop）**：dataBaseDir=/custom → 实际 Desktop 启动迁移落 `/custom/.openzwork/cli/memories`，设置页 catalog 可见；标记在 `/custom/.openzwork/v2/memory-migration.json`。tmpdir 自动化调用抽取的 Desktop 启动迁移入口，再经 services `setDataBaseDir` 和真实 `createMemoryService().listProjectMemories()` 验证 catalog 可见，但没有启动 Electron Desktop；CLI agent 新写入仍落 `~/.openzwork` 为已知限制（§8）。
5. **二次启动不重复迁移**：第二次真实 Desktop/CLI 启动读标记直接返回（debug 日志、零文件复制）；手动删标记后由真实入口重跑 → 已存在文件全部 no-clobber 跳过（filesCopied=0，内容不变）。当前 tmpdir 自动化只调用 helper 验证标记与重入语义，真实入口仍待验收。
6. **中断恢复**：通过真实子进程执行迁移并在写入中途 kill，再以新进程重启迁移；验证旧进程遗留 tmp 被清理、缺失文件补齐、已复制文件不重复且最终标记写入。本次自动化新增真实子进程：在 tmp 复制完成、原子 link 提交前暂停后 SIGKILL，再由新子进程重启 helper，确认死亡 PID tmp 已清理、缺失文件补齐、目标内容完整且标记写入；通过 `packages/services/test/memory-migration.test.ts` 的场景用例。既有 6a 构造死亡 PID 残留文件验证清理选择规则、6b 预建部分目标验证 helper 续传。
7. **并发首启**：Desktop main 与其 spawn agent 的实际双触发链同时启动；最终目录完整、无撕裂或新文件覆盖（唯一 tmp + 排他硬链接提交）。当前双 worker 测试只并发调用 helper，不代表 Electron Desktop/agent 接线已通过。
8. **memoryEnabled=false**：实际 Desktop 启动仍迁移；UI 测试验证关闭时 zh/en 文案、关闭态无 catalog 请求，切换开关后不重启即请求并显示 catalog。本次自动化 server-render React 组件，验证关闭态 zh/en 文案存在；没有可用 DOM/browser 测试依赖，未挂载交互 DOM 执行开关切换，也未运行真实 Desktop UI；“无需重启显示”仍仅由实现 effect（`MemorySettingsSection.tsx:90-101`）推断，验收未通过。

自动化证据（实现状态快照；测试通过不替代真实入口验收）：`packages/services/test/memory-migration.test.ts`（node:test + tmpdir）覆盖 helper 成功/no-op/幂等、双 worker helper 并发、真实 SIGKILL 后新 helper 子进程重启清理 tmp 并补齐、死亡 PID tmp 选择规则及预建目标续传；新增 CLI 接线测试实际调用 `migrateDefaultCliStorageMemories`，确认默认根数据被 services catalog 和 CLI `scanMemoryManifest` 读取、custom storage 不创建目标且发 info；Desktop 测试调用抽取的 `runDesktopMemoryMigration`，再用 `setDataBaseDir` 和 `createMemoryService().listProjectMemories()` 验证自定义根可见。设置页自动化只做 React server-render 中英文文案验证；未执行真实 `createZCodeApp`、Electron Desktop 启动、实际 Desktop + spawned agent 双触发或浏览器开关交互。前述真实产品入口与交互仍需验收，不得声称通过。

## 8. 非目标与已知限制

**非目标**（明确不做）：

- P0-2 完整数据根对齐（`ZCODE_DATA_BASE_DIR` 映射进 CLI `storage.dir`、或 desktop spawn 时下发 `ZCODE_STORAGE_DIR`）——涉及 `sessionDbPath` 默认值（`~/.openzwork/cli/db/db.sqlite`，contracts index.ts:303，与 storage.dir 是两个独立默认）等连锁分裂风险，属协议/配置面行为变化，移交后续工作包单独 spec；E1a 只保证「UI 读哪个根就迁到哪个根」。
- `memoryEnabled` 默认值改 true（§2.3 裁决维持 false）。
- 记忆内容查看器、嵌套 .md 可见、索引/条目计数口径、搜索增强、子代理 agent-memory 展示（WP-E6）。
- Web/远端查看记忆（维持 localOnly）。
- 迁移 `~/.zcode` 下其余数据与删除/清理旧根（永不删除；其余数据归 WP-E5 导入器）。
- 迁移进度 UI、迁移结果设置页公告（静态引导文案除外）。

**已知限制**（如实记录，不掩饰）：

1. 自定义 dataBaseDir 场景下 CLI agent 新写入仍落 `~/.openzwork`（P0-2 分叉残留），表现为「旧记忆可见、新记忆写入旧默认根不可见」——比现状（全部不可见）改善，完整对齐待后续包。
2. 更老 hash 算法生成的项目目录（若存在）迁移后 catalog 可见但该项目 recall 不注入（§2.1）。
3. 旧根文件被外部进程在迁移同时修改：复制的是调用时刻快照，无一致性保证（与 copyDataDirectory 同级风险，实际窗口毫秒级）。

## 9. 验证要求（实现 PR 必跑）

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`（AGENTS.md 强制）。
- `packages/services/test/memory-migration.test.ts` 全绿（node:test 直跑）。
- 本机手动验收 §7 场景 1/4/5/8（以本机真实 28 项目旧根为样例；验收前备份旧根目录）。
- 不引入云遥测、官方账号、官方在线服务（不变纪律）。
