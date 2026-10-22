# Desktop CI/CD

当前仓库使用 `.github/workflows/` 下的 GitHub Actions。Node 与 pnpm 版本遵循 `mise.toml` 和仓库 package manager 声明；具体运行时准备规则见[GitHub Actions runtime](./spec/github-actions-runtime.md)。

## 工作流

| 文件                                    | 触发                    | 职责                                   |
| --------------------------------------- | ----------------------- | -------------------------------------- |
| `.github/workflows/ci.yml`              | PR、main push           | 当前核心检查与类型、代码质量门禁       |
| `.github/workflows/installers.yml`      | 手动、main/wp 分支 push | macOS、Windows、Linux 安装产物构建     |
| `.github/workflows/extended-checks.yml` | PR、main push、手动     | 历史测试与桌面主进程审计，独立报告结果 |

以工作流中的 matrix、脚本与 artifact 配置为准。构建完成后检查对应 job 结果与上传产物；安装包的实际安装和产品验收单独执行。

## Source Server 与开发资源

3.16 的主远程链路按 Source Server release descriptor 和完整 archive 解析、校验和安装制品。Desktop 的窗口 Host 复用已有远程资产网络出口；安装与原子切换规则见[R3 架构](./architecture/r3-source-server-remote-architecture.md)。

开发态通过 `scripts/build-desktop-agent-cli.mjs` 构建 Agent bundle 与通用插件 runtime。桌面打包与 Source Server 资产装配使用当前各包脚本；`packages/server` 下的 component installer 仍有独立兼容测试，不能据此把旧散文件安装方式描述为 R3 主链。

## 本地检查

从仓库根目录运行当前任务要求的类型、lint 与架构检查，测试入口取目标包和现有测试文件。CI 中某个检查通过，只证明该 job 的实际范围；安装产物与真实跨平台交互仍需对应验证记录。
