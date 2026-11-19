# macOS 未签名包：首次打开与局域网连接

适用于 OpenZWork 未经 Developer ID 签名和公证的 macOS 安装包。正式版叫 `OpenZWork.app`，Preview 叫 `OpenZWork Preview.app`。下文假定已从 DMG 拖入「应用程序」；装在其他位置时改用实际路径。

## 首次打开时被 macOS 拦截

如果系统提示应用「已损坏」或「无法验证开发者」，先确认安装包来自可信渠道；发布页提供 `SHA256SUMS` 时，核对文件摘要。确认要运行该副本后，按 [README 的打包说明](../../../README.md#打包)只移除这个应用的 `com.apple.quarantine` 属性，再从 Finder 打开。只执行与你的版本对应的一行：

```bash
# 正式版
sudo xattr -rd com.apple.quarantine "/Applications/OpenZWork.app"
# Preview
sudo xattr -rd com.apple.quarantine "/Applications/OpenZWork Preview.app"
```

## 应用能打开，但 SSH 报 `EHOSTUNREACH`

1. 先从同一台 Mac 验证目标主机和 SSH 端口可达。在终端也连不上时，先核对地址、路由、端口及目标主机的 SSH 服务。
2. 终端能连接但应用仍失败时，在「系统设置 → 隐私与安全性 → 本地网络」检查对应的正式版或 Preview 是否获准访问。退出后重新打开，再用相同目标复测。
3. 如果连通性与权限都已确认，但未签名包仍失败，可尝试给**单独的测试副本**临时签名。退出测试副本后执行下列命令，把路径替换成该副本的实际位置；Preview 的路径也要保留引号。重开后重新检查本地网络权限并复测同一 SSH 目标。

   ```bash
   codesign --force --deep --sign - "/path/to/test-copy/OpenZWork.app"
   ```

   临时签名会改变副本的签名身份，不是 Developer ID 签名或公证。保留原安装包，结束测试后可从原包恢复。

临时签名的排查方法来自同源下游 Rain-kl 的发行说明。`EHOSTUNREACH` 本身不能判定是签名或权限问题；首次打开和局域网 SSH 两个场景尚未在 OpenZWork 的未签名下载包与局域网双机环境中复验。
