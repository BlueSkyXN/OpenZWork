# staging pre-push 单测基线失败报告（2026-08-24）

## 摘要

在 Linux 本地环境对最新 `origin/staging` 做独立 detached worktree 验证：

- staging SHA：`0e867f1323`（`Merge branch 'fix/tool-call-display-consistency' into 'staging'`）；
- 定向运行 pre-push 全量测试中报错的 9 个测试文件；
- staging 实际结果：**30 条失败**；
- Provider Refactor 当前分支结果：**32 条失败，12,366 条通过，25 条跳过**；
- 当前分支额外的 2 条 Settings 源码守卫失败，已经由 staging 提交 `4f0b024f73` 修复；
- 因此 Provider Refactor 的 pre-push 失败主体不是本次 Provider 改造引入，最新 staging 在同一环境下也无法通过该 gate。

## 环境

```text
OS: Linux
首次验证 Node: v24.19.0
复核 Node: v24.14.0（仓库锁定版本）
pnpm: 10.33.2
仓库期望 Node: 24.14.0
Vitest: 4.1.4
staging: 0e867f1323
```

## staging 的 30 条失败

### 1. Windows release packaging：2 条

文件：

- `packages/zcode-server-cli/test/releaseInstaller.test.ts`
- `packages/zcode-server-cli/test/packaging.test.ts`

失败用例：

```text
release installer
  × installs a Windows zip and writes a launcher that is safe for quoted paths

stageRelease
  × stages a Windows target with a cmd launcher and zip archive
```

代表性错误：

```text
Error: spawn zip ENOENT
```

### 2. macOS notarization：3 条

文件：`packages/desktop/test/notarizeMacosScript.test.ts`

失败用例：

```text
× 测试环境 DMG 带 TEST 后缀时也应能进入公证流程
× retries transient notary upload failures before continuing
× 正式 release 缺少安装后 app 验收路径时不应把 notarization 判定为成功
```

代表性错误：

```text
scripts/notarize-macos.sh: line 92: integer expression expected
[notarize] dmg not found ... for arch=arm64
```

脚本在 Linux 上把 `stat` 输出当作整数处理，随后误判测试 DMG 不存在。

## 当前 Provider Refactor 分支额外的 2 条失败

文件：

- `packages/ui/test/settingsSubagentRowContent.test.ts`
- `packages/ui/test/settingsSkillScopeBadge.test.ts`

失败用例：

```text
× uses the shared scoped resource-list structure
× does not repeat scope metadata beside the skill name in Plugin
```

这两条在 `origin/staging@0e867f1323` 已通过。对应 staging 修复提交：

```text
4f0b024f73 fix(ui): 更新源码守卫断言到 resolvePluginDisplayName
```

所以合入最新 staging 后预计从 32 条降为 30 条，但不能让 pre-push gate 整体变绿。

## 复现命令

全量 pre-push：

```bash
pnpm verify:pre-push
```

只运行 staging 仍失败的 7 个文件：

## 修复设计

- Windows ZIP 归档改用仓库内的异步 Node 实现，不再要求测试机或发布机构建机预装 `zip` 命令；
- notarize 脚本的 mtime 读取同时兼容 BSD/macOS 与 GNU/Linux `stat`；
- macOS identity 与 System Settings watcher 测试的 platform seam 必须贯穿到内部 helper；
- macOS Node Helper 契约测试显式固定 `darwin`，跨平台 broker 测试的 fake native 则补齐当前平台 ABI；
- 不启动真实 broker socket 的 Helper Host 状态机测试显式关闭 transport rendezvous，避免临时目录长度决定测试分支；
- 所有修复继续 fail-closed，不通过 skip 整组测试来隐藏跨平台失败。

## 修复结果

2026-08-24 已按上述设计完成修复：原 7 个失败文件在 Linux 上得到 `158 passed / 4 skipped`，
原 30 条失败全部消失。与此同时将 Windows ZIP 的生成与安全解压统一改为进程内异步实现，移除了
发布机对系统 `zip` 以及 GNU tar 读取 ZIP 的错误依赖。当前分支另外两条 UI 源码守卫漂移同步采用
staging 已有修复 `4f0b024f73` 的断言结果，不改变 UI 产品实现。
