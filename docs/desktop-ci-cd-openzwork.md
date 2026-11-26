# Desktop CI/CD

当前仓库使用 `.github/workflows/` 下的 GitHub Actions。Node 与 pnpm 版本遵循 `mise.toml` 和仓库 package manager 声明；具体运行时准备规则见[GitHub Actions runtime](openzwork/ci/github-actions-runtime.md)。

## 工作流

<!-- OpenZWork 使用 GitHub Actions 而非上游 GitLab CI；上游 .gitlab/ci/* 发布流水线（OSS 上传、CDN 预热、灰度/正式发布 API、飞书发布通知）依赖官方发布基础设施，属净化域，不随上游引入 -->

| 文件                                    | 触发                                               | 职责                                                                             |
| --------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`              | PR、`main` / 正式 tag push、手动                   | 核心类型检查、代码质量、CLI/SEA 打包隔离回归与工作流中枢 E2E（手动可选交互 E2E） |
| `.github/workflows/installers.yml`      | 手动、`main` / `wp**` 分支或正式 tag push          | macOS、Windows、Linux 安装包与独立 CLI 归档构建及 PK01 包内核验                  |
| `.github/workflows/extended-checks.yml` | PR、`main` / 正式 tag push、手动                   | 全量套件分片测试、Windows 修复回归与桌面主进程审计，独立汇总报告                 |
| `.github/workflows/release.yml`         | 三大门禁工作流完成（`workflow_run`）、手动干跑校验 | 核验正式 tag 构建与测试结果后自动发布 GitHub Release                             |

以工作流中的 matrix、脚本与 artifact 配置为准。构建完成后检查对应 job 结果与上传产物；安装包的实际安装和产品验收单独执行。

## Source Server 与开发资源

3.16 起主远程链路按 Source Server release descriptor 和完整 archive 解析、校验和安装制品。Desktop 的窗口 Host 复用已有远程资产网络出口；安装与原子切换规则见[R3 架构](./architecture/r3-source-server-remote-architecture.md)。

开发态通过 `scripts/build-desktop-agent-cli.mjs` 构建 Agent bundle 与通用插件 runtime。桌面打包与 Source Server 资产装配使用当前各包脚本；`packages/server` 下的 component installer 仍有独立兼容测试，不能据此把旧散文件安装方式描述为 R3 主链。

## 桌面 E2E 准入与 Linux 打包基线

- **正式 E2E 环境准入**：定向分片或筛选正式桌面 E2E 时，分桶前须沿用与默认全量一致的环境门禁（`packages/desktop/scripts/e2e-formal-spec-selection.mjs`）过滤——远端队列 spec 需要 `ZCODE_E2E_SSH_CONTAINER` 等远端 harness，未入队的 `ssh-remote` spec 需要 SSH 凭据，专用外部预装归档 spec 需要对应环境变量；缺少前置条件时不进入分桶，避免显式 `--spec` 绕过默认环境准入。
- **Linux 打包工具链与 glibc 基线**：Linux 打包产出 `OpenZWork`（或 `OpenZWork Preview`）的 `AppImage`、`deb`、`rpm` 与 `pkg.tar.zst` 安装包，面向 glibc 2.28 基线（Ubuntu 20.04+、Debian 10+、RHEL 8+）；Runner 在安装依赖前显式安装并校验 `rpmbuild`（`rpm`）、`zstd` 与 `bsdtar`（`libarchive-tools`）。

## 本地检查

从仓库根目录运行当前任务要求的类型、lint 与架构检查，测试入口取目标包和现有测试文件。CI 中某个检查通过，只证明该 job 的实际范围；安装产物与真实跨平台交互仍需对应验证记录。

<!-- 上游 GitLab 发布链路章节（release job 表、MR 手动 Job、发布链路对比、触发规则、Computer Use Helper 发布 job、OSS/CDN/Zara 发布脚本）依赖官方私有基础设施，属净化域，不随上游引入。 -->
