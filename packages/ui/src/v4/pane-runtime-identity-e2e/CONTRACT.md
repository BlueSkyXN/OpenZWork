# pane-runtime-identity-e2e

WT04 direct 证据（docs/specs/wt04-direct-runtime-association-openzwork.md）的 pane 侧
观察面。被测 SessionPane 在 E2E 构建下用「自己当前注入的服务 + Provider 已解析 scope」
独立查询 workspace runtime identity，写 `window.__zcodePaneRuntimeIdentityE2E[paneKey]`；
E2E 可经 `window.__zcodePaneRuntimeIdentityE2ERefresh[paneKey]` 在同一挂载期内触发重查
（查看前/后对比）。

## 合同

- E2E 构建开关（`shouldExposeE2EStoreBridge`）打开后才读取 run ID。优先从 URL 读
  `zcodeE2eRunId`，URL 缺少该值时读 `sessionStorage` 的同名键，空查询串也适用。
  没有有效 run ID 时关闭诊断。
- 查询走 pane 注入的 `zcodeSessionService`（与 V4 会话订阅同一 accessor/服务端口），
  existing-only 语义；失败按 error 条目记录，验收端把缺证据/错误判失败。
- 注册与重查入口随 pane 生命周期清理，不读切页前的闭包；active=false 或缺 workspacePath
  时不查询、清空本 pane 条目。
