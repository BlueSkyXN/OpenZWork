



本规格同时覆盖三个包，因为这次它们的版本事实源清单**结构性地变了**：Browser Use 原本的
五处事实源里，第五处 `NODE_REPL_SERVER_VERSION` 随宿主迁出，成了 node-repl-host 自己的
记录。此前每版一份的 `docs/browser-use/*-browser-use-plugin-version-*-spec.md` 系列只描述
单插件，无法表达迁出后的归属。

## 1. 版本决策

| 包 | 旧版本 | 新版本 | 决策依据 |
| --- | --- | --- | --- |
| `@zcode/browser-use-plugin` | 0.4.2 | 0.5.0 | 发布单元内容变了：node_repl MCP server 不再由本插件携带（`dist/mcp/server.js` 移出 seed 清单），插件只剩 skill、client runtime 与文档。这是发布物构成的变化，不是缺陷修复，取 minor。 |



node-repl-host 与 Browser Use 数字相同**只是同源历史的巧合**，不构成耦合：两者各自独立升版，
`NODE_REPL_SERVER_VERSION` 的注释里已就地记录这一点。

## 2. 版本事实源

### 2.1 Browser Use（四处，手工维护）

1. `apps/zcode-cli/packages/browser-use-plugin/package.json`；
2. `apps/zcode-cli/packages/browser-use-plugin/.zcode-plugin/plugin.json`；
3. Bootstrap `OFFICIAL_PLUGIN_DEFINITIONS` 里 `browser-use` 条目；
4. SEA `officialSeaPlugins` 里 `browser-use` 条目。

原第五处 `NODE_REPL_SERVER_VERSION` 已不属于本插件——它随宿主迁到 node-repl-host。

### 2.2 node-repl-host（五处 + 一份产物，手工维护）

1. `apps/zcode-cli/packages/node-repl-host/package.json`；
2. `apps/zcode-cli/packages/node-repl-host/.zcode-plugin/plugin.json`；
3. Bootstrap `OFFICIAL_PLUGIN_DEFINITIONS` 里 `node-repl-host` 条目；
4. SEA `officialSeaPlugins` 里 `node-repl-host` 条目；
5. `src/tool-contract.ts` 的 `NODE_REPL_SERVER_VERSION`，即 MCP `serverInfo.version`。

另有 `dist-types/tool-contract.d.ts` 是 git-tracked 的声明产物，必须与 src 同步提交。



## 3. 发布与缓存链路

```text
browser-use:     package / manifest / Bootstrap / SEA            = 0.5.0
node-repl-host:  package / manifest / Bootstrap / SEA / serverInfo = 0.5.0
computer-use:    workspace package -> wrapper / Bootstrap         = 0.6.0
                         |
                         v
 filesystem / SEA / Desktop / remote official assets
                         |
                         v
 seed temp -> atomic promote -> <plugin>/<version>
                         |
                         v
 新 runtime 与其版本身份一起生效
```

官方 cache 目录名带版本号，因此升版后 seed 进新目录；旧目录可作为历史缓存保留，但官方
discovery 只应指向新版本。

## 4. 兼容边界

- 不改协议、不改 `ToolResultPayload` 等既有数据形态；本次只改版本身份与其同步点。
- 历史版本规格（`0.4.1`、`0.4.2` 等）继续记录旧版本事实，**不回写为新版本**。
- Browser Use 的 SEA 条目注释此前硬编码了当时的版本号，本次改为版本中立表述，去掉一个多余的
  漂移点（同文件 document-skills 条目的注释本来就是中立的）。

## 5. 防漂移的机械校验

| 校验点 | 覆盖范围 |
| --- | --- |
| `plugins.test.ts`「keeps every bundled plugin package, manifest, and seed version aligned」 | 逐个官方插件比对 package / manifest / Bootstrap definition |
| `build-sea.test.mjs`「keeps SEA official plugin versions aligned with package and plugin manifests」 | 逐个 SEA 条目比对 package / manifest / SEA 清单 |
| `node-repl-host/test/mcp-server.test.ts` | 钉住 `serverInfo.version` == 本包 `package.json.version` |


## 6. 验证

见本次提交的验证记录：producer 侧 typecheck / lint / 单测；消费侧
`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`、受影响单测与 CLI 子
workspace 单测。
