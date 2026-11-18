# WT04 direct runtime association（OpenZWork 自有合同）

状态：active（2026-11-16）。本文件是 OpenZWork 自有 spec，不是上游文档改写；上游
`docs/git/worktree.md` 的 WT-12 场景表保持上游原文不动。

## 目的

WT04（受管 worktree 冷恢复归属 + 手机查看）的「手机查看复用原 Host/CLI runtime」断言，
必须以**两端独立读取的真实 runtime 身份**与 **Host 真实 attachment/subscription 证据**
交叉核对成立。禁止用同一份读数赋给两端（历史 sharedInstanceKey 同值代填）、
禁止用 generation/state 相等替代实例身份（独立复核反例：两个独立 CLI 各自
`ensureReady` 后都是 generation=1/state=ready）、禁止以全局进程树计数作替代判据。

## 观察面（只读，不构造第二份业务状态）

| 观察面                            | owner                                                                         | 取值方式                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面 pane runtime 查询            | 被测 SessionPane 当前注入的服务（`useServices()` 返回的 pane accessor）       | `zcodeSessionService.getWorkspaceRuntimeIdentity({ workspacePath, workspaceIdentity, remoteSessionId? })`，remoteSessionId 取 V4 Provider 当前已解析 scope（`V4ConversationContextValue.remoteSessionId`） |
| 手机 pane runtime 查询            | 手机页同一 SessionPane 组件注入的服务                                         | 同上；手机 attachment 的 scope 由 workspaceConnectionRegistry 解析出真实 remoteSessionId                                                                                                                   |
| Host attachment/subscription 记录 | Window Host（`windowHostAttachmentRegistry` + `exposeServicesOnMessagePort`） | `subscribeConversationV4`/`unsubscribeConversationV4` 真实调用与 ACK 经 E2E-only probe 代理记录；attachmentId/scope/generation/clientMode 来自 registry attach 参数                                        |
| 进程树快照                        | WDIO 测试进程                                                                 | `ps -axo pid=,ppid=,lstart=,command=`；仅作辅助诊断输出，不参与判定                                                                                                                                        |

pane 查询与 Host probe 都只读取既有服务；不新增业务 RPC、不新增 probe port、
不发送测试 subscription、不由 Renderer 自报 Host attachment owner。

## 事件顺序（唯一 owner：Host；订阅生命周期归 connection scope facade）

```mermaid
sequenceDiagram
    participant D as 桌面 pane（desktop-continuous attachment）
    participant H as Window Host（registry + probe）
    participant R as CLI runtime（workspaceKey 单活）
    participant M as 手机 pane（web-remote-replayable attachment）

    D->>H: subscribeConversationV4（真实订阅）
    H->>R: 转发订阅（existing-only runtime）
    H-->>D: ACK subscriptionId
    H->>probe: record subscribed(seq↑, attachmentId, scope, ACK, runtimeIdentity)
    Note over D: 桌面查询①：pane 独立 getWorkspaceRuntimeIdentity
    Note over D,probe: 取得桌面订阅记录后保存查看前 seq，固定原订阅
    M->>H: attach（registry：attachmentId/scope/clientMode/generation）
    M->>H: subscribeConversationV4（查看期间真实订阅）
    H-->>M: ACK subscriptionId
    H->>probe: record subscribed(seq↑, attachmentId, scope, ACK, runtimeIdentity)
    Note over M: 手机查询②：pane 独立 getWorkspaceRuntimeIdentity
    Note over D: 桌面查询③：查看后 pane 再查（连续性）
    H->>probe: record unsubscribed / attachment-disposed（结束事件）
```

判定输入只来自图中标注的观察面；测试把①②③与 probe 记录交叉核对。
时序合同（2026-11-17 J2 对齐实现）：probe 记录在真实调用返回 ACK 之后异步落盘
（不阻塞产品 ACK）；结束事件记录排在此前在途 subscribed 记录之后，dispose 冲刷
等待全部在途观察完成——文件行序与 seq 单调一致，由判定合同 8 校验。

## 启用合同（缺一不启用；关闭时零输出、零额外查询、零注册诊断入口）

Host probe 三条件：

1. 专用 E2E bridge flag：`VITE_ZCODE_E2E_STORE_BRIDGE=1`（复用既有 E2E-only 开关）。
2. 非空 run ID：`ZCODE_E2E_RUN_ID`。
3. 有效 artifact 目标：`ZCODE_E2E_ARTIFACT_DIR` 存在且输出路径不逃逸该目录。

pane 诊断双条件（2026-11-17 J2 补齐，与 Host 同口径）：

1. 同一 build flag（renderer/Web 构建期注入）。
2. 页面携带有效 run ID：桌面 renderer 由 main 在加载 URL 注入 `zcodeE2eRunId`
   （desktopHostProcess，仅在 Host 同一 gate 命中时下发）；手机 Web 由 E2E helper
   写入 `sessionStorage` 的同名键。优先读 URL，查询参数为空或未提供 run ID 时读存储。
   任一条件缺失（含生产构建）不注册 `__zcodePaneRuntimeIdentityE2E*` 诊断入口、不做额外查询。

Host 侧 probe 记录写入 `<artifactDir>/host-probes/host-attachment-subscriptions-<hostPid>.ndjson`，
每行一条 JSON（seq 单调递增、recordedAt ISO 时间、event、attachmentId、clientMode、
scope、scopeMatchesTarget、sessionId、topic、subscriptionId、workspacePath/workspaceIdentity/
workspaceKey、remoteSessionId（scope 与订阅参数两列）、runtimeIdentity（Host 按
`getWorkspaceRuntimeIdentity` existing-only 语义查询；失败记 runtimeIdentityError，不拉起
dormant runtime））。写入串行化（write chain），诊断失败不改变产品 ACK/背压/路由语义。

## 判定合同（全部满足才算 direct 关联成立）

1. 桌面/手机 pane 查询均 status=ok，且各自返回 identity/generation/workspaceKey；
   查询不可用（服务缺失、错误、缺记录）一律判失败。
2. 两侧 sessionId 一致且与两条 Host 记录的 sessionId 一致；topic 与 sessionId 对应。
3. workspace key 一致：`workspaceIdentity?.trim() || workspacePath`；本地 workspace 两侧
   identity 同为空合法；同路径不同 identity 仍严格隔离（单侧不一致判失败）。
4. 桌面记录：clientMode=desktop-continuous、scope 与桌面 pane 解析一致（本地 workspace
   为 local）、scopeMatchesTarget=true。手机开始查看前须取得对应桌面订阅记录，按
   `seq <= lastSeqBeforeView` 固定最后一次订阅。该订阅开始后到查看结束前收到
   unsubscribed/attachment-disposed 即失败，之后的新订阅不更改已固定的记录。
5. 手机记录：clientMode=web-remote-replayable、scope 与手机 pane 解析一致——本地配对
   查看桌面 workspace 走 shared Host attachment（scope=local，attachmentId 形如
   `shared-host-attachment-*`）；查看远端 workspace 时 scope=remote 且 remoteSessionId 与
   registry scope 一致；订阅发生在查看窗口内（seq > 窗口起点）。
   5a. 查看窗口以 probe 单调 seq 表达：`lastSeqBeforeView`（手机查看前最后落盘 seq）与
   `lastSeqInViewEnd`（查看结束、用例收尾之前的 seq 快照）。结束事件只在
   (subscribed.seq, lastSeqInViewEnd] 内算查看中关闭；用例收尾的 dispose
   （seq > lastSeqInViewEnd）不算。手机订阅有效性（未在查看中结束）与桌面同标准。
   5b. 两端记录必须各自独立：attachmentId、hostConnectionId、subscriptionId 任一同值
   即拒绝（实测 local 配对拓扑亦为三个不同值；同值即一端记录复用另一端）。
6. Host 侧 runtimeIdentity 与对应 pane 查询结果一致（identity、workspaceKey；generation
   仅辅助），且完整核对查询返回值：Host 记录内嵌 runtimeIdentity.workspaceKey 与 pane
   查询返回的 workspaceKey 互证（Host 查回 other-workspace 而 pane 查回本 workspace
   即拒绝）。不同 runtime 即使 generation/state 相同也因 identity 不同被拒绝。
7. 反例回归必须能拒绝：同 generation/state 不同 identity、缺少一侧 attachment、
   scope/会话不匹配、订阅（任一端）查看中已结束、桌面断开后重订阅、桌面仅在查看中订阅、
   两端 attachment/连接/订阅关系复用、
   查询不可用、缺 artifact、E2E gate 未启用、seq 非单调、窗口快照自相矛盾，以及
   旧「两侧赋同一 sharedInstanceKey」代填（无 Host 记录支撑即拒绝）。
8. Host 记录文件行序与 seq 单调一致（单一写链合同）；不一致判观察不可靠。
9. 验收 artifact 必须结构化保存：查看前/中/后三段 pane 查询读数、Host 记录全文、
   窗口 seq 边界与判定结论（`wt04-direct-association-evidence.json`），不只留一行
   「判定通过」。

## 验收入口

- 工程回归：`packages/desktop/test/directAttachmentAssociation.test.ts`（判定合同反例 +
  probe 启用矩阵 + ACK 先行/落盘顺序 + 记录解析）；
  `packages/ui/test/paneRuntimeIdentityE2EGate.test.ts`（pane 诊断装配矩阵，生产关闭态单列）。
- E2E：`packages/desktop/test/e2e/git/worktrees/manual-review/pending/git-worktree-remote-view.test.ts`
  （manual-review/pending，显式 fixture 候选运行；runId 与两端查询、Host artifact 记录在案）。
