# GitHub Actions 的 Node.js 24 运行时升级

## 目标与范围

消除 `CI` 与 `Installers` 工作流中 JavaScript Action 声明使用 Node.js 20 的弃用提示，不依赖 GitHub runner 强制切换旧 Action 的运行时。

本次只维护 `.github/workflows/ci.yml`、`.github/workflows/installers.yml` 和对应的离线结构测试。不修改产品代码、lint 规则、项目依赖或锁文件；保留已有 Linux 矩阵扩展。

## 所有者与边界

- Action 自身的运行时由所引用发布版本的 `action.yml` 中 `runs.using` 决定。
- 项目命令的 Node.js 版本仍由 `mise.toml` 与工作流的 `node-version` 固定为 `24.14.0`；pnpm 仍固定为 `10.33.2`。
- 工作流 YAML 是步骤、缓存配置和 artifact 上传配置的唯一所有者。测试只读取它们，不维护第二条执行链。
- GitHub 托管 runner 负责执行 Action 和保存缓存、artifact；本地测试不模拟这些服务，也不声称完成真实 runner 验收。
- 不引入或修改产品状态、协议、持久化及 Desktop/Web 同步链路。本改动位于架构策略的产品模块之外。

## 版本契约

2026-09-30 核对官方发布说明与对应 `action.yml`，下列精确发布版本均声明 `runs.using: node24`：

| Action                    | 发布版本 |
| ------------------------- | -------- |
| `actions/checkout`        | `v7.0.1` |
| `actions/setup-node`      | `v7.0.0` |
| `actions/cache`           | `v6.1.0` |
| `pnpm/action-setup`       | `v6.1.0` |
| `actions/upload-artifact` | `v7.0.1` |

两份工作流引用相同的精确版本，不使用 `latest`、浮动主版本或运行时强制降级变量。以后更新版本时同步审查此契约与结构测试。

## 行为与兼容性规则

1. 保留触发条件、并发取消策略、平台矩阵、timeout、业务命令和失败传播；不加入 `continue-on-error` 或警告隐藏配置。
2. 保留顺序：checkout、安装 pnpm、setup-node、显式安装依赖。`pnpm/action-setup` 不承担仓库依赖安装，不替换成 `pnpm/setup`。
3. 检查型 CI 的安装仍为 `pnpm install --frozen-lockfile --ignore-scripts`；安装包工作流仍执行完整的 `pnpm install --frozen-lockfile`。
4. setup-node 继续显式 `cache: pnpm`；pnpm/action-setup 的内置缓存保持默认关闭，不新增第二份 pnpm 缓存。
5. turbo 与 Electron/electron-builder 的缓存路径、key、restore-keys 不变。
6. 安装包继续以 `openzwork-installer-${{ matrix.platform }}` 聚合上传多种文件，保留全部 glob 与 `if-no-files-found: error`。显式 `archive: true`，不启用 upload-artifact v7 新增的单文件直传模式。
7. Node.js 24 Action 要求 Actions Runner 至少 `2.327.1`。当前使用 GitHub 托管 runner；若以后迁移到自托管 runner，必须先核对 runner 版本。checkout 的 Docker container action 认证操作另要求至少 `2.329.0`，当前工作流无此操作。
8. checkout v7 对 `pull_request_target`/`workflow_run` 的 fork checkout 安全限制不应绕过；当前工作流不使用这两种触发器。

## 验收场景与验证

- 离线结构测试先在旧工作流上失败，再在升级后通过；检查精确 Action 版本、固定工具链、安装顺序、缓存与 artifact 配置。
- `CI` 新增独立的 `node --test tests/ci/*.test.mjs` 步骤，使结构测试在各平台持续执行。测试使用仓库已有的 YAML 解析器，不联网或下载 Action。
- `actionlint .github/workflows/ci.yml .github/workflows/installers.yml` 校验工作流语法、表达式与 Action 输入。
- 必须实际执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`；既有 lint warning 不纳入本次清理。
- 真实 GitHub 运行需在提交并推送后验证：各平台 Action 初始化、pnpm 缓存、turbo/Electron 缓存和 artifact 上传成功，且不再出现本次涉及的 Node.js 20 Action 弃用提示。
- 旧运行的 Annotations 是历史记录，不因修改 YAML 而被清除。本次未授权提交、推送或远端 workflow dispatch，本地验证不能代替最后一项。

## 官方依据

- [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) / [action.yml](https://github.com/actions/checkout/blob/v7.0.1/action.yml)
- [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) / [action.yml](https://github.com/actions/setup-node/blob/v7.0.0/action.yml)
- [cache v6.1.0](https://github.com/actions/cache/releases/tag/v6.1.0) / [action.yml](https://github.com/actions/cache/blob/v6.1.0/action.yml)
- [pnpm/action-setup v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0) / [action.yml](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml)
- [upload-artifact v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) / [action.yml](https://github.com/actions/upload-artifact/blob/v7.0.1/action.yml)
