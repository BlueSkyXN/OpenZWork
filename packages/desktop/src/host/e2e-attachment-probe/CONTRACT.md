# host-e2e-attachment-probe

WT04 direct 证据（docs/specs/wt04-direct-runtime-association-openzwork.md）的 Host 侧只读
探针。Window Host 在 `exposeServicesOnMessagePort` 内以 registry attach 事实
（attachmentId/scope/generation/clientMode）包装本 attachment 的 `IZCodeAgentService`，
观察真实 `subscribeConversationV4` ACK、`unsubscribeConversationV4` 与 attachment dispose，
并按 existing-only 语义查询 runtime identity，逐行写入 run artifact 的 ndjson。

## 合同

- 仅当专用 E2E bridge flag（`VITE_ZCODE_E2E_STORE_BRIDGE=1`）、非空 run ID
  （`ZCODE_E2E_RUN_ID`）与有效 artifact 目录三者齐备时启用；缺一禁用（零包装、零输出、
  零额外 runtime 查询），artifact 路径逃逸按禁用处理不崩溃 Host。
- 诊断不改变产品 ACK、背压或路由语义：proxy 透传结果，写失败仅丢记录。
- runtime 查询沿用 `getWorkspaceRuntimeIdentity` existing-only 合同；失败记
  `runtimeIdentityError`，不拉起 dormant runtime。
- 记录含单调 `seq`、`recordedAt`、scope 与订阅参数两列 remoteSessionId、
  `scopeMatchesTarget`、订阅结束事件（unsubscribed / attachment-disposed）。
