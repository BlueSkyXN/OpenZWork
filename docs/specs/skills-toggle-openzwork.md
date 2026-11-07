# Spec：技能开关（skills toggle）——链路定型与回归收尾

- 工作包：WP-E1c（快赢包，诉求 2「开关内置技能」）
- 状态：**已实现的链路之 spec 化 + 回归收尾**。本 spec 不引入任何新行为；其价值是把既有链路的产品规则、状态所有者、key 语义与验收边界固化为文档，作为后续回归与 WP-E2/WP-E8 的引用基线。
- 依据：`local/feature-eval-20260922/DECISIONS-AND-PLAN.md` §WP-E1（E1c）、§4 不变纪律；`local/feature-eval-20260922/REPORT.md` §诉求 2（全链 verified）。
- 代码基线：`wp-e1c/skills-toggle-spec` 分支，HEAD `00186b6`。文中 `path:line` 均为该基线实测位置。
- 修订记录：2026-09-23 评审修订——勘误 A2.3 期望（原文误称「设置页列表同样不显示」；实测 skillsService 发现无剔除机制，禁用技能仍留列表、仅投影 enabled），并在 §2.4 增补「两条发现路径」语义表、§2.5/§3 同步澄清、A1 增补 A1.5 UI 断言。
- 修订记录：2026-09-23 回归收尾——§6 自动化建议项落地为 `packages/services/test/skills-toggle.test.ts`（7 用例，运行方式见该节）。

---

## 1. 背景与现状结论

技能开关链路已全链闭环（报告诉求 2，逐环 verified）：

```
UI Switch（SkillsSection）
  → skillsService.setEnabled（写队列串行化，host 进程执行）
    → 用户级 config.json：skills[<SKILL.md 绝对路径>].enable = false（仅禁用态落盘）
      → CLI adapters config schema 解析为 skillOverrides
        → bootstrap collectDisabledPaths 汇总 disabledPaths
          → NodeSkillAdapter 在发现阶段按 resolve/realpath 双路径剔除
```

报告认定的两个小缺口（均非结构性）：

1. 开关按 SKILL.md 绝对路径做 key，技能目录移动/改名后失配需重新关（→ 见 §8 已知限制，本包不做迁移）；
2. CLI 侧无交互式开关命令，只能手改 config（→ 见 §7 非目标）。

本包交付物 = 本 spec + 按 §6 验收场景完成的回归验证。

## 2. 产品规则

### 2.1 开关粒度

- **粒度 = 单个技能（SKILL.md 文件级）**，不按技能组、不按技能根、不按插件整体（插件整体启停是另一条既有链路，见 2.5）。
- 覆盖三种作用域的技能：`workspace`（`.zcode/skills` 与 `.agents/skills`，逐级祖先目录合并扫描）、`user`（`~/.openzwork/skills` 与 `~/.agents/skills`）、`plugin`（插件贡献的技能根）。
- **默认全开**：任何未在 config 中登记 `enable:false` 的技能均视为启用（`attachEnabledState` 的 `?? true`，packages/services/src/skills/skillsService.ts:1017-1025）。

### 2.2 key 语义

- 持久化 key = **该技能 `SKILL.md` 的绝对路径**，不是技能名、不是技能 id。
  - UI 写入侧：`SkillSummary.path` 是发现阶段 `realpath` 后的目标文件路径（skillsService.ts:963-965；软链技能的 `sourcePath` 才是链接本体，仅用于删除链接时定位）。
  - 路径规范化：写入与读取两侧统一把 `\` 归一为 `/`（`normalizeSkillConfigPath`，skillsService.ts:528-530），保证 Windows 形态一致。
  - CLI 解析侧：只接受绝对路径形态的 key（`/`、`\` 开头或 `X:\`/`X:/` 盘符，apps/zcode-cli/packages/adapters/src/config/schema.ts:530-532）；相对路径 key 静默忽略。
- **仅禁用态落盘**：
  - 关闭 → 写 `skills[<路径>] = { "enable": false }`；
  - 重新开启 → **删除该条目**（不写 `{ "enable": true }`），使技能跟随插件/默认配置变化（skillsService.ts:570-575 注释即此规则）；
  - 所有禁用条目清空后，`skills` 段整体从 config 中删除（skillsService.ts:577-581）；
  - 手工写入的 `{ "enable": true }` 不被读取侧采信之外的副作用：在下一次任意开关写入时会被归一清除（写回时对 full map 逐条按「开=删、关=写」处理）。
- `skillId`（UI 调用参数）≠ 持久化 key：`skillId` 形如 `provider:scope:name:<pathHash12>`（skillsService.ts:232-243），仅用于服务内重新发现后定位技能、取其 `path` 落 key。技能被移动后旧 `skillId` 失配将抛 `Skill not found`（skillsService.ts:1069-1072）。

### 2.3 层级：全局总开关 → 单技开关

生效优先级自上而下，任一层关闭即整体不注入：

| 层           | 配置键                               | 默认                                        | 效果                                                                            |
| ------------ | ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------- |
| 特性总开关   | `features.skill`                     | `true`（contracts config index.ts:313）     | 为假时不创建 skillPort，Skill 工具不注册                                        |
| 技能域总开关 | `skills.enabled`                     | `true`（contracts config index.ts:330-334） | 同上，二者需**同时为真**才注入（bootstrap/src/skills.ts:92、create-app.ts:733） |
| 单技开关     | `skills[<SKILL.md 绝对路径>].enable` | 未登记即开                                  | 为假时该技能在 agent 侧发现阶段被剔除（设置页列表不剔除，见 §2.4）              |

两个全局总开关当前仅 config 可配、**无 UI 暴露**；是否暴露属 WP-E2 范围（见 §7 非目标）。

### 2.4 禁用的生效面（失效即达）

禁用对 agent 运行时是**发现期剔除**，不是运行期遮蔽。命中 `disabledPaths` 的技能在 `NodeSkillAdapter.discoverSkills` 即被剔除（adapters/src/skills/index.ts:78），因此：

- 系统提示词的 Skills 段（由发现结果构建，core/src/context/sections/skills.ts:17-37）不再列出该技能；
- Skill 工具 `loadSkill` 复用 `discoverSkills` 结果（adapters/src/skills/index.ts:95-118），按名加载直接 `Skill not found`；
- discover / load / inspect / 提示词投影全链路一致，不存在「列表隐藏但仍可加载」的中间态。

**两条发现路径，语义不同（回归时不得混淆）**：

| 路径             | 实现                                                                           | 对禁用技能的行为                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| agent 运行时发现 | `NodeSkillAdapter.discoverSkills`（adapters）                                  | **剔除**：不进提示词、不可加载                                                                                        |
| 设置页列表发现   | `skillsService.discoverSkills`（packages/services，全文无 disabledPaths 机制） | **不剔除**：技能仍显示在设置页列表，仅 `attachEnabledState` 把 `enabled` 投影为 `false`（skillsService.ts:1017-1025） |

UI 侧 `enabled` 只有两处消费：行内 Switch 的 `checked`（SkillsSection.tsx:587）与详情页状态字段「已启用/已禁用」（SkillsSection.tsx:863-871）。**禁用技能留在设置页列表是产品语义**（用户需要看到已禁用项以便重新打开），不是缺陷；「从设置页消失」只发生在根级别变化（如插件被禁用，见 §2.5）。

### 2.5 plugin 作用域技能的规则

- **第一层所有者是插件启停**：插件被禁用（`plugins.enabledPlugins`）或被卸载（`plugins.suppressedBuiltins`）时，其技能根不再被解析（UI 侧 skillsService.ts:776-840；agent 侧 adapters/src/plugins/index.ts:180、:194-206 禁用插件产出空组件、无 skillRoots），技能随之整体消失。
- **UI 不为 plugin 作用域技能渲染单技 Switch**（SkillsSection.tsx:584：`skill.scope === "plugin" ? null : …`），也不提供删除入口（删除仅限 workspace/user，`deleteSkill` 契约 skills.ts:37-45）。即：plugin 技能的开关单位是插件，不是单个技能。
- **技术兜底语义**（记录在案，不作为产品入口）：若用户手工在 config 中写入 plugin 技能 SKILL.md 路径的 `enable:false`，`disabledPaths` 机制对 plugin 技能根同样生效——**仅 agent 侧**（发现期剔除不区分 root 来源，提示词与 Skill 工具不再暴露该技能）。设置页列表**仍显示该技能**（skillsService 发现不剔除，见 §2.4 双路径表），唯一 UI 反馈是详情页状态字段显示「已禁用」（enabled 投影为 false）。这条只保证「不会出现模型可加载而意图禁用」的漏网，不是承诺的单技开关能力。

### 2.6 symlink / realpath 双路径规则

同一 SKILL.md 可能以两种路径形态出现：扫描到的链接路径与 `realpath` 后的目标路径（典型：`~/.openzwork/skills/<name>` 下软链导入的技能，UI 落 key 用 realpath 目标，agent 扫描的是链接路径）。为保证任一形态落盘都能命中：

- **构造期**：每条 disabled path 同时以 `resolve()` 结果与 `safeRealpathSync()` 结果（若不同）入集合（adapters/src/skills/index.ts:47-57）；realpath 失败（目标暂不存在）只收 resolve 形态。
- **比对期**：被扫描的 SKILL.md 以 `resolve()` 与 `realpath()`（失败回退 resolvedPath）双比对（adapters/src/skills/index.ts:239-248，注释点名 symlink 场景）。
- 两侧双向闭包：config 落链接路径或目标路径，两种方向均可命中。

### 2.7 desktop 与 CLI 双入口同语义

- desktop host 与 CLI 读写的都是同一份用户级文件 `~/.openzwork/cli/config.json`：写入侧 `SKILL_CLI_CONFIG_FILE`（skillsService.ts:50-52）；CLI 读取侧 `DEFAULT_BASE_DIR = "~/.openzwork/cli"`（adapters/src/config/file-config.adapter.ts:52）。
- home 目录解析：优先 `HOME`/`USERPROFILE` 环境变量，回退 `os.homedir()`（skillsService.ts:63-66）——与 CLI 侧行为一致，远程/容器场景下跟随执行环境。
- 远程 workspace：技能设置页按 workspace target 解析服务（SkillsSection.tsx:190-199），开关写入发生在**目标 host** 的用户级 config，该 host 上的 agent 运行时读同一份文件，语义闭环。

## 3. 状态所有者与写入路径

**唯一事实源：目标 host 的用户级 `~/.openzwork/cli/config.json` 的 `skills[<SKILL.md 绝对路径>].enable`。**

| 角色           | 位置                                                                                                                             | 职责                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **唯一写入方** | `skillsService.setEnabled`（packages/services/src/skills/skillsService.ts:1052-1081），经 `writeSkillEnabledMap`（:561-584）落盘 | 读改写整份 config 的 skills 段；实例级 `writeQueue` Promise 链串行化并发开关，防交错写                                         |
| UI 投影读取方  | `skillsService.list` → `attachEnabledState`（skillsService.ts:1044-1046、:1017-1025）                                            | 读同一文件，仅投影 `enabled` 布尔（`enable:false` 之外一律为开）；**不做列表剔除**，禁用技能仍显示在设置页（见 §2.4 双路径表） |
| 运行时消费方   | CLI bootstrap `createConfig` → schema 解析 → `collectDisabledPaths` → `NodeSkillAdapter.disabledPaths`                           | 只读，从不写回                                                                                                                 |

写入纪律（反例禁止）：

- **禁止任何第二写入路径**：UI 组件不直连 config 文件，一律经 `ISkillsService` 公开入口（UI 经 hooks/服务解析取服务，SkillsSection.tsx:198-199、skillStore.ts:212-254 两条调用面都走 service）；CLI 侧无写入口。
- **禁止在 workspace/provider/context 等状态文件里另存技能开关**（历史分叉教训，见 skillsService.ts:567-568 注释）。
- 写入细节：条目按 key 排序后写回（输出确定性）；目标目录 `mkdir -r` 幂等；全部为异步文件 IO（`node:fs/promises`）。
- **技能开关不与插件启停双写**：plugin 技能的可见性由插件启停链（`enabledPlugins`/`suppressedBuiltins`）唯一管理（§2.5），本开关不写插件配置。

## 4. 接口

### 4.1 服务接口（packages/services 公开入口）

`ISkillsService`（packages/services/src/skills/skills.ts:5-48）：

```ts
list(params: { workspacePath; workspaceIdentity?; provider? }): Promise<SkillsListResult>
setEnabled(params: { workspacePath; workspaceIdentity?; provider?; scope?;
                     skillId: string; enabled: boolean }): Promise<void>
```

- `setEnabled` 语义：按 `skillId` 重新发现定位技能 → 以其 `path`（realpath 形态、反斜杠归一）写/删 override。技能不存在时抛错。
- `SkillSummary.enabled: boolean`（packages/shared/src/skills-types.ts:10-29）为 UI 投影字段，`scope: "workspace" | "user" | "plugin"`。
- 服务在 desktop host 以 `isDesktopRuntime: true` 装配（packages/services/src/node.ts:546、:702），user 作用域能力仅 desktop 运行态可用（skillsService.ts:1009-1015）。

### 4.2 config 文件形态（adapters schema，apps/zcode-cli/packages/adapters/src/config/schema.ts）

```jsonc
// ~/.openzwork/cli/config.json
{
  "features": { "skill": true }, // 全局总开关 1（默认 true）
  "skills": {
    // 复数段：域配置 + 单技开关共存
    "enabled": true, // 全局总开关 2（默认 true）
    "roots": ["/extra/root"], // 自定义技能根（非开关）
    "/abs/path/to/SKILL.md": { "enable": false }, // 单技开关：绝对路径 key，仅禁用态落盘
  },
  "skill": { "/abs/path/to/SKILL.md": { "enable": false } }, // 单数 legacy 段（兼容保留）
}
```

- `skills` 复数段用 catchall 容纳路径 key（schema.ts:184-191）；同键时**复数段优先于单数 legacy 段**（`mergeSkillCommandOverrides(parsed.skill, parseSkillOverridesFromPluralSkills(parsed.skills))`，后参覆盖前参，schema.ts:397-401、:510-519）。
- 仅「绝对路径 key + `{enable?: boolean}` 形态」的条目被映射进 `skillOverrides`（schema.ts:494-508）；其余静默忽略（不炸配置装载）。
- 运行时契约：`config.skillOverrides: Record<string, SkillCommandOverride>`（contracts config index.ts:194-196、:244），`SkillCommandOverride = { enable?: boolean }`，语义「未列出默认可用，显式 enable:false 才过滤」。

### 4.3 bootstrap / adapter 接口

- `collectDisabledPaths(overrides): string[]`（bootstrap/src/skill-command-overrides.ts:5-12）：只挑 `enable === false` 的 key。
- `createNodeSkillAdapter({ disabledPaths, extraRoots, extraResolvedRoots })`（adapters/src/skills/index.ts:37-57）：`disabledPaths` 在构造期完成双路径展开。
- 注入点共三处，语义一致：主运行时 create-app.ts:734-747、workflow 子运行时 workflow-facade.ts:314 与 script-workflow-child-runtime.ts:209。主运行时额外并入「动态工作流灰度关闭时剔除 zcode-guide 工作流技能」的同机制条目（create-app.ts:740-746、dynamic-workflow-gate.ts）——它是 disabledPaths 机制的另一使用者，不是技能开关链路的一部分。

## 5. 事件顺序图

### 5.1 关闭一个技能（desktop/Web 设置页）

```
Renderer(SkillsSection)          Host(skillsService)                ~/.openzwork/cli/config.json
    |  Switch off                    |                                    |
    |──setEnabled(skillId,false)────▶|                                    |
    |                                │ 入 writeQueue（串行，等待在途写完成）│
    │                                │ 1. discoverSkills 重新发现          │
    │                                │    按 skillId 定位 → 取 path(realpath)
    │                                │ 2. readCliConfigFile ─────────────▶| 读
    │                                │ 3. map[规范化path]=false           │
    │                                │    （true=删条目；按 key 排序）      │
    │                                │ 4. mkdir -r + writeFile ──────────▶| 写
    │◀───────────────── 完成 ────────│                                    |
    │ 5. invalidateDeferredDraftSessionForSkillChange                 │
    │    （使草稿会话的技能清单失效，防旧清单继续注入）                   │
    │ 6. loadSkills + refreshSharedSkillStore（刷新列表投影）           │
```

要点：步骤 5/6 在 Renderer 侧、写完成之后串行执行（SkillsSection.tsx:371-385）；写队列保证连续多次 Switch 操作不交错（skillsService.ts:1078-1080）。

### 5.2 Agent 运行时消费（每次 agent 启动/装配，只读）

```
CLI/Host bootstrap
  → createConfig 读 ~/.openzwork/cli/config.json（file-config.adapter，DEFAULT_BASE_DIR=~/.openzwork/cli）
  → schema 解析：skills 复数段绝对路径条目 ∪ skill 单数段（复数优先）→ config.skillOverrides
  → features.skill && skills.enabled ？ 是：createNodeSkillAdapter({
        disabledPaths: collectDisabledPaths(skillOverrides)   // 仅 enable===false
      })                                        ：否：skillPort = undefined（Skill 工具不注册）
  → NodeSkillAdapter 构造期：每条 disabled path → {resolve, realpath} 双形态入 Set
  → 发现期：每个扫描到的 SKILL.md → {resolve, realpath} 双比对，命中即剔除
  → 系统提示词 Skills 段 / Skill 工具 loadSkill 均基于发现结果 → 全链路一致
```

## 6. 验收场景（回归清单）

以下场景为本包回归验收的完整清单。A1–A4 为计划点名的必测面；A5–A8 为链路完整性补充。执行环境：本仓检出 + desktop dev（`pnpm dev:desktop`）+ 一个 CLI 会话；config 用临时 `HOME` 隔离（参照 packages/services/test/paths-isolation.test.ts 的既有做法）以免污染真实用户配置。

### A1. 仓库 8 个内置 workspace 技能逐一开关

前置：本仓 `.agents/skills/` 下 8 个技能（agent-browser、ai-elements、architecture-governance、dep-refs、dogfood、electron、feature-boundary-planner、react-best-practices；本次实测均有 SKILL.md）。

| #    | 步骤                           | 期望                                                                                                        |
| ---- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A1.1 | 全新 config 下打开设置页       | 8 个技能全部列出且 Switch 全为开；config.json 无 `skills` 段                                                |
| A1.2 | 关闭其中 1 个（如 dep-refs）   | config 出现 `"/…/.agents/skills/dep-refs/SKILL.md": {"enable": false}`，且仅此一条                          |
| A1.3 | 同一 workspace 启动 agent 会话 | 系统提示词 Skills 段无 dep-refs；Skill 工具按名加载 dep-refs 报 not found；其余 7 个正常                    |
| A1.4 | 重新打开 dep-refs              | config 中该条目被删除（不是写 true）；会话恢复可见可加载                                                    |
| A1.5 | 在 A1.2 关闭后切回设置页查看   | dep-refs **仍显示在列表**、Switch 为关、详情页状态「已禁用」（§2.4 双路径表：设置页不剔除，仅投影 enabled） |

### A2. plugin 作用域技能

| #    | 步骤                                                                                  | 期望                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2.1 | 安装/启用一个带技能的插件（如 browser-use-plugin 或任一 inline 插件目录），打开设置页 | plugin 作用域技能出现在列表（带 pluginName/pluginId 分组信息），**行内无 Switch、无删除按钮**（SkillsSection.tsx:584、:403-407）                                                                                                                                                                                     |
| A2.2 | 禁用该插件（Manage Installed）                                                        | 其技能从设置页消失；agent 会话系统提示词不再列出；`plugins.enabledPlugins` 被改写，**`skills[...]` 不新增任何条目**（两层不双写）                                                                                                                                                                                    |
| A2.3 | 手工在 config 写入该 plugin 技能 SKILL.md 路径的 `enable:false`，重新启用插件         | **agent 侧**：该技能被剔除——系统提示词无该技能、Skill 工具按名加载报 not found（disabledPaths 对 plugin 根生效的技术兜底）。**设置页**：该技能**仍显示在列表**（skillsService 发现不做禁用剔除，§2.4 双路径表）；plugin 作用域本就无 Switch，唯一 UI 反馈为详情页状态字段显示「已禁用」（SkillsSection.tsx:863-871） |

### A3. symlink / realpath 双路径形态禁用

| #    | 步骤                                                                                                   | 期望                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A3.1 | 在 `~/.openzwork/skills/foo` 建目录软链指向仓外目标 `~/somewhere/foo`（含 SKILL.md），设置页关闭该技能 | config 落盘的 key 是 **realpath 目标路径**（`SkillSummary.path` 语义，skillsService.ts:963）             |
| A3.2 | agent 会话验证                                                                                         | 从链接路径扫描到的该技能被剔除（构造期 realpath 展开 + 比对期双比对命中目标路径）                        |
| A3.3 | 反向：删掉上条 config，手工改写 key 为**链接路径**形态再启动 agent                                     | 同样被剔除（resolve 形态直接命中）——两方向闭包                                                           |
| A3.4 | 目标暂时不存在（悬空链接）场景启动 agent                                                               | 不抛错；realpath 失败回退 resolve 形态比对（index.ts:244 的 catch 回退），悬空技能本就扫描不到，无副作用 |

### A4. 默认全开、仅禁用态落盘

| #    | 步骤                                                                  | 期望                                                                                       |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A4.1 | 全新 config 启动                                                      | 无 `skills` 段；所有技能默认开                                                             |
| A4.2 | 关闭 2 个技能 → 再全部打开                                            | 全部打开后 `skills` 段整体消失（不是空对象、不是 `enable:true` 条目）                      |
| A4.3 | 手工写入 `{ "enable": true }` 条目后执行任一开关操作                  | true 条目被归一清除；读取侧本就将其视为开（无行为差异）                                    |
| A4.4 | config 写相对路径 key（如 `"skills/foo/SKILL.md": {"enable":false}`） | CLI 解析侧静默忽略（schema.ts:500 绝对路径过滤），该技能照常加载；desktop 列表同样显示为开 |

### A5. 并发写串行化

连续快速切换 3 个不同技能的 Switch（不做 await 间隔）：config 最终状态与最后一次操作一致，文件为合法 JSON（writeQueue 串行保证，无交错半写）。

### A6. skillId 失配防护

关闭某技能后将其目录改名，再对该技能的旧列表项执行操作并刷新：刷新后列表按新路径重新发现；改名前写入的旧路径 `enable:false` 条目成为孤儿条目（不命中任何技能，无害残留，见 §8）。

### A7. 全局总开关优先级（config 级验证，无 UI）

`features.skill: false`（或 `skills.enabled: false`）时：skillPort 不注入、Skill 工具不注册、所有单技开关无关紧要；恢复为真后单技开关重新生效。验证双门控为 AND 语义。

### A8. desktop 与 CLI 同文件

desktop 设置页关闭的技能，在**同一台机器**的 CLI 会话（同一 `HOME`）中同样被禁用；反向手工在 config 写入的禁用条目，desktop 设置页刷新后 Switch 显示为关。

### 自动化沉淀（建议项，已于回归收尾落地）

本包无行为改动，按不变纪律不强制新增测试。建议优先固化为单测的两点已实现为 `packages/services/test/skills-toggle.test.ts`（node:test + assert/strict，7 个用例，覆盖建议项 1 的 writeSkillEnabledMap 全套语义与建议项 2 的 NodeSkillAdapter 双路径比对，并把 setEnabled 落盘 → schema 解析 → collectDisabledPaths → 发现期剔除串成真实文件链路）：

- 运行方式：仓库根目录 `mise exec -- ./node_modules/.bin/tsx --test packages/services/test/skills-toggle.test.ts`（services 包无 test script，test/ 不在任何 tsconfig 工程，需 tsx 解析工作区 TS 导入；跨 workspace 以相对路径引用 adapters/bootstrap 的公开导出，因 services 未声明对应 workspace 依赖且不允许为测试补装链接）。
- 隔离：HOME 指向 mkdtemp 临时目录后动态 import skillsService（其 CLI config 路径是模块加载期常量），全程不读写真实用户数据根。
- 建议项 2 原文（留档）：「若 adapters 无测试入口，可先以 services 层等价回归替代并在此说明」——现按此执行，adapters 侧通过公开导出 `createNodeSkillAdapter` 直接覆盖，无需在 adapters 建包级测试基建。
- 自动化未覆盖、仍走 §6 手动清单的部分：A2.1/A2.2 插件面板 UI 链路、A7 双门控（features.skill && skills.enabled 的装配层 AND 在 create-app.ts，未纳入 services 测试）、A1.3 的系统提示词文本投影（以发现结果等价断言）。

## 7. 非目标

1. **开关 key 稳定化迁移不做**：不把 key 从「SKILL.md 绝对路径」迁移为「技能名 + 根」等稳定 key，不做旧键兼容迁移（报告诉求 2 的可选项明确排除；是否做留待后续独立 spec，见 openQuestions）。
2. **CLI 交互式开关命令不做**：CLI command center 仅有 `/skills` 列表与 `/skill <name>` 加载（cli/src/command-center/handlers/skill.ts），不新增 enable/disable 子命令。
3. **全局总开关的 UI 暴露不做**：`features.skill` / `skills.enabled` 是否进设置页属 WP-E2「统一内置能力开关配置面」的决策，本包只在 §2.3 记录层级。
4. **plugin 作用域技能的单技开关不做**：维持「插件启停即技能开关」的现状语义（§2.5）。【决策点 D-E1c-1，见 §9】
5. **新功能一律不做**：本包为 spec 化 + 回归收尾；别名/重命名（WP-E8）、开关粒度扩展（功能组等，WP-E2）均不在内。
6. `commandOverrides`（命令 .md 开关）共用同一机制但属命令域，不在本 spec 范围。

## 8. 已知限制（记录，不修）

1. **目录移动/改名失配**：key 是绝对路径，技能目录移动或改名后原禁用条目不再命中，技能回到默认启用，需重新关闭；旧条目成为无害孤儿残留（读取侧按路径匹配，不报错不清理）。
2. **跨机器不同步**：状态存于各 host 本地的用户级 config；同一 workspace 在两台机器上需各自关闭（远程 workspace 写远程 host 的 config，语义正确但非同步）。
3. **非原子写**：`writeSkillEnabledMap` 直接 writeFile，无 temp+rename；当前唯一写入方 + 写队列串行下无实际竞争窗口，仅作事实记录。
4. **单数 legacy `skill` 段无迁移**：兼容读取（复数段优先），不清理、不提示。

## 9. 决策点

| #       | 问题                                                    | 本 spec 建议                                                                                                                                                                                               | 状态               |
| ------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| D-E1c-1 | plugin 作用域技能是否提供单技 Switch                    | **维持现状**（不出 Switch，插件启停即开关；disabledPaths 对 plugin 根仅作技术兜底记录）。理由：避免与插件启停形成两个写入方、违反单一所有者纪律；单技禁用 plugin 技能属新功能，应走 WP-E2 的统一开关面再议 | 建议，待诉求方确认 |
| D-E1c-2 | 回归验收形式                                            | 以 §6 手动清单执行并在 PR 描述逐项勾选；自动化沉淀按 §6 末「建议项」量力，不作为合入门槛                                                                                                                   | 建议               |
| D-E1c-3 | 孤儿条目（技能移动后的残留 `enable:false`）是否自动清理 | 不清理。清理需要「写路径理解技能生命周期（删除/改名）」，会把 skillsService 变成路径史的第二个事实源；残留无行为危害                                                                                       | 建议，维持不清理   |

## 10. 关联文档与代码索引

- 上游计划：`local/feature-eval-20260922/DECISIONS-AND-PLAN.md` §WP-E1（E1c）、§4 不变纪律、附录基线复查 #8。
- 上游报告：`local/feature-eval-20260922/REPORT.md` §诉求 2（:96-118）、§5.6 统一开关面建议（:521，本 spec 只引用其「单一所有者/默认全开仅禁用态落盘」惯例，不预支 WP-E2 的粒度决策）。
- 关键代码（基线 `00186b6` 实测）：
  - 写路径：packages/services/src/skills/skillsService.ts:50-52、:528-584、:776-840、:963-965、:1017-1025、:1052-1081；packages/services/src/skills/skills.ts:5-48；packages/services/src/node.ts:546、:702。
  - UI：packages/ui/src/settings/SkillsSection.tsx:190-199、:362-401、:584-591（:587 Switch checked）、:863-871（详情页启用状态字段）；packages/ui/src/store/skillStore.ts:212-254；packages/ui/src/lib/zcodeDraftSkillInvalidation.ts:13-60。
  - 解析与消费：apps/zcode-cli/packages/adapters/src/config/schema.ts:173-191、:284-285、:395-401、:494-532；apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts:52；apps/zcode-cli/packages/contracts/src/config/index.ts:194-196、:221-246、:313、:330-334；apps/zcode-cli/packages/bootstrap/src/skill-command-overrides.ts:5-12；apps/zcode-cli/packages/bootstrap/src/skills.ts:92-116；apps/zcode-cli/packages/bootstrap/src/app/create-app.ts:734-747。
  - 剔除机制：apps/zcode-cli/packages/adapters/src/skills/index.ts:37-57、:78、:95-118、:239-248；apps/zcode-cli/packages/adapters/src/skills/roots.ts:26-70；apps/zcode-cli/packages/core/src/context/sections/skills.ts:17-37。
