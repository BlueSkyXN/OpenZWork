> **Todo103 / G09：保留为历史审计，不是当前重构契约。** 本文来自 staging 提交
> `846b31c21b`，下文的“当前”均指 `baffd62dcf`。代码链接/行号也只对应该基线；
> 查证旧文件请用 `git show baffd62dcf:<仓库相对路径>`，不能把当前分支的同名文件
> 当成原证据。旧 model-provider / preset / family 路径已由当前 Account、Provider
> Runtime 和 Model Selection 边界替代，不据本文恢复旧接口。G09 的 401 修复见
> [当前契约](../oauth/jwt-401-auto-logout.md)，包括队列内凭据复核及 accountIdentity 清理。
> 本文列举的 CLI、MCP、加密、跨进程事务等既有问题不因合并自动转成修复任务。
> 单连接过渡态及 Todo101 延期裁决不变。以下原审计内容和验证记录原样保留，
> 不计作 Todo103 当前代码验证通过。

# credentials.json 凭据与生命周期代码梳理

审计日期：2026-09-08。代码基线：`baffd62dcf7e5762b24bee9d0003128793101a11`（`origin/staging`）。

本文记录该基线的代码事实，供后续检查和修复使用；不代表文中问题已经修复。示例和运行验证均使用合成凭据，不包含真实 token、用户资料或解密后的本机数据。文内源码链接从 `docs/analysis/` 出发，行号对应上述基线。

阅读顺序：存储与权限边界 → OAuth 字段及消费者 → CLI/MCP 生命周期 → Bot/远端/relay → [审计结论与验证记录](#审计结论与验证记录)。

## 范围与已对齐规则



据此，删除旧 JWT 本身不是问题。检查点是旧登录是否清理完整、新凭据是否来自同一次登录、退出后是否还有 active provider 或登录凭据残留。取消流程也不能未经确认就按“恢复旧 JWT”修复。

```text
当前平台会话
    |
    +-- 新登录完成 --> 清理旧登录凭据 --> 当前平台的新会话
    |
    +-- 退出登录 --------------------> 无 App active provider / 登录凭据

其它凭据域：MCP 授权 / Bot / 远端连接 / relay 设备认证
    `-- 各自具有更新、失效与删除流程；当前 App logout 不清空整个文件
```

单平台规则作用于 App 登录身份。MCP、Bot、SSH、relay 凭据也保存在同一个文件中，但当前代码没有把它们纳入 App 登录切换的全量删除范围。是否新增账号绑定清理策略是另外的设计决策。

## 存储实现与访问边界

### 文件位置

| 入口                   | 路径规则                                                                                                                              | 代码依据                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Desktop / Node service | `{dataBaseDir}/.openzwork/v2/credentials.json`                                                                                            | [credentialService.ts](../../packages/services/src/credential/credentialService.ts#L27)             |
| service 的 dataBaseDir | `setDataBaseDir()` 覆盖值 > 模块初始化时读取的 `ZCODE_DATA_BASE_DIR` > `HOME` > `os.homedir()`；前三项去除首尾空白                    | [paths.ts](../../packages/services/src/paths.ts#L57)                                                |
| CLI / MCP shared store | 显式 `filePath` 优先；否则 `{baseDir ?? env.ZCODE_DATA_BASE_DIR ?? os.homedir()}/.zcode/v2/credentials.json`；支持 `~`、`~/` 和绝对化 | [shared-credentials.ts](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L257) |

因此“共用文件”的前提是两端解析出的数据目录相同。CLI 不调用 App 的 `setDataBaseDir()`，空白路径的处理也不完全相同；不能仅凭文件名推断所有进程使用同一文件。

### 访问者与真正的持久化位置

```text
Desktop renderer
    `-- hook / RPC --> ICredentialService（Host） --------+
Desktop main 的 relay / telemetry service --------------+--> 本机凭据文件
CLI login / MCP --> SharedZCodeCredentialStore -----------+
                         （解析到同一路径时共用）

SSH / WSL / Docker workspace
    `-- 本机 OAuth / credential service --------------------> 本机凭据文件

Server remote
    `-- connectionServices.credentialService RPC -----------> Server 的凭据文件

浏览器自身 OAuth
    `-- BrowserOAuthCredentialRepo --------------------------> localStorage
        pending nonce --------------------------------------> sessionStorage
```

- `ICredentialService` 公开 `load/save/delete`；UI 使用 `useCredentials()` 等 hook。泛用存储层不理解 OAuth provider、账号或 workspace，只接受 key/value。[接口](../../packages/services/src/credential/credential.ts#L11)、[hook](../../packages/ui/src/hooks/useCredentials.ts#L8)。
- 本地服务在 `createLocalServices` 中创建并注册 credential service；Desktop main 还为 relay 和 telemetry 创建同种文件服务，因此不能将其描述成只有一个 Host 实例访问文件。[services/node.ts](../../packages/services/src/node.ts#L1213)、[main/index.ts](../../packages/desktop/src/main/index.ts#L675)。
- SSH/WSL/Docker workspace 服务集合显式创建本机 credential/OAuth service；Server remote 则转接连接目标的服务。这是两个不同的归属边界。[remoteWorkspaceServiceCollection.ts](../../packages/desktop/src/host/remoteWorkspaceServiceCollection.ts#L83)、[Server 分支](../../packages/desktop/src/host/remoteWorkspaceServiceCollection.ts#L315)。
- 本文不改变桌面 continuous 或手机 replayable 的消息恢复边界；凭据归属不能据此推导为另建手机 Agent/runtime。

### 文件格式、加密和兼容

顶层是 `Record<string, string>`。复杂值先序列化为 JSON 字符串，再对整个 value 加密；键名仍以明文保存。文件没有顶层版本、全局账号 id 或 token 类型标签，语义由各 key 的调用方决定。

```text
业务值 / JSON 字符串
    --> AES-256-GCM
    --> "enc:v1:<base64url(iv)>.<base64url(authTag)>.<base64url(cipherText)>"
    --> credentials.json[key]
```

| 项目             | 当前行为                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 算法             | AES-256-GCM；12-byte 随机 IV，16-byte auth tag                                                                          |
| 密钥             | `SHA-256(secret)`；优先 `ZCODE_CREDENTIAL_SECRET`，否则使用 `zcode-credential-fallback:<platform>:<homedir>:<username>` |
| Desktop/CLI 差异 | Desktop 原样使用非空环境变量；CLI 先 `trim()`，只含空白时回退默认值                                                     |
| 旧明文           | 不以 `enc:v1:` 开头的值直接返回，不会因一次读取自动重新加密                                                             |
| 普通读取         | key 不存在返回 `null`；文件不存在视为空对象                                                                             |
| 损坏文件         | JSON/schema 非法时保留按内容 hash 命名的 `.corrupt-<hash>.bak`，再抛错；禁止按空对象覆盖                                |
| 解密失败         | Desktop 抛结构化 credential decrypt error；CLI cipher 抛普通 `Error`。业务层决定是否清理 OAuth 会话                     |

代码依据：[Desktop cipher](../../packages/services/src/credential/providers/credentialCipherProvider.ts#L6)、[CLI cipher](../../apps/zcode-cli/packages/adapters/src/auth/credential-cipher.ts#L4)、[schema](../../packages/shared/src/validation.ts#L365)、[备份](../../packages/shared/src/node/privateFilePersistence.ts#L109)。

当前默认密钥由系统信息推导，不是操作系统钥匙串托管的随机密钥；AES-GCM 格式不等于使用了 Electron `safeStorage`。若要改变密钥来源，需要单独设计旧密文迁移，不能只替换密钥推导函数。

两端对 `ZCODE_CREDENTIAL_SECRET` 的空白处理差异已使用真实 cipher 实现和合成值验证：普通字符串互相可解密；相同的含首尾空白字符串、相同的全空白字符串都使 Desktop/CLI 互相解密失败。修复时应同时考虑已按原规则写出的历史密文，避免为了统一新写入而让旧凭据失效。

### 原子写入不等于完整登录事务

两套 store 复用同一个跨进程文件锁及原子文件替换工具：

```text
同进程写请求排队
    --> <credentials path>.lock 目录锁
    --> 读取最新文件 --> 修改所需 key
    --> 同目录 0600 临时文件 --> rename 替换 --> 释放锁
```

锁有 owner、进程存活检查、失主回收和默认 8 秒等待上限；rename 对 Windows 常见占用错误重试。损坏备份也以 `0600` 创建。同平台权限语义仍取决于文件系统，不能把 POSIX mode 等同于 Windows ACL。[privateFilePersistence.ts](../../packages/shared/src/node/privateFilePersistence.ts#L46)、[atomicFileLock.ts](../../packages/shared/src/node/atomicFileLock.ts#L177)。

| 层次                         | 已有保证                                                               | 保证范围之外                                                         |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Desktop `save/delete`        | 一次 key 变更覆盖完整 read-modify-write，不丢掉其它进程的独立 key 更新 | 一个登录内多个 `save/delete` 不是一笔跨进程事务                      |
| CLI `saveMany` / 登录保存    | 同一次回调内的多 key 变更一次发布                                      | 调用前网络、调用后 config 更新不在文件事务中                         |
| CLI 条件删除                 | `deleteIfValue`、`deleteManyIfValue` 在锁内比较旧值后删除              | 逐 key 的 `deleteIfValues` 不等于整组凭据条件删除                    |
| Desktop OAuth mutation queue | 串行同一个 OAuthService 实例的登录完成、退出等操作                     | 不是多个窗口、多个 Host、CLI 共享的登录级队列                        |
| 读取                         | 原子替换使读者通常看到某次完整文件；CLI `loadMany` 同次读取多个 key    | 多次独立 `load` 仍可能跨过其它进程的写入，不能自动认为是同一会话快照 |



CLI 还导出 `loadSharedZCodeCredentialSync`：同步读取中发生任何错误都返回 `undefined`，不会按异步读取路径保留损坏证据。本次检索未发现生产调用者，不能将它描述为当前所有 CLI 读取的行为。[同步兼容入口](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L234)。

### 整个文件的删除与数据目录迁移

- **Clear All Data 是全文件删除入口。** Desktop 用户确认清除全部数据后，`clearAllDataAndRelaunch` 对传入的 `credentialsDir` 执行递归删除；该目录来自当前 `getAppConfigDir()`，默认是 `~/.openzwork/v2`，也可跟随自定义数据目录。操作会一起移除该目录中的 App OAuth、MCP、Bot、远端连接、relay 等凭据与配置，而非仅清 OAuth 字段；随后清浏览器存储并重启。命令还调用购买 WebView 分区清理。这与普通 App logout 的定向删除不同，也不是删除远端 Server 的数据。[清除实现](../../packages/desktop/src/main/desktopCommandHandlers.ts#L162)、[目录来源](../../packages/desktop/src/main/desktopRuntimeEnv.ts#L81)、[命令分发](../../packages/desktop/src/main/desktopCommandHandlers.ts#L763)。
- **数据目录变更会复制凭据文件。** Setting service 调用 `copyDataDirectory` 将旧 `.zcode/v2` 复制到新位置。过滤器排除 `setting.json` 及其临时兄弟文件、符号链接，没有专门排除 credentials.json，也没有对其中的值解密再加密；该 helper 是 copy，不删除原目录。因此新路径解析成功不代表旧文件副本已经销毁，跨用户/系统复制还可能因密钥材料不同而无法解密。[调用方](../../packages/services/src/setting/settingService.ts#L452)、[复制实现](../../packages/services/src/paths.ts#L587)。

### 日志与归档边界

- RPC 中间件常规成功日志只记录频道、命令和耗时，不记录 credential 请求参数或返回值；失败日志附带错误对象。[logging-middleware.ts](../../packages/rpc/src/logging-middleware.ts#L40)。
- Desktop 日志导出按文件名排除 `credentials.json` 和 `.credentials.json`；反馈 fallback 归档使用包含 `credentials.json` 的路径匹配。其它业务日志仍应逐调用方检查，不能由这两处推导为所有 token 都不会进入日志。[Desktop 导出](../../packages/desktop/src/main/exportLogs.ts#L716)、[反馈归档](../../packages/services/src/feedback/compactLogArchive.ts#L15)。

## OAuth / ZCode 平台登录凭据：代码事实

本章的“平台”指 Z.AI / BigModel 身份域，不指 macOS / Windows / Linux。

### 已确认的单平台约束与现有实现

本次梳理采用用户确认的规则：**登录清理所有旧平台 JWT，登录完成后只允许一个平台身份生效。** 旧平台 JWT 不作为并存账号保留。用户尚未明确清理应发生在点击登录时，还是 ready/token 交换完成后的提交时；取消或失败时的旧会话处理也需随该提交边界明确，不能自行把“登录清旧”解释成“点击登录立即登出”。OAuth 清理范围与 SSH、bot、远控配对等独立凭据的生命周期分开定义。

现有源码已经把 `oauth:active_provider` 注释为“互斥 provider 域的唯一事实源”，成功落盘前也会清理相反平台；清理发生在完成 token 交换后的 `persistOAuthSession`，发起登录本身只替换 pending flow，取消落盘时还有恢复旧会话的 rollback。这些是当前时序事实；pending 阶段保留旧会话本身不能直接判为违反用户规则。正常成功路径会清理相反平台的命名空间字段，但不会清理 legacy `auth_token/refresh_token`，所以不能据此声称“全部旧平台凭据已经清空”。

依据：[oauthCredentialRepo.ts:172](../../packages/services/src/oauth/repo/oauthCredentialRepo.ts#L172)；[oauthService.ts:374](../../packages/services/src/oauth/oauthService.ts#L374)、`:554`、`:791`。

```text
目标身份关系
  未登录
    -> 发起平台 P 登录
    -> 在明确的登录提交边界清理全部旧平台登录 JWT
       （点击时或 ready 提交时：尚未决定）
    -> P 登录完成：只保存 P 的平台业务 token + 当前 ZCode JWT
    -> oauth:active_provider = P

  任一时刻：Z.AI 身份 XOR BigModel 身份
  禁止：P 的 active provider + 另一平台的业务 JWT + 上一代 ZCode JWT

当前代码的成功路径
  startOAuth / startOAuthWithPolling
    -> 只创建或替换 pending flow，旧落盘会话仍可存在
    -> deep link 或 polling 取得新 token
    -> persistOAuthSession
       -> 暂存旧两域 token / profile / active provider（供 rollback）
       -> clearProvider(相反平台)：业务 token、refresh token、user_info、共享 JWT
       -> saveTokenSet(当前平台)：业务 token、可选 refresh token、新共享 JWT
       -> saveUserProfile(当前平台)
       -> saveActiveProvider(当前平台)
```

### credentials.json 中的字段

字段值通过 `ICredentialService` 保存为字符串；用户资料和归因先 JSON 序列化。凭据文件的加密、密钥、权限、锁及路径由存储章节说明。OAuth provider 类型允许扩展字符串，但当前内置域是 `zai`、`bigmodel`；已知损坏清理集合总是包含这两者，并可加入注册的其它 adapter ID。

依据：[oauth.ts:56](../../packages/shared/src/oauth.ts#L56)、`:132`；[oauthCredentialRepo.ts:13](../../packages/services/src/oauth/repo/oauthCredentialRepo.ts#L13)、`:36`。

| key                            | 实际语义 / 数据来源                                                                          | 正常写入                                                                | 正常读取 / 清理                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth:active_provider`        | 当前 App 平台身份，内置值为 `zai` / `bigmodel`；不是 token                                   | 登录最后一步写入；由 `saveActiveProvider` 管理                          | 决定缓存恢复、模型/官方 MCP/空闲套餐使用哪个平台；active logout、all logout、损坏恢复删除                                                                                                                 |
| `oauth:login_attribution`      | JSON：`channel_id`、`utm_source`、`utm_campaign`；不是 token                                 | 归因回调 / 带归因授权回调写入；只保存非空字符串                         | 读时只接受这三个字段，兼容旧 `{params, expiresAt}`；当前无 TTL，logout 不清理；无法解析或有效字段为空则删除                                                                                               |
| `auth_token`                   | 旧 BigModel access token key                                                                 | 当前 OAuth 正常登录不写；只保留历史兼容读取                             | `BigModelProviderAdapter.loadLegacyTokenSet` 与 `useAuthToken.getToken` 读取；`restoreSession` 回填命名空间 key；当前 OAuth logout / corrupt 清理不删除，`useAuthToken.clearToken` 对 BigModel 会特殊删除 |
| `refresh_token`                | 旧 BigModel refresh token key                                                                | 当前正常 OAuth 登录不写                                                 | BigModel legacy loader 兼容读取；正常 OAuth 清理及 useAuthToken.clearToken 都不删除它；不是当前命名空间字段的别名写入                                                                                     |







### 三种凭据不能混用

2. **平台业务 token / MaaS JWT**：`oauth:<platform>:access_token`，标识对应平台的业务登录身份，用于业务接口和套餐身份校验。








依据：[modelProviderServiceStorage.ts:93](../../packages/services/src/model-provider/modelProviderServiceStorage.ts#L93)、`:942`、`:1137`；[oauthPresetProviderRepo.ts:535](../../packages/services/src/model-provider/repo/oauthPresetProviderRepo.ts#L535)。






### 主要消费者和真实认证头

| 消费场景                                        | 使用的凭据                                                               | 真实头 / 边界                                                                                                                                             | 代码依据                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo snapshot 上传                              | 当前 active tokenSet；优先 ZCode JWT，当前代码缺失时回退平台 accessToken | 最终 `Authorization: Bearer <token>`；这是现存 fallback，是否允许须依据后端契约判断，不能仅凭 token 类型不同直接定为 bug                                  | [node.ts:1288](../../packages/services/src/node.ts#L1288)；[repoSnapshotUploadClient.ts:117](../../packages/services/src/repo-snapshot/repoSnapshotUploadClient.ts#L117)                                                                                                                |




### Renderer 读取入口、购买鉴权与 WebView 副本



依据：[useCredentials.ts:28](../../packages/ui/src/hooks/useCredentials.ts#L28)；[index.ts:43](../../packages/ui/src/hooks/index.ts#L43)；[index.ts:70](../../packages/ui/src/index.ts#L70)。



依据：[codingPlanPurchaseAuth.ts:25](../../packages/ui/src/settings/model-provider-section/codingPlanPurchaseAuth.ts#L25)；[ModelProviderSection.tsx:648](../../packages/ui/src/settings/ModelProviderSection.tsx#L648)。






**legacy 清理的边界必须单列。** 当前正常 login 切换、`clearProvider`、OAuth logout、corrupt 恢复不删除磁盘旧 `auth_token/refresh_token`；只有 `useAuthToken.clearToken` 对 BigModel 的特殊逻辑会删除 `auth_token`，仍不删除旧 `refresh_token`。WebView 的三 key 清理也不是磁盘 legacy 清理。用户要求“清所有旧 JWT”时，应核定这些历史兼容字段的清理策略；不能只看到命名空间切换正确就宣称 legacy 已全清。

依据：[oauthCredentialRepo.ts:415](../../packages/services/src/oauth/repo/oauthCredentialRepo.ts#L415)、`:432`；[bigmodelProviderAdapter.ts:274](../../packages/services/src/oauth/providers/bigmodelProviderAdapter.ts#L274)；[useCredentials.ts:63](../../packages/ui/src/hooks/useCredentials.ts#L63)；[codingPlanEmbeddedWebview.ts:257](../../packages/ui/src/settings/model-provider-section/codingPlanEmbeddedWebview.ts#L257)。

### 有效期、刷新、401 和损坏恢复

**有效期。** 共享 `resolveJwtExpiration` 只解码 JWT 的 `exp`，不验证签名；默认提前 30 秒视为过期。缺 `exp`、格式异常等返回 `unknown`，继续交服务端判断。Desktop cached restore 读 active provider、user_info、共享 JWT；明确过期则在 mutation queue 中重新比对 generation/provider/profile/JWT，清当前登录和派生 provider，返回 `reauthentication-required: jwt-expired`。ZAI 缺 JWT 返回 signed-out；BigModel 当前未设置同样的缺 JWT 门槛，仍可从 user_info 恢复 authenticated。

依据：[oauth.ts:164](../../packages/shared/src/oauth.ts#L164)；[oauthService.ts:177](../../packages/services/src/oauth/oauthService.ts#L177)、`:253`、`:266`。



依据：[oauthService.ts:913](../../packages/services/src/oauth/oauthService.ts#L913)；[providerAdapter.ts:31](../../packages/services/src/oauth/providers/providerAdapter.ts#L31)；[zaiBusinessTokenResolver.ts:4](../../packages/services/src/providers/zaiBusinessTokenResolver.ts#L4)、`:44`、`:99`。



`restoreSession` 是另一条主动联网校验路径：调用 provider userinfo；错误文本匹配 401/403/unauthorized/forbidden 时 logout，其它错误继续抛出。

依据：[nodeApiClient.ts:134](../../packages/services/src/providers/api/nodeApiClient.ts#L134)；[node.ts:1226](../../packages/services/src/node.ts#L1226)、`:1872`；[oauthService.ts:518](../../packages/services/src/oauth/oauthService.ts#L518)、`:1061`。

**解密损坏。** OAuthCredentialRepo 在 active provider、tokenSet、user_info 读取时捕获稳定 `CredentialDecryptError`：清两内置平台及其它注册平台的 access/refresh/user_info、共享 JWT、active provider，再通知清理派生模型 key；派生清理异常只记录 warn。该路径不删除 SSH、bot 等非 OAuth key，也不删除旧 `auth_token/refresh_token`、归因 key。model-provider 的 OAuth-aware 包装读取也复用此 Repo 行为。



依据：[oauthCredentialRepo.ts:159](../../packages/services/src/oauth/repo/oauthCredentialRepo.ts#L159)、`:241`、`:292`、`:346`、`:432`；[modelProviderService.ts:136](../../packages/services/src/model-provider/modelProviderService.ts#L136)；[oauthService.ts:206](../../packages/services/src/oauth/oauthService.ts#L206)。

### 注销、取消与并发边界

| 操作                         | 当前代码行为                                                                                                      | 对单平台约束的含义                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 发起普通登录                 | mutation queue 内清 pending，生成新 state；不清落盘登录                                                           | 当前以完成提交为清理时点；用户尚未决定是否提前到发起时                                     |
| 发起 polling 登录            | 增加 flow generation、替换 pending；init 异步返回时验证 generation                                                | 旧 init 不覆盖新 flow；不负责清旧落盘登录                                                  |
| deep link / polling 同时完成 | 同一 pending 共用 completionPromise；串行进入 mutation queue；交换前后和每段落盘前验证 pending 是否仍有效         | 避免重复完成、迟到登录写回；多 key IO 本身不是一次 OAuth 事务                              |
| 成功登录                     | 清相反平台命名空间及共享 JWT，再保存当前 tokenSet/profile/active provider                                         | 正常完成时有单平台意图；当前过程仍存在多次独立 IO 的中间状态                               |
| `logout()`                   | 查当前 active provider，清当前平台 access/refresh/user_info/JWT，再删 active；之后取消该平台 pending 并清派生 key | 不是扫描所有遗留平台字段的全量清理；active 缺失时不会删孤立 JWT                            |
| `logout(provider)`           | 只有参数等于 active provider 才清登录并通知派生清理；另外取消匹配 pending                                         | 非当前平台 unlink 不应误删当前共享 JWT；也不会主动扫除非当前遗留字段                       |
| `logoutAll()`                | 清所有已注册 adapters 对应平台，删除 active，取消 pending，清派生 key                                             | 范围由已注册 adapters 决定；与 Repo corrupt 清理总含两内置域不同                           |
| `cancelPending()` / timeout  | 使 pending 或 flow generation 失效；普通取消不直接清落盘旧会话                                                    | 不能把它理解为 logout；落盘中取消会进入当前 rollback，取消语义应随最终登录提交边界一起明确 |

依据：[oauthService.ts:367](../../packages/services/src/oauth/oauthService.ts#L367)、`:374`、`:431`、`:554`、`:630`、`:791`、`:948`、`:980`、`:990`；[oauthCredentialRepo.ts:284](../../packages/services/src/oauth/repo/oauthCredentialRepo.ts#L284)、`:424`。










### 当前偏差与后续检查项

以下包含已确认实现问题、当前兼容残留和需要明确的边界；不把尚未决定的清理时机列为既定 bug。本章没有修改实现。

| 项目                                                        | 证据 / 当前结果                                                                                                                                             | 归类与边界                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录清旧的提交时点和取消语义待明确                          | `oauthService.ts:554`、`:791` 只换 flow；`:390` rollback 写回旧两域会话                                                                                     | **待明确边界**。用户确认的是清旧结果和单平台身份，不是点击时立即清理；不得把另一平台 JWT 设计成正常并存登录，也不能未经确认改变取消行为                                                 |
| BigModel 缺 JWT 仍能恢复 authenticated                      | cached restore `oauthService.ts:253` 的缺 JWT 检查仅限 ZAI，`:262` 统一返回成功                                                                             | **当前两平台恢复条件不一致**。新单平台完整会话规则需要明确消除残缺态                                                                                                                    |
| 旧 BigModel `auth_token/refresh_token` 正常切平台后仍可残留 | `oauthCredentialRepo.ts:415` 不删除 legacy；`bigmodelProviderAdapter.ts:274` 仍读取；`useCredentials.ts:63` 仅特殊删除 `auth_token`                         | **静态确认的兼容残留，清理边界待核定**。正常切换合成成功只证明命名空间 key 清理，不证明 legacy 全清；用户要求清所有旧 JWT 时必须单列核对这两项，而不能扩大为删除全部 credentials.json   |
| 孤立 OAuth 字段和 adapter 清理集合不一致                    | logout 只清 active；all 清理取 adapters 列表；corrupt 清理总包含两内置平台                                                                                  | **需要明确清理集合**。active 缺失或 adapter 禁用/未注册时的遗留字段应独立覆盖                                                                                                           |
| 泛型 refresh 缺 generation / mutation queue 防护            | `oauthService.ts:936` 异步交换后 `:945` 按最新 active 保存                                                                                                  | **扩展接口隐患**。内置 adapter 当前无 refresh，不能把它描述成当前内置自动刷新串写已经在发生                                                                                             |
| `expiresAt` 未落盘，业务 JWT 无自动刷新链路                 | Repo 只保存 access/refresh/JWT；官方 MCP 注释也明确业务 JWT 无刷新链路                                                                                      | **能力边界**。当前依赖重新登录或服务端拒绝；是否新增刷新属于后续设计选择                                                                                                                |


本轮前序运行时证据只使用内存 fixture 与从当前源码加载的函数，没有读取真实 token；本章不重复运行。正式修复仍需按仓库要求先补测试/spec，覆盖登录清旧、取消/失败、两平台切换、独立 JWT 损坏、派生 key 清理以及 desktop / web 远控边界。

## CLI 与 MCP 的 credentials.json 使用情况



存储路径、加密和文件锁见前文；以下聚焦 CLI 与 MCP 的业务行为。

### CLI 应用登录字段完整清单

字段常量及 CLI 写入入口见 [shared-credentials.ts:11](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L11)、[shared-credentials.ts:215](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L215)。下表描述的是**解密后的值**。

| 完整 key                  | 值结构/语义                                                                                                      | 当前 CLI 行为                          | 状态                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `oauth:active_provider`   | provider 字符串；CLI ZAI 登录写 `zai`。是身份选择标记，不是 token                                                | 登录覆盖；logout 仅在值为 `zai` 时删除 | 当前主链路                                    |






| 完整 key                       | 解密后的值                     | 代码依据                                                                                       |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |


### CLI 登录、退出与模型 Key 的生命周期

#### ZAI CLI 登录

[loginZCodeCli](../../apps/zcode-cli/packages/bootstrap/src/auth-login.ts#L130) 的实际时序：

- 共享凭据先于业务 token 兑换和 config 更新落盘：[auth-login.ts:165](../../apps/zcode-cli/packages/bootstrap/src/auth-login.ts#L165)。
- MaaS 业务 token 在 resolver 内使用，resolver 当前只返回最终模型 API Key，不返回给 shared store：[coding-plan-api-key.ts:96](../../apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts#L96)、[coding-plan-api-key.ts:111](../../apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts#L111)。
- 模型 API Key 由 config adapter 写 config，而非凭据 store：[file-config.adapter.ts:331](../../apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts#L331)。

#### CLI logout



该 CLI logout 路径没有删除 `~/.openzwork/cli/config.json` 中的模型 API Key，也没有遍历或删除 `mcp:oauth:*`。应用账号登出、CLI 模型调用凭据、第三方 MCP 授权是当前代码中的三个不同生命周期。

### MCP OAuth 命名空间与隔离范围

只有 MCP authorization-code OAuth 使用本共享 store。当前运行期入口 `createOAuthClientProvider()` 对 HTTP/SSE authorization-code 返回 `createMcpOAuthTokenProvider()`；stdio 和官方鉴权不走此 provider；client-credentials 模式直接创建 SDK `ClientCredentialsProvider`，没有把本 store 注入给它。[mcp/index.ts:1527](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1527)。


```text
serverName
serverUrl（完整原始字符串）
config.clientId 或 ""
config.scope 或 ""
config.redirectPath 或 ""
        |
        +-- 用 "\n" 连接
        +-- SHA-256，hex 前 24 个字符
        +-- P = "mcp:oauth:" + hash
```

实际隔离范围：

- 同一凭据文件内，同 `serverName + serverUrl + clientId + scope + redirectPath` 的各 CLI/Host/session 共用 OAuth pair、refresh 锁和授权 lease。
- 改 server name/URL/scope/client ID/redirect path 会换命名空间，旧命名空间不会因为 key 变了自动删除。
- `issuer` 另存于 canonical，参与 discovery cache 一致性检查，**不参与凭据 namespace**。
- 因此当前是“共享文件 + MCP 配置授权语义”隔离，不是“workspace + 应用登录账号”隔离。是否要增加后者属于产品/架构决策，不能仅凭缺少 workspace 就定为 bug。

### MCP OAuth 全部持久化字段

以下 `P` 指上一节的 `mcp:oauth:<hash>`。所有 JSON 都是先 `JSON.stringify`，再作为一个加密字符串写入外层字典。

| 完整 key 模板                  | 解密后结构与用途                                                                                                               | 当前状态/写入来源                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `P:authorization_credentials`  | canonical 整对凭据，见下一张结构表                                                                                             | 当前主记录；交互授权/刷新成功发布                   |
| `P:client_information`         | SDK `OAuthClientInformationMixed` JSON；至少有 `client_id`，可能含 `client_secret` 和注册返回字段                              | 当前仍维护的旧 reader 镜像，不是可以直接删除的垃圾  |
| `P:tokens`                     | SDK `OAuthTokens` JSON；含 `access_token`、`token_type`，可有 `refresh_token`、`expires_in`、scope 等 SDK/服务器字段           | 当前仍维护的旧 reader 镜像                          |
| `P:discovery_state`            | 裸 SDK `OAuthDiscoveryState` JSON；当前代码读取 `authorizationServerUrl`、`authorizationServerMetadata`、`resourceMetadata` 等 | 当前 metadata 缓存，非业务 token                    |
| `P:discovery_state_fetched_at` | `String(Date.now())`，毫秒 epoch 的十进制字符串                                                                                | 当前 discovery 缓存时间戳                           |
| `P:pending_authorization`      | `{attempt_id, authorization_url, baseline_generation?, expires_at, state}` JSON                                                | 当前授权事务共享状态，不是长期 refresh/access token |
| `P:code_verifier:<state>`      | PKCE verifier 原始字符串                                                                                                       | 旧 provider 的持久化形态；当前 Phase 2 只放内存     |



`authorization_credentials` 的完整本地包装结构：

| 字段                 | 含义                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `version`            | reader 支持 1、2；当前 writer 为 2                                                                          |
| `client_information` | 与 token 同一次授权的 client 信息对象                                                                       |
| `tokens`             | 与 client 同一次授权的 token 对象                                                                           |
| `published_by`       | 授权发布者/事务标识；refresh 写 `refresh:<P>`                                                               |
| `generation?`        | 每次 publication 新生成的 16 随机字节 hex；不是 token。旧记录缺少时可用 canonical 原文 hash 派生 generation |
| `obtained_at?`       | 获取 token 的毫秒 epoch                                                                                     |
| `expires_at?`        | `obtained_at + expires_in * 1000`；服务器未返回可用 `expires_in` 时缺省                                     |
| `issuer?`            | 授权服务器 issuer/URL，用于发现元数据一致性，不改变 key                                                     |



### MCP OAuth 授权、刷新、失效与历史兼容

#### 当前主链路是两阶段

```text
Phase 1：纯 AuthProvider（运行期请求）
  token()
    +-- 读 canonical + mirrors，派生一份 pair
    +-- 未临期：交付 access token
    +-- 临期且有 refresh：进入独立 refresh 锁
    +-- 无 token：请求不带 token，401 再分类
  onUnauthorized()
    +-- 有 refresh：锁内刷新
    +-- 无 refresh：要求交互授权

Phase 2：交互授权事务
  获取按 P 隔离的 authz lease
    +-- follower：观察共享 pending/generation
    +-- leader：fresh localhost listener -> discovery -> fresh DCR/静态 client
                     -> pending URL/state -> 等回调 -> code exchange
                     -> 原子写 canonical + 两个 mirrors
                     -> 关闭 listener、按 attempt 删除 pending、释放 lease
```




#### 刷新与 token 删除



| 触发条件                                                                        | 当前处理                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `invalid_grant` 且有 canonical 原文快照                                         | 以 canonical 原文作 CAS guard，删除 canonical 与 tokens mirror，保留 client mirror；转交互授权 |
| 动态 client 的 `invalid_client` / `unauthorized_client` 且有 canonical 原文快照 | 同一个 canonical CAS guard 下删除 canonical、tokens mirror、client mirror；转交互授权          |
| 静态 client 的 `invalid_client` / `unauthorized_client`                         | 作为配置错误上报，避免不断用同一个无效 client 重新授权                                         |
| 网络/5xx/discovery 临时错误                                                     | 不当作 grant 确定失效；proactive 可继续现 token，reactive 抛临时刷新错误                       |
| legacy-only pair，没有 canonical `raw`                                          | 上述 canonical 删除 helper 不执行；仍按错误分类进入交互授权/配置错误                           |



#### metadata、pending 和锁文件

- 本轮在当前 CLI/MCP adapter、bootstrap 和 service MCP/plugin 代码中没有找到按整个 `mcp:oauth:<hash>` namespace 遍历删除的业务入口。不能声称断连、停用或移除 MCP 一定会清除全部授权材料；当前明确可见的是成功覆盖、确定失效 CAS 和 pending/verifier 清理。






### 官方 MCP 读取的 token 与实际请求承载

官方 MCP 没有单独新增一种 `official-mcp:*` credential key，也不使用第三方 MCP 的 canonical OAuth pair。来源是 Host service 按当前应用登录和模型套餐选择解析共享凭据：

Host 要求 `oauth:active_provider` 与当前 setting family 一致且有 ZCode JWT，不能跨 family 回退找另一把 MaaS token；完整套餐路径还会前后比较 MaaS JWT。缺套餐时存在 identity-only 分支，可以只带 ZCode JWT，让服务端决定权益；有套餐 provider 却缺 MaaS JWT 时返回不可用。[officialMcpCredentials.ts:216](../../packages/services/src/official-mcp/officialMcpCredentials.ts#L216)、[officialMcpCredentials.ts:283](../../packages/services/src/official-mcp/officialMcpCredentials.ts#L283)、[officialMcpCredentials.ts:330](../../packages/services/src/official-mcp/officialMcpCredentials.ts#L330)。

| Header                     | 来源                                                | 何时发送                                                       |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `Bigmodel-Target-Type`     | `PERSONAL` / `TEAM`                                 | wire scope 存在时                                              |
| `Bigmodel-Organization`    | 选中 Team 连接的 organization ID                    | TEAM scope 且组织/项目能成对确定时                             |
| `Bigmodel-Project`         | 选中 Team 连接的 project ID                         | 同上                                                           |

常量与构造：[official-mcp-auth.ts:22](../../packages/shared/src/official-mcp-auth.ts#L22)、[officialMcpCredentials.ts:382](../../packages/services/src/official-mcp/officialMcpCredentials.ts#L382)。`X-Coding-Plan-Api-Key` 是旧服务端兼容通道，当前客户端不再发，且仍禁止插件用静态 headers 注入：[official-mcp-auth.ts:41](../../packages/shared/src/official-mcp-auth.ts#L41)。

HTTP adapter 每次请求重新走 auth port；endpoint/origin 不可信时不解析凭据、不发网络请求。**身份解析失败与不可信 origin 是不同分支**：当前 HTTP 实现对前者发匿名请求，让服务端权威裁定，不使用旧 token；已有身份请求遇 401 最多重取身份再试一次，这不是 OAuth refresh token 兑换，也不删除 credentials。403/重定向分别分类失败。[official-auth.ts:115](../../apps/zcode-cli/packages/adapters/src/mcp/official-auth.ts#L115)、[official-auth.ts:155](../../apps/zcode-cli/packages/adapters/src/mcp/official-auth.ts#L155)、[official-auth.ts:296](../../apps/zcode-cli/packages/adapters/src/mcp/official-auth.ts#L296)。

stdio 官方 MCP 每个出站协议消息通过 `requestMetaProvider` 注入同名 namespace；普通第三方 stdio MCP 不注入。缺 auth port 时显式给 `{ok:false, reason:"official_auth_unavailable"}`，不会通过 env 或 credentials 文件另找兜底身份。[mcp/index.ts:568](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L568)、[mcp/index.ts:599](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L599)、[mcp/index.ts:1428](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1428)。

Standalone CLI 不因为本地有 credentials 文件就自动构造官方 MCP 身份头；协议 auth port 需要 Host 上下文和 workspace 才能请求 service resolver。[official-mcp-auth-port.ts:48](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/official-mcp-auth-port.ts#L48)。

### 相关秘密中哪些不由这条路径写入 credentials.json

| 秘密/字段                                                           | 当前保存或传递位置                                                                                            | 依据与边界                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI 最终模型 API Key                                                | `~/.openzwork/cli/config.json` 的 provider 配置                                                                   | [file-config.adapter.ts:331](../../apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts#L331)；桌面 provider 存储另见总文档，不把 CLI 规则泛化到桌面                                                                                                                                           |
| 模型环境变量 API Key                                                | 运行期读取 provider `apiKeyEnv` 或默认 env 名                                                                 | [registry.ts:493](../../apps/zcode-cli/packages/adapters/src/model/registry.ts#L493)；优先显式 provider `apiKey`，无 shared credential fallback                                                                                                                                                              |
| app-server 模型 `session-secret`                                    | 按 `workspace.workspaceKey` 隔离的 `catalog.secrets` 内存 Map，key 形如 `model-provider:<providerId>:api-key` | [workspace-model-catalog.ts:1275](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-catalog.ts#L1275)、[workspace-model-catalog.ts:1446](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-catalog.ts#L1446)；这个像 credential key 的名字不是本文件的 key |
| app-server 模型 `env` secret reference                              | 保留 env 引用，解析时从传入 env 读取                                                                          | [workspace-model-catalog.ts:1523](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-catalog.ts#L1523)                                                                                                                                                                               |
| CLI BigModel setup 中间 access token                                | 回调兑换之后的内存变量，用来取最终模型 API Key                                                                | [auth-login.ts:254](../../apps/zcode-cli/packages/bootstrap/src/auth-login.ts#L254)                                                                                                                                                                                                                          |
| MCP client-credentials 配置 `clientId/clientSecret`                 | MCP 配置对象传给 SDK `ClientCredentialsProvider`                                                              | [mcp/index.ts:1547](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1547)；本分支不注入 shared store，不能声称写了 `P:tokens`                                                                                                                                                                       |
| MCP 静态 headers / stdio env                                        | MCP 配置/进程启动环境直接传递                                                                                 | [mcp/index.ts:1423](../../apps/zcode-cli/packages/adapters/src/mcp/index.ts#L1423)；不是从 shared store 自动展开的凭据                                                                                                                                                                                       |
| `ZCODE_CREDENTIAL_SECRET`                                           | 环境中的本地加密 key material                                                                                 | [credential-cipher.ts:87](../../apps/zcode-cli/packages/adapters/src/auth/credential-cipher.ts#L87)；不是业务 JWT                                                                                                                                                                                            |

模型 registry 替换会清旧 `model-provider:*` 内存 secrets，移除 provider 会删对应 secret：[workspace-model-catalog.ts:245](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-catalog.ts#L245)、[workspace-model-catalog.ts:370](../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-catalog.ts#L370)。这不等于修改 credentials 文件。

### 本轮已验证的 CLI 三个问题

#### CLI-1：同一 ZAI access key 的 token 类型分裂



本轮合成 harness 执行真实 CLI login、OAuth adapter、API Key resolver、加密存储和锁，注入合成 HTTP 响应，最终 config writer 为仅记录参数的 stub；结果：业务请求使用 MaaS JWT=true，shared store 存原始 OAuth token=true，shared store 存 MaaS JWT=false，最终模型 API Key 配置成功=true。未进行真实网络登录。



#### CLI-2：成功登录未整体替换旧平台会话

`saveZaiLoginCredentials()` 只覆盖四个 key，不清 BigModel access/refresh/user，也不清旧 ZAI refresh。按用户“仅允许一个平台登录、清旧 JWT”的契约，这是成功发布后的直接不一致，不能只把 active marker 换成 zai 就认为清理完成。[shared-credentials.ts:215](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L215)。

#### CLI-3：从 BigModel 当前会话执行 CLI logout 只清一半

`clearZaiLoginCredentials()` 无条件删共享 ZCode JWT，保留 active=bigmodel 与全部 BigModel namespace。问题是**全局单一会话没有完整退出**；按用户最新规则，不能将修复建议写成“保留另一个平台登录”。[shared-credentials.ts:70](../../apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts#L70)。

CLI-2/3 已使用两个独立临时文件、真实共享存储源码与真实加密/锁执行。只输出 active provider 与 key 存在性：

| key / marker                   | BigModel -> CLI ZAI 登录发布后 | BigModel -> CLI logout 后 |
| ------------------------------ | ------------------------------ | ------------------------- |
| `oauth:active_provider`        | `zai`                          | `bigmodel` 残留           |


**确定问题与待决时机分开：** 成功发布必须保证单一平台凭据集合一致、登出必须完整清除当前应用会话，已经能由规则和运行结果确认。“点击开始登录就先退出旧会话”“用户取消是否仍保持退出”“API Key/config 更新失败是否回滚应用登录”则是清理时机和事务边界，不能从单平台规则独自推导。本轮不擅自确定这些行为，也不将第三方 MCP OAuth 和独立模型 Key 纳入应用登录 JWT 清理集合。

## Bot、远端连接与 Relay 凭据

表中 value 均指解密后的业务值。ICredentialService 是通用字典，本节列出当前生产者定义的键族，不是限制历史文件内容的白名单。

### Bot 凭据：同一键，按 provider 解释内容

| 键规则                                                   | 解密后的内容                                 | 来源                                                             | 主要消费者                                                              |
| -------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `bot:<botId>:credential`，provider=`telegram`            | Telegram Bot token                           | 用户在 Bot 凭据输入框提交的 token；通常来自 BotFather            | Telegram `getMe`、菜单同步、消息发送、长轮询                            |
| `bot:<botId>:credential`，provider=`feishu` / `lark`     | 飞书/Lark 应用 app secret，不是 access token | 手填，或扫码注册结果的 `client_secret`                           | app secret 换 `tenant_access_token`、飞书 WebSocket 与应用 API          |
| `bot:<botId>:credential`，provider=`weixin`              | Weixin iLink Bot token                       | 扫码登录响应 `bot_token`，兼容字段 `token`；通用服务也接收手填值 | iLink 请求的 `Authorization: Bearer ...` 及轮询                         |
| `bot:<botId>:webhook-secret`，provider=`webhook`         | 自定义 webhook shared secret                 | `saveBot({ webhookSecretValue })` 的调用方提供                   | 入站 callback 比较；出站使用自定义 header 名，默认 `x-zcode-bot-secret` |
| `bot:<botId>:webhook-secret`，provider=`feishu` / `lark` | 事件回调 verification token                  | `saveBot({ webhookSecretValue })` 的调用方提供                   | 与 payload 顶层 `token` 或 `header.token` 比较                          |

键由 [config.ts:70](../../packages/services/src/bots/config.ts#L70)、`:74` 生成。`botId` 在 `saveBot` 中 trim，键没有 workspace 或用户 OAuth provider 维度；每个 Bot 以其 ID 隔离。`BotConfig` 保存 `credentialRef` / `webhookSecretRef`，真实值另存凭据仓库。当前 service 接受已有任意 ref，读取与删除遵从 ref 本身，不能仅凭非标准键名判断记录无用（[bots.ts:96](../../packages/shared/src/bots.ts#L96)、[botsService.ts:6127](../../packages/services/src/bots/botsService.ts#L6127)、`:6221`）。

来源与使用的源码证据：

- 通用 UI 保存：[BotsDialog.tsx:347](../../packages/ui/src/BotsDialog.tsx#L347)；手填提交：`:816`。扫码完成后共用同一保存入口，飞书 `appSecret` 在 `:438` / `:445`，微信 `botToken` 在 `:564` / `:572`。
- 飞书注册将 `pollResponse.client_secret` 返回为 `appSecret`：[feishuAppRegistration.ts:164](../../packages/services/src/bots/providers/feishuAppRegistration.ts#L164)。微信从响应读取 `bot_token` / `token`：[weixinRegistration.ts:167](../../packages/services/src/bots/providers/weixinRegistration.ts#L167)。
- Telegram 读取 ref 并放入 `https://api.telegram.org/bot${token}/getMe`：[telegramProvider.ts:323](../../packages/services/src/bots/providers/telegramProvider.ts#L323)、`:327`。
- 飞书 app secret 换 tenant access token：[feishuProvider.ts:1093](../../packages/services/src/bots/providers/feishuProvider.ts#L1093)。换得的 token 放在模块内 `accessTokenCache`，并非新的 `credentials.json` 键（`:1105`、`:1130`）。
- 微信读取及 Authorization header：[weixinProvider.ts:97](../../packages/services/src/bots/providers/weixinProvider.ts#L97)、`:105`。
- Webhook/飞书 callback 校验：[botsService.ts:3273](../../packages/services/src/bots/botsService.ts#L3273)、`:3284`。Webhook 出站 header：[webhookProvider.ts:211](../../packages/services/src/bots/providers/webhookProvider.ts#L211)。
- 当前 `BotsDialog` 的 `saveBot` 包装仅传 `credentialValue`（[BotsDialog.tsx:347](../../packages/ui/src/BotsDialog.tsx#L347)）；`webhookSecretValue` 是服务 API 支持项，不应写成当前所有 Bot UI 都提供此字段编辑。

```text
用户手填 / 扫码注册返回 secret
            |
            v
BotsDialog -> IBotsService.saveBot
            |
            +-> credentialValue / webhookSecretValue 非空 -> trim
            |      -> credentialService.save(固定 bot key, secret)
            |      -> BotConfig 只保存 ref
            |
            +-> resolveName -> normalize -> validate -> repo.writeConfig
                   -> 刷新 provider runtime

provider runtime / provider adapter
    -> 按 BotConfig.ref 调 credentialService.load
    -> 解密值用于第三方鉴权
```

更新与回收：

1. `saveBot` 对非空新值覆盖同一个 bot 键；没有非空新值时不写入，保留的是调用方传来的 BotConfig/ref。写 secret、解析名称、校验及写配置的顺序见 [botsService.ts:6127](../../packages/services/src/bots/botsService.ts#L6127)、`:6140`、`:6171`、`:6174`。
2. 保存后会刷新 Telegram、Weixin、Feishu runtime；runtime 指纹纳入 ref 对应的实际凭据，因此同一个 ref 下换值也可识别（[botsService.ts:6175](../../packages/services/src/bots/botsService.ts#L6175)；`telegramChannelRuntime.ts:64`、`weixinChannelRuntime.ts:46`、`feishuChannelRuntime.ts:51`，均位于同目录）。
3. `removeBotSecret` 停止相关运行时、去掉两个 ref 和绑定身份、清 state，再删 ref 指向的凭据；Bot 本体保留，供重新绑定（[botsService.ts:6183](../../packages/services/src/bots/botsService.ts#L6183)、`:6199`、`:6221`）。
4. `deleteBot` 删除配置和 state，并删除两个 ref 指向的凭据（[botsService.ts:6229](../../packages/services/src/bots/botsService.ts#L6229)）。普通禁用未走这两个删除入口，因此不等同于撤销/删除凭据。
5. `saveConfig` 直接替换规范化 Bot 配置并刷新 runtime，没有扫描被移除 Bot 的凭据做差异回收（[botsService.ts:6099](../../packages/services/src/bots/botsService.ts#L6099)）。目前未见遍历 `bot:*` 的通用孤儿凭据 GC。清理依赖调用专用删除入口和保留 ref。
6. Bot 主凭据本身没有 expiresAt/refresh token 结构；失效后重新提供值或重新扫码。飞书短期 tenant token 的缓存/重新换取属于 provider 内存层，不应计入持久化键清单。

### 远端连接凭据：以 workspace identity 隔离

| 键规则                                                   | 值                                         | 关联配置字段                               |
| -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `remote-workspace:<workspaceKey>:password`               | SSH 密码，保留原始值，不做 trim            | `target.passwordCredentialKey`             |
| `remote-workspace:<workspaceKey>:private-key-passphrase` | SSH 私钥口令，保留原始值                   | `target.privateKeyPassphraseCredentialKey` |
| `remote-workspace:<workspaceKey>:server-token`           | 连接完整 ZCode Server 的 token，保留原始值 | `target.tokenCredentialKey`                |

构造函数见 [remoteWorkspaceHistory.ts:30](../../packages/ui/src/lib/remoteWorkspaceHistory.ts#L30)、`:34`、`:38`。`workspaceKey = resolvedWorkspaceIdentity?.trim() || workspacePath`（`:402`）；连接 identity 由统一 `buildRemoteWorkspaceIdentity` 派生（`:202`），SSH 包含 host、port、username、workspace path，WSL 含 distro/可选 user，Docker 含 container，Server 复用 `buildServerRemoteWorkspaceIdentity`。WSL/Docker 当前无上述密码/token键。

来源是连接/重连提交的 `RemoteTarget.password`、`privateKeyPassphrase`、`token`。`createRemoteTargetSnapshot` 将这些明文转换为 ref，只把非敏感连接参数和 ref 放入持久化历史（[remoteWorkspaceHistory.ts:237](../../packages/ui/src/lib/remoteWorkspaceHistory.ts#L237)）。已有同类 snapshot 的 ref 会被复用，所以早期或自定义 ref 也可能继续有效；不能强制假定历史中所有 ref 都能重新按当前公式算出。

```text
连接输入 RemoteTarget（密码 / passphrase / server token）
   -> buildRemoteWorkspaceSessionMutation
      +-> snapshot（host/path/identity + credential refs）
      +-> credentialsToSave
      +-> credentialKeysToDelete
   -> commitRemoteWorkspaceSessionMutation
      -> 尝试删旧键 -> 写新键 -> 更新 lastWorkspaceSession

恢复/重连
   -> lastWorkspaceSession.target 中的 ref
   -> credentialService.load
   -> createRemoteTargetFromSnapshot
   -> connectRemoteWorkspaceTarget
```

读取与回收：

- UI 恢复 SSH 密码、私钥口令以及 Server token：[reconnectRemoteWorkspaceHistoryEntry.ts:121](../../packages/ui/src/root/reconnectRemoteWorkspaceHistoryEntry.ts#L121)、`:132`；重建 target 后调用连接入口（`:136`）。Bot 对远端 SSH workspace 的恢复也按 settings 历史中的 ref 读取，见 [botRemoteWorkspaceBridge.ts:115](../../packages/services/src/bots/botRemoteWorkspaceBridge.ts#L115)、`:141`；该 helper 的显式凭据重建分支当前只覆盖 SSH。
- 变更时，旧 snapshot 中不再使用的 ref 加入删除列表；超过 20 条历史上限淘汰的条目，其 ref 也加入删除列表（[remoteWorkspaceHistory.ts:13](../../packages/ui/src/lib/remoteWorkspaceHistory.ts#L13)、`:344`、`:429`、`:440`）。保存值见 `:451`。
- 具体落库入口先尝试删除，再写新值，最后保存 settings；删除失败记 warn 后继续，写入失败则抛出（[useRemoteWorkspaceHistory.ts:746](../../packages/ui/src/root/useRemoteWorkspaceHistory.ts#L746)）。这是多次单键操作加一次 settings 写入，不是跨文件事务。
- 显式移除远端 workspace/tab 时，先保存移除后的历史，再删除引用的凭据，失败记录 warn（[useRemoteWorkspaceHistory.ts:1358](../../packages/ui/src/root/useRemoteWorkspaceHistory.ts#L1358)、`:1382`、`:1397`）。普通断线/临时 bridge 分离不等于移除历史，不会据此自动删除凭据。
- 没有独立远端凭据过期/刷新协议，更新发生在新的连接输入保存时；没有扫描所有 `remote-workspace:*` 的通用 GC。

### 外部 Relay 配对凭据

唯一固定键：`web-remote-control:external-relay:pass_hash`（[webRemoteControlRelayAuthStorageProvider.ts:4](../../packages/desktop/src/main/webRemoteControlRelayAuthStorageProvider.ts#L4)）。值是 `passHash` 字符串，虽然名为 hash，但它用于生成认证证明，是认证材料。`deviceSid` 是配套非敏感身份，保存在 settings 的 `webRemoteControlExternalRelayDevice.deviceSid`，不是另一个 credential 键。

来源：首次注册产生 24 字节随机 password，将其 SHA-256 后以 base64 编码为 passHash；认证证明为 `HMAC-SHA256(passHash, nonce|role|deviceSid)`，base64url 输出（[webRemoteControlRelayAuthProvider.ts:15](../../packages/desktop/src/main/webRemoteControlRelayAuthProvider.ts#L15)）。随机原始 password 不另存 credentials.json。

```text
Main manager.start
   -> authStorage.load
       +-> 已有完整 {deviceSid, passHash}: persisted auth
       +-> 缺失: 随机 password -> passHash -> relay 注册
   -> transport ready + registeredAuth
   -> settings 写 deviceSid
   -> credentialService 写 passHash

relay challenge -> 用 passHash 生成 proof
invalid persisted auth / resetPairing
   -> 清 settings deviceSid + 删 pass_hash
   -> 下次 start 重新注册
```

调用链与生命周期：

- Main 注入 credential/settings service：[index.ts:931](../../packages/desktop/src/main/index.ts#L931)。启动读取并选择 persisted/register：[webRemoteControlManager.ts:1327](../../packages/desktop/src/main/webRemoteControlManager.ts#L1327)；新注册成功 ready 后保存：`:1446`。
- `load` 同时读取 settings/deviceSid 与 credential/passHash；两者都缺失返回 undefined，只有一边存在时先 clear 再返回 undefined（[webRemoteControlRelayAuthStorageProvider.ts:54](../../packages/desktop/src/main/webRemoteControlRelayAuthStorageProvider.ts#L54)）。
- `save` 先 patch settings 再写 passHash（同文件 `:80`）；`clear` 先清 settings 再删 passHash（`:44`）；公开 `rotate` 为 clear 后 save（`:96`）。同样不是两文件事务，但 load 会修复单边缺失状态。
- manager 收到 invalid persisted auth 时调用 clear（[webRemoteControlManager.ts:1398](../../packages/desktop/src/main/webRemoteControlManager.ts#L1398)）；用户 resetPairing 停旧 runtime、clear，再 start（`:1537`）。普通 start 会复用完整配对材料，所以关闭一次运行时不应被描述成删除配对凭据。
- 此键没有 workspace 隔离后缀，属于桌面应用的外部 relay 配对状态。它与模型服务 OAuth token、Bot token、Server workspace token 无关。

### 桌面、手机 Web 与远程主机的归属边界

```text
Desktop local workspace  -------------------------> 本机 credentialService
Desktop SSH/WSL/Docker workspace -----------------> 本机 credentialService
Mobile /remote -> shared-host attachment ---------> 所 attach scope 的 service
                                                    |
                                     local/SSH/WSL/Docker: 本机凭据
                                     Server remote: Server 自身凭据
Desktop Main external relay auth ------------------> 本机 credentialService

连接 Server 所需 server-token:
  存于发起连接侧的远端历史凭据；连接建立后的 Server 业务凭据另由 Server 提供。
```

- 桌面基础服务在 [node.ts:1213](../../packages/services/src/node.ts#L1213) 创建 credential service，并注入 Bots（`:1919`）。
- SSH/WSL/Docker 的 host scope 明确保留本机 settings/credential service，同时代理远端文件/任务；[remoteWorkspaceServiceCollection.ts:83](../../packages/desktop/src/host/remoteWorkspaceServiceCollection.ts#L83)、`:239`、`:247`、`:255`。相应 renderer 合并只覆盖 workspace 服务，保留 base credential/Bot 服务：[remoteWorkspaceSessionServices.ts:3](../../packages/desktop/src/renderer/src/remoteWorkspaceSessionServices.ts#L3)。不能因当前 workspace path 在远端就把 Bot/连接认证写到远端机器。
- Server remote 是例外：完整 Server 是业务状态权威，credential/Bot 服务直接转接 Server（[remoteWorkspaceServiceCollection.ts:316](../../packages/desktop/src/host/remoteWorkspaceServiceCollection.ts#L316)、`:334`、`:339`；renderer 同文件 Server 合并入口位于 [remoteWorkspaceSessionServices.ts:53](../../packages/desktop/src/renderer/src/remoteWorkspaceSessionServices.ts#L53)）。
- 手机 Web 建立 bridge 后通过协议得到 services，见 [main.tsx:1838](../../packages/web/src/main.tsx#L1838)；`RemoteServiceAccess` 将 credential/Bot 服务做成 RPC 代理，见 [remoteServiceAccess.ts:113](../../packages/client/src/remoteServiceAccess.ts#L113)、`:134`。未连接的 home-only 状态 credential load 返回 null（[main.tsx:1109](../../packages/web/src/main.tsx#L1109)），不创建浏览器端 credentials.json。
- 手机 `/remote` 依附窗口已存在的 shared-host scope；凭据文件归属与 attachment 相同，并不会因为手机 replayable 流另起 credential store/Agent。桌面 `desktop-continuous` 与手机 `web-remote-replayable` 是消息交付边界，不是此文件的键命名规则。当前事实来源：[task-realtime-sync.md:9](../../docs/web-remote-control/task-realtime-sync.md#L9)、`:22`；[web-remote-control-task-command-queue.md:20](../../docs/web-remote-control-task-command-queue.md#L20)。

### 已验证行为与待验证问题

| 事项                                       | 证据等级                   | 观察与影响                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook provider.test 对缺失存储值仍报成功 | 已执行合成运行复现         | 直接用 Node v24 import 真实 `createWebhookBotProvider`，ref 存在、无 webhookUrl、load 恒返回 null 时，返回 `{ok:true,message:"Webhook bot is enabled for inbound callbacks."}`，credential 读取次数为 0。源码 [webhookProvider.ts:172](../../packages/services/src/bots/providers/webhookProvider.ts#L172)。仅验证测试连接分支，未验证完整入站 service。 |
| Bot callback 缺失 secret 时可能跳过校验    | 静态高置信候选，未完整运行 | [botsService.ts:3273](../../packages/services/src/bots/botsService.ts#L3273)、`:3284` 只在 expectedSecret/expectedToken 为真且不相等时拒绝；ref 存在而 load 返回 null/空串将跳过该检查。不能将上一行 provider.test 复现当成本行已复现。                                                                                                                  |
| Bot 保存被拒后仍可能更新凭据或留下孤儿     | 静态候选，未运行           | 先 `credentialService.save`（`botsService.ts:6127`）后 `validateBotConfig`（`:6171`）。例如重复 providerUserId 校验失败可能晚于 secret 写入；需完整 service fixture 验证与确定修复事务边界。                                                                                                                                                             |
| 远端失败重连可能覆盖已有正确凭据           | 静态候选，未运行           | `remoteWorkspaceHistory.ts:404` 在 failed/currentEntry 时保留旧 snapshot，但 `:451` 仍用提交的 target 建 credentialsToSave。需真实连接失败/持久化调用链测试，未据此认定已复现。                                                                                                                                                                          |

## 审计结论与验证记录

### 已取得合成运行证据

| 场景                                            | 结果                                                                                | 结论范围                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CLI 从旧 BigModel 会话登录 ZAI                  | active 变为 zai，新 JWT 覆盖；旧 BigModel access/refresh/user 与旧 ZAI refresh 保留 | CLI-2 已确认：旧凭据清理不完整；不能把残留字段直接表述为两个 active provider 同时生效                    |
| BigModel 会话执行 CLI logout                    | JWT 消失，active=bigmodel 与 BigModel namespace 保留                                | CLI-3 已确认：会话只清一半；正确问题不是删除了应保留的旧 JWT                                             |
| Desktop cached restore 单独遇到 JWT 解密错误    | 抛错，active marker 未通过 Repo 的统一恢复逻辑清理                                  | 真实 restore 方法配合错误注入；需要补对应损坏恢复用例                                                    |
| Desktop 同平台重新登录落盘中取消                | rollback 写回旧 access/profile，曾恢复的旧 JWT 随后又被另一域 clearProvider 删除    | 确认的是当前回滚状态不一致。最终应保留旧会话还是保持登出取决于提交/取消契约，不能直接以补回旧 JWT 为修复 |
| Desktop/CLI 加密环境变量含空白                  | 普通值可双向解密；首尾空白、全空白两种情况均双向失败                                | 真正 cipher 的合成互操作验证，无真实 token 或密钥                                                        |
| inbound-only Webhook 的 test                    | ref 存在但不调用 loadCredential 就返回成功                                          | 只验证 test 分支；没有把它冒充为完整 callback 服务的验密复现                                             |

上表使用 Node 24 执行当前源码或从源码提取的实际方法；HTTP、配置写入或外围依赖按各场景注入 fixture。它们能证明对应函数路径的结果，不能代替桌面、手机、真实服务器和跨操作系统端到端验证。

### 需要继续验证或明确的边界

- **登录事务时机：** 点击开始、ready/兑换完成、凭据发布、模型 API key/config 更新不是同一时刻；用户取消或任一步失败时的最终状态应与提交边界一起确定。
- **跨进程一致性：** 文件写锁已经存在，但多个独立 key 操作、多次读取、多个 OAuthService 实例不构成全局登录事务。是否需要批量发布/快照读取应结合交错复现决定。
- **Bot 和远端候选：** callback 缺失 secret 时跳过校验、Bot 校验失败前已写 secret、失败重连仍排入新凭据保存，目前是静态候选，完整调用链未执行。
- **MCP 和 App 账号关系：** MCP namespace 当前没有 App account/workspace 维度，App logout 不自动 revoke MCP 授权。是否需要跟随 App 账号清理属于独立设计选择。
- **本地加密迁移：** 默认密钥来源与两端空白差异需要兼顾旧文件，不能只改新密钥推导。明文兼容和未知加密前缀也应随版本迁移策略一起定义。
- **归档变体：** Desktop 当前按精确文件名排除 credentials.json，反馈 fallback 按路径子串排除；损坏备份与临时文件在两条归档路径中的实际处理需要单独用例，本文不声称所有凭据副本均已排除。

### 现有测试与文档核对入口

| 覆盖方向                                | 当前可检查的测试文件                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通用存储加密、并发写、损坏 JSON 保留    | [credentialService.test.ts](../../packages/services/test/credentialService.test.ts)、[CLI auth.test.ts](../../apps/zcode-cli/packages/adapters/tests/auth.test.ts)                                                           |
| Desktop 登录切平台、过期/损坏恢复、取消 | [oauthService.test.ts](../../packages/services/test/oauthService.test.ts)                                                                                                                                                    |
| 官方 MCP 的身份选择                     | [officialMcpCredentials.test.ts](../../packages/services/test/officialMcpCredentials.test.ts)                                                                                                                                |
| 浏览器独立登录存储                      | [browserOAuthCredentialRepo.test.ts](../../packages/web/test/browserOAuthCredentialRepo.test.ts)                                                                                                                             |




本次仅新增梳理文档，没有实现修复。基线新鲜度检查通过；`pnpm typecheck` 和 `pnpm lint` 已执行，但当前 worktree 无 node_modules，分别因 tsc / oxlint 不存在而未能运行。未声明 Vitest、Desktop E2E、手机远控 E2E、Windows/Linux 回归通过。
