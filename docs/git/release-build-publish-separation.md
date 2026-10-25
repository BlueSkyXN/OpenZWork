# OpenZWork 构建与发布流程

当前入口为 [GitHub Actions](../../.github/workflows/) 与 [OpenZWork Releases](https://github.com/BlueSkyXN/OpenZWork/releases)。应用采用手动安装更新。历史上游 GitLab、OSS、CDN 灰度发布与官方自动更新链不属于本仓当前发行流程。

## 候选验证

1. 固定最终分支提交，完成 `CI`、`Extended checks (non-blocking)` 与 Desktop Main/E2E 类型审计。
2. 在同一分支触发 `Installers`，不提供 `release_tag` 或 `release_commit`：

   ```bash
   gh workflow run installers.yml -R BlueSkyXN/OpenZWork --ref <candidate-branch>
   ```

3. 回读实际 `headSha` 与各 job 结果。源码变化后，重新验证最终提交。
4. 检查 macOS arm64、Windows x64、Linux x64 的构建日志、artifact 名称、大小、有效期和摘要。下载、解包、安装分别记录执行情况。

默认构建生成 Preview 候选，输出到 Actions artifacts。`CI` 与 `Extended` 由 PR 事件触发；Installers 自动 push 入口仅覆盖 `main` 和 `wp**`，其它候选分支需要手动触发。

## 正式包与 Release

正式发行由明确选定的提交、`v<version>-openzwork` tag 和根 `package.json` 版本对应。`installers.yml` 的正式构建入口要求同时提供已存在的 `release_tag` 和完整 `release_commit`，并校验 tag 格式、版本及实际 checkout SHA。

正式构建使用 OpenZWork production 身份，当前工作流关闭 macOS/Windows 签名。每个平台生成 `RELEASE-MANIFEST.json`，记录 source tag、source commit/tree、workflow commit、版本、身份与安装包 SHA256。

| Runner      | 目标安装格式               |
| ----------- | -------------------------- |
| macOS arm64 | DMG、ZIP                   |
| Windows x64 | NSIS EXE                   |
| Linux x64   | AppImage、DEB、RPM、pacman |

普通 Installers 构建只上传 Actions artifacts。正式包构建完成后，先为已有 tag 创建待发布的 Release 草稿，再在同一工作流的手动发布模式填写 `release_tag`、`release_commit`、`publish_installer_run`、`core_run`、`extended_run` 与 `release_notes`。runner 复用已有安装包，校验来源、完整测试报告及文件摘要后上传 Release；本机无需下载大文件。Preview 包不能通过改名转成正式包。

发布模式支持继续上传草稿中缺失的附件；同名文件的大小或摘要不符时直接失败。全部七个安装文件、`PROVENANCE.json`、`SHA256SUMS` 回读一致后才公开并设为 Latest。发布模式与构建使用独立并发组。

## 命令边界与重试

- `pnpm release` 沿用 [.release-it.mjs](../../.release-it.mjs)：更新版本与 CHANGELOG，创建 `v<version>` commit/tag 并 push；它不创建 GitHub Release，且默认 tag 格式不同于 OpenZWork 正式安装包要求。不要将该命令当作完整发版入口。
- 合并、创建正式 tag、发布 Release 和部署分别执行，候选构建不包含这些动作。
- 检查失败时保留运行编号、实际进程退出码与未完成测试数量。重跑成功只能说明该次运行通过；稳定性问题的修复需要根因及回归证据。
- 新提交产生后，旧提交的通过记录与安装包继续作为历史记录，最终候选以新的统一 SHA 验收。
