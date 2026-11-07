# 合入上游与挑选上游做法

上游 ZCode 按整版快照发布。OpenZWork 用双亲 merge 合入，保留上游历史。合入前先读 `knowledge/` 中的全部 `active` 条目。

## 1. 发现新版本

```bash
mirror_dir=$(git remote get-url mirror)
git -C "$mirror_dir" fetch origin --tags          # 不加 --force
git fetch mirror --tags '+refs/remotes/origin/main:refs/remotes/zcode/main'
git fetch origin main
```

- 上游版本号以目标提交的 `package.json` 为准。存在同名 tag 时，核对两者指向同一提交。
- 出现 `would clobber existing tag` 时停止，核对新旧提交（经验 `OZK-PIT-010`）。
- 目标已是 `origin/main` 的祖先时，说明没有新版本。

## 2. 预演

```bash
pnpm openzwork:scan --upstream <上游提交>
```

逐项处理输出：

- **冲突**：按分类和认领判断，涉及台账条目的优先处理。
- **我方已删、上游修改**：保持删除，读上游改动，移植属于保留域的修复（`OZK-DIF-004`）。
- **上游新增文件落在裁剪路径内**：合并后删除，并清理引用。
- **受影响的台账条目**：逐个阅读上游对这些文件的改动，判断我方功能是否仍成立。

预演之外，还要逐段阅读上游对保留文件的改动，找出新增的端点、鉴权、遥测和账号逻辑（`OZK-PIT-001`）。改动量大时按功能域拆分阅读。

## 3. 建工作区并先写 spec

- 从 `origin/main` 新建 worktree 与分支 `codex/sync-upstream-v<版本>-<YYYYMMDD>`；复用依赖前核对 lockfile（`OZK-PIT-008`）。
- 写 `docs/openzwork/upstream/v<版本>-integration.md`：基线、延续的保留与裁剪范围、吸收的行为、裁剪的新内容、冲突规则、验证场景。单独提交后再合并。

## 4. 合并与取舍

```bash
git merge --no-ff --no-commit <上游提交>
```

- 冲突按 `OZK-DIF-004`、`OZK-DIF-005` 处理；锁文件按 `OZK-DEC-006` 处理。
- 取舍参照 `knowledge/decisions.yaml`。没有先例且依赖官方账号、套餐、网关、遥测、自动更新、云端分享与反馈、原生 CUA、`zcode_official` 鉴权或官方端点的功能，裁剪；其余吸收。新取舍写进 spec 和台账。
- 上游实现了我方已有功能时，按 `OZK-DEC-005` 改用上游。
- 不格式化上游文件（`OZK-PIT-002`）。

## 5. 合并后

1. 更新台账 `upstream.version` 与 `upstream.commit`；根 `package.json` 改为 `<版本>+openzwork.1`（见 `docs/openzwork/release/openzwork-release-version.md`）。
2. 上游原文随合并直接更新，不做修改。`--check` 会列出原文已变化的 OpenZWork 版本：以新原文为底重放我方修改，再更新 `upstreamBlob`。
3. 按 `docs/openzwork/patches/downstream-patch-registry.md` 复核全部未退役补丁，更新 `upstream.checked`。
4. 新增的裁剪域补充到 `tests/private-cleanup/cleanup.test.cjs` 与台账 `drop` 条目。
5. 提交后执行 `pnpm openzwork:scan --check`，再按 `.github/workflows/ci.yml` 跑本地检查；核心套件前先构建 CLI（`OZK-PIT-009`）。
6. 结果写入 `docs/openzwork/upstream/v<版本>-validation.md`，本地结果、CI 结果与实机验收分开记录。
7. 把本次得到的新经验写回 `knowledge/`。

## 挑选上游做法

上游重写了 OpenZWork 定制过的区域时，比较两种实现：上游实现能满足台账条目的行为、且不依赖官方服务时，改用上游实现并退役我方的实现；否则保留我方实现，在整合 spec 中写明理由。
