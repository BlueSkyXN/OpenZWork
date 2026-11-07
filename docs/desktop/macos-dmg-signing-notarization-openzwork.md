# macOS DMG Signing And Notarization

## 背景

macOS release DMG 是用户从浏览器下载后直接交给 Gatekeeper 评估的最终分发物。3.1.2 曾出现 DMG 已经通过 `notarytool` 并执行 `stapler staple`，但 DMG 本体没有 Developer ID 签名的情况；带 Chrome quarantine 的下载文件会被 `spctl -t open/install` 判定为 `source=no usable signature`，导致部分用户安装失败。

## 目标

- `ZCode.app` 继续由 electron-builder 使用 Developer ID Application 签名。
- 最终 DMG 在提交 Apple notarization 前必须单独执行 Developer ID `codesign`。
- DMG 公证完成并去掉 `.unnotarized` 后，必须通过 `codesign`、`stapler validate` 和 `spctl -t open` 验收。
- 最终 `ZCode.app` 及其包内 Helper、安装后的用户级 Helper 必须分别通过 `codesign --verify --deep --strict` 和 `spctl -a -vv -t exec` 验收；两个 Helper 还必须通过本地 `xcrun stapler validate`，确认签名未被重新覆盖后 staple 仍对应最终 bundle。
- 正式 tag 发布禁止上传 `.unnotarized.dmg`；测试、sandbox 和 MR 链路可以保留未公证产物用于排查，但不得进入正式 release。

## CI 流程

### 临时 keychain 搜索列表约束

同一 macOS 用户下的 shell runner 共享用户级搜索列表。每个 job 的 keychain 文件独立，
但列表的读取、净化和增删必须在现有共享锁内完成，不使用 job 启动时的快照覆盖列表。

- `security list-keychains -d user` 输出带缩进和外层双引号；先去掉行首、行尾空白，再剥一层外部引号，
  保留路径内部的空格。只保留存在的绝对文件路径，按完整路径去重并保持原顺序。
- 若用户的 `login.keychain-db` 文件存在但列表中缺失，将其补到列表末尾，恢复被旧脚本污染的默认项。
  这不代替证书链和私钥访问权限检查。
- 添加必须幂等；清理只移除当前 job 的路径，保留其他 job 的有效条目；无剩余条目时明确写入空列表。读取列表失败时禁止回写，
  释放锁并报告失败，不能将读取失败当成空列表。
- 回归测试使用 Bash 执行实际 CI 函数，以模拟命令提供带缩进的列表及读写失败，禁止访问真实钥匙串。
  覆盖污染恢复、空格路径、去重、交错增删和锁释放；真实 runner 还需验证 arm64/x64 并发签名。

```text
获取共享锁 → 读取当前列表 → 解析并净化 → 增删自身条目 → 回写 → 释放锁
                         └ 读取失败 → 不回写 → 释放锁并失败
```

此约束只保护遵守同一锁协议的脚本。旧分支脚本仍可能覆盖列表，需更新脚本或隔离 runner 用户。
不按目录年龄自动删除临时 keychain，避免误删仍在构建的 job 资源。

## 本地无 Developer ID 的 Helper 调试

2. 从终端启动 ZCode App，并只在该进程环境里设置：
   `ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL=1`。产品 Helper resolver 正式版与本地/dist 构建默认启用；
   仅显式设置 `ZCODE_CUA_PRODUCT_HELPER=0|false|off` 才关闭。
   desktop 会把该确定性的本地路径作为 bundled source 注入 utility host；缺失时直接失败，
   不会回退网络下载。
3. ZCode.app 仍然通过 LaunchServices `open -n -g <Helper.app> --args --socket <path> --token-file <path> --launcher-pid <pid>`
   拉起外置 Helper，所以 macOS TCC 授权主体仍是 Helper 本身。产品路径**只接受 launcher 现签的一次性
   `--token-file`**（`helperMain` 会拒绝无 token-file 的产品 broker），并要求 `--launcher-pid` 做对端进程树
   校验；`--token` 仅用于显式本地 dev fallback，不应作为产品验收路径。

该模式只放宽 Developer ID TeamIdentifier 和 Gatekeeper/notarization 检查；bundle id、
版本、架构和 Mach-O 结构仍然必须匹配。缺失或结构不匹配时不会下载或替换正式 Helper，
而是 fail-closed。ad-hoc/unsigned Helper 的 TCC 身份不稳定，重建后可能需要重新授权；
正式验收仍必须使用签名、公证、staple 后的 Helper。

## 验收命令

```bash
codesign --verify ZCode-<version>-mac-<arch>.dmg
xcrun stapler validate ZCode-<version>-mac-<arch>.dmg
spctl -a -t open --context context:primary-signature ZCode-<version>-mac-<arch>.dmg
```

```bash
pnpm run doctor:macos-release -- "/Applications/ZCode.app"
ZCODE_CUA_REQUIRE_HELPER=1 pnpm run doctor:macos-release -- "/Applications/ZCode.app"
```

该命令会依次执行：

脚本在成功路径捕获上述命令输出，只在失败时打印原始诊断，避免 `codesign` / `spctl`
的 verbose 内部属性明细污染正式打包日志。
