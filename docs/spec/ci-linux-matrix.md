# CI Linux 矩阵接入（CI/CD 拓展第一步）

状态：Linux 矩阵已合入 main，三平台检查通过；2026-10-03 首次 main 安装包运行在 Linux pacman 目标失败，macOS/Windows 成功。本文补充系统工具链修复规则；只修改 workflow 与离线回归测试，不改产品代码。修复后的真实 Linux 打包仍须由 Actions 验证，本地测试不能替代 runner 验收。

## 背景与目标

- 打包链已完整支持 Linux：`packages/desktop/scripts/bundle.mjs` 接受 `--os linux`（x64/arm64），`electron-builder.config.js` 维护 AppImage/deb/rpm/pacman 四种 target 及各自的包名隔离与运行时依赖闭包；node-pty 与 native 搜索工具（bfs/ugrep/ripgrep）的 Linux 预编译配置齐备。
- 缺口仅在 CI 接线：`.github/workflows/ci.yml`（检查矩阵）与 `installers.yml`（安装包矩阵）此前只有 macOS 与 Windows runner，Linux 打包链从未在 CI 执行过。
- 本步是后续 E2E 工作流（桌面 xvfb E2E、发行物容器冒烟）的地基；全部基于 GitHub Actions，不引入其他 CI 平台。

## 规则

- 检查矩阵新增 `ubuntu-latest`，执行与既有平台完全相同的步骤序列；不为 Linux 单独增删检查项。
- 行为测试的平台跳过条件是测试文件自身的职责（当前 POSIX 用例 `skip: process.platform === "win32"`，Linux 上应全量运行）；workflow 不加平台特判。`ci.yml` 中"POSIX 用例仅在 macOS 执行"的旧注释描述的是矩阵现状而非技术限制，接线后同步修正。
- 安装包矩阵新增 `ubuntu-latest`（linux/x64），产出 AppImage/deb/rpm/pkg.tar.zst 四类产物；产物后缀、体积审计、运行时依赖校验沿用 `bundle.mjs` 既有链路，不在 workflow 里重复实现。
- Linux 打包系统工具链由 `installers.yml` 统一声明：`rpm` 提供 `rpmbuild`、`zstd` 提供同名压缩命令、`libarchive-tools` 提供 `bsdtar`。pacman 的 `.MTREE` 生成依赖 bsdtar，不能以 GNU tar 替代，不假设 runner 镜像自带。
- 工具链安装之后立即执行 `rpmbuild --version`、`zstd --version`、`bsdtar --version`，在依赖安装与重型打包前完成预检。安装和预检仅 Linux job 执行，使用 Bash 严格失败传播；缺工具或命令非零退出即停止，不加 `continue-on-error`、`|| true` 或平台 skip，不改打包 target 与产物上传规则。
- macOS 无签名分发定论不变；Linux 三类包格式均为无签名分发，不引入签名步骤。

## 验收场景

1. push 到含本改动的分支后，`checks (linux-amd64)` 与 `installer (linux-amd64)` 两个 job 被调度并运行既有全量步骤。
2. Linux 检查 job 上：typecheck / lint / architecture / turbo typecheck / cleanup 结构测试 / identity 与 remote path 行为测试（POSIX 用例不跳过）/ remote UAT / services+ui 包测试全部执行，结论真实反映（红灯即红灯，不静默）。
3. Linux 打包 job 上：`bundle --os=linux --arch=x64` 产出四类安装包并通过 bundle 内置的运行时依赖与 native 边界校验、体积审计；artifact 上传包含全部四类文件。
4. 既有 macOS / Windows job 的行为与触发面不变。
5. `tests/ci/actions-runtime.test.mjs` 从真实 YAML 读取 Linux 安装与预检步骤，断言三个工具包齐备、Linux-only 条件、安装后/重型构建前顺序及失败传播。POSIX 宿主用临时 PATH 中的工具 stub 执行真实预检命令，覆盖全工具成功、逐项缺失和逐项非零退出；不是模拟 apt 或真正打包。

## 首次安装包失败证据与修复范围

- main 合并提交 `5af8f56679063bab8b46cb576cf281b4767b579d` 的 [Installers run 37091401883](https://github.com/BlueSkyXN/OpenZWork/actions/runs/37091401883)：macOS/Windows 构建与 artifact 上传成功，Linux 在 fpm pacman `.MTREE` 阶段失败，未上传 Linux artifact。
- 失败命令为 `LANG=C bsdtar -czf .MTREE --format=mtree ...`，Bash 返回 127；原工具链步骤仅安装 `rpm zstd`。同一构建重试仍在同一命令失败，不按偶发网络失败重跑，不跳过 pacman 掩盖缺依赖。
- 修复边界是补齐 `libarchive-tools` 并提前检查工具命令；不修订产品版本、Preview/Production 身份或发布触发面，不创建 tag/Release，不将旧运行或本地 stub 测试写成修复后真实 Linux 打包通过。

## 2026-10-03 本地修复验证

- 修改 workflow 前，离线测试 9 项原有用例通过、9 项新增工具链回归失败；补齐依赖与预检后 18/18 通过，零跳过。POSIX 执行测试使用临时工具 stub，未运行 Ubuntu apt 或真实 Linux 打包；Windows 仅执行结构断言，7 项 Bash 执行用例按平台跳过。
- Node 24.14.0 下 `pnpm typecheck`、`pnpm lint`（238 warnings / 0 errors）、架构检查（0 baseline / 0 new）通过；私有化结构门禁 39/39，actionlint、本轮文件格式与差异检查通过。
- 以上为 `fix/linux-installer-toolchain` 的本地验证记录，不代表 main 的打包失败已在云端修复。修复提交的 CI 与真实安装包运行须按对应 SHA 另行核对，不能用离线工具 stub 代替真实 Linux 打包。

## 已知风险与边界

- Linux 打包 job 首次运行可能暴露上游从未在 Linux CI 风跑过的打包细节（fpm 工具链、镜像下载、缓存路径）。失败时按真实错误修 workflow 或配置，不用 `continue-on-error` 掩盖。
- `installers.yml` 的 push 触发面覆盖 `wp**` 分支，便于先行验证；正式发布收敛触发面属后续工作（release 工作流另立 spec）。
- 检查矩阵加入 Linux 后整体 CI 时长与配额消耗上升约一个平台；如成为问题，后续以路径过滤或 nightly 分层收敛，不在本步处理。
