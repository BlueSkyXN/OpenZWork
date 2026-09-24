# 内置默认配置

`config/default.json` 是随客户端发布的默认配置，必须保留。Desktop 从打包文件读取，
Web 在构建时导入；缺少有效字段时使用内置值。

## 帮助配置来源

帮助入口只读内置 `default.json`，读取 `community_urls["zh-CN" | "en-US"]`：
只按当前语言回退到内置入口，不跨语言回退。

官方 `GET /api/v1/client/configs` 远端拉取已随官方服务移除，帮助配置不再有远端请求、
内存缓存或反馈字段链路（`feedback_url` 等反馈字段已无消费者）。

```text
内置 default.json -> 平台入口
```

default.json 为随客户端分发的内置默认配置；历史上曾经 CDN 分发，现版本无请求或 URL
构造链路，只依赖本目录内置文件。
