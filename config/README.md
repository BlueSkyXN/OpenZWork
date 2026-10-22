# 内置默认配置

`config/default.json` 是随客户端分发的默认配置，必须保留。Desktop 从打包文件读取，
Web 在构建时导入；缺少有效字段时使用内置值。

## 帮助配置来源

帮助入口只读内置 `default.json`，读取 `community_urls["zh-CN" | "en-US"]`：
只按当前语言回退到内置入口，不跨语言回退。

官方 `GET /api/v1/client/configs` 远端拉取已随官方服务移除，帮助配置不再有远端请求、
内存缓存或反馈字段链路（`feedback_url` 等反馈字段已无消费者）。

```text
内置 default.json -> 平台入口
```

旧 CDN default.json 仅为旧版客户端兼容保留；新版无请求或 URL 构造链路，
不要因此删除线上旧文件或本目录内置文件。内置文件的其他字段与既有消费者保持不变。

详细规则见 [用户社群入口配置](../docs/ui/settings-community-link-config.md)。
