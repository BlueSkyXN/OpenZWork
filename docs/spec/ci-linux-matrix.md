# CI Linux 矩阵接入（CI/CD 拓展第一步）

状态：本文件先于 workflow 改动落地。GitHub Actions 侧为纯 YAML 接线，不动产品代码与测试代码。真实 runner 验证依赖 push 后的 Actions 运行，本仓库本地无法执行 GitHub Actions。

## 背景与目标

- 打包链已完整支持 Linux：`packages/desktop/scripts/bundle.mjs` 接受 `--os linux`（x64/arm64），`electron-builder.config.js` 维护 AppImage/deb/rpm/pacman 四种 target 及各自的包名隔离与运行时依赖闭包；node-pty 与 native 搜索工具（bfs/ugrep/ripgrep）的 Linux 预编译配置齐备。
- 缺口仅在 CI 接线：`.github/workflows/ci.yml`（检查矩阵）与 `installers.yml`（安装包矩阵）此前只有 macOS 与 Windows runner，Linux 打包链从未在 CI 执行过。
- 本步是后续 E2E 工作流（桌面 xvfb E2E、发行物容器冒烟）的地基；全部基于 GitHub Actions，不引入其他 CI 平台。

## 规则

- 检查矩阵新增 `ubuntu-latest`，执行与既有平台完全相同的步骤序列；不为 Linux 单独增删检查项。
- 行为测试的平台跳过条件是测试文件自身的职责（当前 POSIX 用例 `skip: process.platform === "win32"`，Linux 上应全量运行）；workflow 不加平台特判。`ci.yml` 中"POSIX 用例仅在 macOS 执行"的旧注释描述的是矩阵现状而非技术限制，接线后同步修正。
- 安装包矩阵新增 `ubuntu-latest`（linux/x64），产出 AppImage/deb/rpm/pkg.tar.zst 四类产物；产物后缀、体积审计、运行时依赖校验沿用 `bundle.mjs` 既有链路，不在 workflow 里重复实现。
- Linux 打包的系统工具链依赖（rpmbuild、zstd）由 workflow 显式 `apt-get install` 声明，不假设 runner 镜像自带；该步骤仅 Linux job 执行。
- macOS 无签名分发定论不变；Linux 三类包格式均为无签名分发，不引入签名步骤。

## 验收场景

1. push 到含本改动的分支后，`checks (linux-amd64)` 与 `installer (linux-amd64)` 两个 job 被调度并运行既有全量步骤。
2. Linux 检查 job 上：typecheck / lint / architecture / turbo typecheck / cleanup 结构测试 / identity 与 remote path 行为测试（POSIX 用例不跳过）/ remote UAT / services+ui 包测试全部执行，结论真实反映（红灯即红灯，不静默）。
3. Linux 打包 job 上：`bundle --os=linux --arch=x64` 产出四类安装包并通过 bundle 内置的运行时依赖与 native 边界校验、体积审计；artifact 上传包含全部四类文件。
4. 既有 macOS / Windows job 的行为与触发面不变。

## 已知风险与边界

- Linux 打包 job 首次运行可能暴露上游从未在 Linux CI 风跑过的打包细节（fpm 工具链、镜像下载、缓存路径）。失败时按真实错误修 workflow 或配置，不用 `continue-on-error` 掩盖。
- `installers.yml` 的 push 触发面覆盖 `wp**` 分支，便于先行验证；正式发布收敛触发面属后续工作（release 工作流另立 spec）。
- 检查矩阵加入 Linux 后整体 CI 时长与配额消耗上升约一个平台；如成为问题，后续以路径过滤或 nightly 分层收敛，不在本步处理。
