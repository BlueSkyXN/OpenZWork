# Git UI 开发现状

更新日期：2026-07-07

## 当前目标

当前阶段已经把 Git pane 的“读真实仓库改动”主链路接上，并补回顶部轻量写操作入口。当前目标是让用户在不离开当前 workspace 的前提下，既能继续浏览改动，也能通过顶部入口完成提交或推送。

## 已完成的 UI

### 1. 顶部入口

- `WorkspaceHeader` 顶部工具栏已接入 Git 入口
- 当当前工作区能探测到 `+/-` 行数统计时，顶部会展示“Git 图标 + +/- 统计”的一体化胶囊按钮
- 这块统计在 Git pane 未打开时也会显示，避免用户必须先点开 Git 才知道当前有改动
- 点击该入口会打开或关闭右侧 Git pane

### 2. 右侧 Git pane

- Git 复用现有右侧共享 pane，与 browser / code-viewer 共用同一个槽位
- pane 顶部保留标题和关闭按钮
- 主体区已收敛为更轻的单列阅读模式，避免一开始就堆叠过多操作区

### 3. 顶部 Git 操作入口

- 在 `WorkspaceHeader` 顶部工具栏里，终端切换按钮左侧新增“提交或推送”胶囊入口
- 主按钮按当前 Git 状态优先执行 `提交`，没有未提交更改但存在可推送提交时执行 `推送`
- 入口右侧不再提供三点 / 下拉菜单，避免把提交、推送入口拆成两套并列路径
- `提交` 会打开独立提交弹窗，默认把当前 workspace 作用域内的全部未提交更改一起暂存并提交
- 提交弹窗内额外提供 `提交并推送`，成功提交后立即复用同一 Git service 推送当前分支
- `推送` 会打开独立推送弹窗，执行真实 `git push`；若当前分支尚未建立 upstream，会在首次推送时自动补 `--set-upstream`

### 4. 来源切换

- 支持 4 个来源：
  - `未暂存`
  - `已暂存`
  - `全部分支更改`
  - `上一轮更改`
- 当前选中的来源由 `App` 提升管理，保证顶部入口统计和 Git pane 内容始终来自同一来源

### 5. 文件列表与 diff

- 列表项展示 workspace 相对路径全路径
- 文件项支持展开 / 收起
- 展开后直接展示 inline diff，不再重复显示路径和 `+/-` 统计
- 非 `未暂存` 项会按 section 展示状态 badge，例如 `未跟踪`、`冲突`、`已暂存`
- diff 使用现有 `PatchDiff` 组件，并复用代码预览主题配置

### 6. 文件树侧边栏

- 点击“显示文件树”后，会在 Git pane 右侧展开一个目录侧边栏
- 侧边栏宽度支持拖拽调整，并保留最近一次拖拽后的宽度
- 侧边栏顶部提供“筛选文件...”搜索框，按当前目录树中的文件相对路径做即时筛选
- 侧边栏会展示目录和文件叶子节点；筛选时会保留命中文件的祖先目录，方便继续沿层级定位
- 选择目录后，会过滤主区文件列表
- 选择文件叶子节点后，会把主区收敛到该单文件；再次点击当前选中目录或文件可回到完整列表
- 文件树支持目录折叠 / 展开

### 7. 对话输入区底栏

- 对话输入框内部现在只保留编辑相关控件（输入区、附件、发送 / 停止按钮）
- 当前 agent、当前模型、mode 设置、token 上下文统计从输入框壳体中拆出，统一放到输入框下方的底栏
- Git 分支切换入口与这些状态控件共用同一条底栏，并固定到最右侧，减少输入框内部横向拥挤
- 当前 agent 图标优先跟随“当前正在查看的 task provider”，避免切到历史 task / fork task 时出现展示与真实会话不一致

## 当前数据来源

### 真实 Git 数据

以下来源现在已经接入真实 `IGitService`：

- `未暂存`
- `已暂存`
- `全部分支更改`

接线方式：

- `useGitRepository` 统一通过 `services.gitService` 读取 `refresh / getChanges / getBranchComparison`
- `App` 只拉一次真实仓库快照，header 和 Git pane 复用同一份状态，避免重复执行 Git 命令
- 单文件 diff 改为在 Git pane 中按需调用 `getDiff`，避免顶部入口统计也触发全量 diff 读取

### 半真实数据

- `上一轮更改` 已优先复用当前 task 在 ZCode task store 里的 per-turn 文件快照和摘要
- 这部分是当前 UI 中最接近真实 agent 输出的数据来源

## 当前交互边界

当前版本仍然不是完整 Source Control 工作台，但顶部已经放出一组轻量写操作：

- 已接入前端 `commit`
- 已接入前端 `push`
- 已接入前端 `create branch`

当前仍未放出的写操作：

- 没有前端 `stage / unstage / discard`
- 没有提交区与批量操作区

已接入的只读能力：

- 真实 `git status`
- 真实分支比较
- 真实单文件 diff
- 真实 `user.name / user.email` 读取（当前 UI 暂未展示）

`packages/ui/src/hooks/useGitActions.ts` 仍保留为占位扩展点，后续接 service 时可继续复用这层动作抽象。

## 关键实现文件

- `packages/ui/src/App.tsx`
- `packages/ui/src/v4/ConversationComposer.tsx`
- `packages/ui/src/GitBranchSwitcher.tsx`
- `packages/ui/src/GitActionMenu.tsx`
- `packages/ui/src/WorkspaceHeader.tsx`
- `packages/ui/src/GitPane.tsx`
- `packages/ui/src/git-action-menu/display.ts`
- `packages/ui/src/hooks/useGitRepository.ts`
- `packages/ui/src/lib/workspaceSidePane.ts`
- `packages/services/src/git/gitService.ts`
- `packages/services/src/git/repo/gitCliRepo.ts`

## 当前验证状态

- `pnpm typecheck`：当前仓库未完全通过，存在既有的 shared import / MCP typing 错误，非本轮 Git UI 改动引入
- `pnpm lint`：仓库级 `oxlint` 仍有既有 warning；本轮改动文件已单独通过 `oxlint`
- `pnpm exec vitest run packages/services/test/gitService.test.ts packages/ui/test/gitActionMenuDisplay.test.ts packages/ui/test/gitBranchSwitcherDisplay.test.ts`：通过

## 后续建议

1. 决定 Git pane 是否恢复 `stage / unstage / discard` 与批量操作区
2. 为顶部提交 / 推送菜单补充更多空态、失败态和权限提示
3. 继续补充 Git 为空、非仓库、Git 不可用等场景的交互打磨
