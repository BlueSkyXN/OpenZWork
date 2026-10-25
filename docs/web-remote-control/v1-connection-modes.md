# V1 远程控制连接方式

## 产品规则

远控弹窗提供直接访问、自建 relay、官方 relay 三种方式。三者均使用 V1 `auth_init → auth_challenge → auth_response` 的 HMAC 配对，共用现有手机页面、Desktop transport 和窗口 Host attachment。官方预设为 `wss://zcode.z.ai/ws` 与 `https://zcode.z.ai/remote/v4`，仅在用户选择后连接；不接入 OAuth、V2 注册或云端设备发现。官方入口的 `app_version` 是网页分流参数，传入 3.16 会选中登录页面；官方模式省略这个可选参数以进入当前公开的 V1 页面。transport 和 bootstrap 继续报告真实桌面版本。

首次打开只读取状态和连接配置，点击“开启远程控制”才连接。默认直接访问；已有环境变量成对配置时默认自建 relay。成功开启后保存配置，重新打开显示当前运行方式；运行时折叠配置并显示当前方式，留出二维码空间；修改配置需要先停止。关闭弹窗保留连接，“停止”释放连接及监听端口。刷新配对沿用当前连接方式并废弃旧配对材料。

直接访问面向局域网 HTTP 和 nginx 转发。根地址跳转到 `/remote/`；打开完整配对链接直接连接，打开裸地址显示配对链接输入页。每个窗口启动独立 HTTP/WS 网关，默认监听 `0.0.0.0` 的可用端口，自动选择本机非回环 IPv4 生成链接；可填写监听地址、固定端口及浏览器访问地址。无可用 IPv4 时要求填写地址，不能生成手机不可达的 localhost 链接。反向代理需转发 `/remote/` 静态页面和 `/ws` WebSocket；公网使用 HTTPS/WSS。网关只持有当次随机配对材料，直接访问停止或重启后旧链接失效。

自建模式填写 V1 relay 的 WebSocket 地址及手机页面地址；页面可与 relay 分开部署。二维码可增加 `relay` 参数，当前 Web 客户端优先使用该参数，旧二维码继续从页面 origin 推导 `/ws`。HTTPS 页面不能使用 WS；地址拒绝 URL 用户信息、片段及非 HTTP/WS 协议。旧官方页面同源推导行为保持兼容。

手机页面随 Desktop 产物打包；开发时亦可单独构建。普通 HTTP 的浏览器通过已有密码库完成 HMAC/SHA-256，通过共享 UUID 工具生成草稿、Hook 和文档面板标识，文档指纹与面板状态键也使用同一 SHA-256 兼容实现，不依赖仅安全上下文提供的 API。

官方旧 V1 页仍读取 bootstrap 的任务快照。仅官方模式运行时，Renderer 从已有 WindowController 列表 registry 读取当前窗口工作区的 timeline、pinned、archived 三组投影，合并完整结果后经 platform IPC 交给 Main 的旧协议输出。Main 只保留可丢弃的展示投影；任务成员、标题和活动事实仍由 Host / CLI 管理。停止、切换模式或窗口作用域变化使在途读取失效，远端任务保留 workspaceIdentity 和当前 remoteSessionId，未完成的分组读取不发布部分列表。

## 所有者与事件顺序

| 状态                          | 唯一所有者                                    | 其他层                                                      |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| 连接设置                      | Desktop Main 的 SettingService                | UI 只持有草稿，通过 platform 请求                           |
| 窗口连接代次、网关生命周期    | WebRemoteControlManager / AbortController     | stop、失败、窗口关闭均释放                                  |
| V1 配对凭据                   | CredentialService（外部 relay）或内存（直连） | 按规范化端点和窗口隔离；设置文件不保存秘密                  |
| Socket、心跳和重连            | 现有 device/terminal transport                | 网关只鉴权与转发                                            |
| 任务、输入、快照、owner/lease | 现有 Host / CLI runtime                       | 手机保持 web-remote-replayable；桌面保持 desktop-continuous |

```mermaid
sequenceDiagram
    participant U as 远控弹窗
    participant M as Desktop Manager
    participant C as 连接适配器
    participant R as 本机网关或 V1 relay
    participant P as 手机页面
    participant H as 已有 Host / CLI
    U->>M: start(context, connection)
    M->>M: 取消旧代并释放资源
    M->>C: 校验配置并准备当代连接
    C->>R: 直连监听或外部端点
    M->>R: V1 device proof
    R-->>M: waiting / matched
    M->>C: 保存成功配置和 scoped auth
    M-->>U: 当前方式与二维码
    P->>R: V1 terminal proof
    R->>M: 配对后的载荷
    M->>H: 既有 attachment 路由
    H-->>P: snapshot / stream / gap recovery
    U->>M: stop
    M->>C: abort、关闭 socket / HTTP listener
```

启动恢复记录原子保存目标与当时的连接配置，避免多窗口交错保存后用另一种连接方式恢复旧目标。异步准备、凭据写入和注册回调均检查代次。迟到结果必须释放自己的资源，不能关闭新代连接。直连网关仅接受预置设备身份，禁止远程注册；device 连接限本机回环，terminal 通过一次性 nonce 与常量时间 proof 校验，错误连接和超时握手关闭。保留帧大小及发送背压上限。多窗口不复用同一个 SID。

外部 relay 的新凭据记录将 SID 与 passHash 一起存入 CredentialService，按端点及窗口构造 key。旧记录缺少端点归属，保留原记录、不推断迁移，新入口首次生成新配对。环境变量仅作为无已存配置时的自建默认值，显式选择其他方式优先。

## 验收用例与覆盖矩阵

| ID    | 设置、动作                                                                  | 必须断言                                                              | 验证层                  |
| ----- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------- |
| V1-01 | 未配置打开弹窗，选择三种方式                                                | 不自动联网；字段随选择变化；开启动作显式                              | UI E2E                  |
| V1-02 | 直连 loopback 测试端口，以解析到 loopback 的非 localhost 域名访问，手机配对 | 静态资源可读；正常 proof 成功；双向消息；未鉴权数据拒绝               | 网关集成、Desktop E2E   |
| V1-03 | 错 proof、重复 nonce、远程 device 注册、超限输入                            | 不转发，连接关闭                                                      | 网关集成                |
| V1-04 | 停止、刷新、取消启动、多窗口                                                | 监听释放；旧链接失效；另一窗口及新代不受影响                          | manager / provider 集成 |
| V1-05 | relay A/B、窗口 A/B、直连切换                                               | 凭据隔离；配置保存失败释放当代资源；旧存储未改写                      | adapter / manager       |
| V1-06 | 页面与 relay 异源、旧 QR、错误协议                                          | 新 relay 参数生效；旧 origin fallback；拒绝 HTTPS→WS                  | shared / Web            |
| V1-07 | HTTP 无 subtle/randomUUID                                                   | HMAC 与标准向量一致；新建草稿及附件摘要可用                           | Web / UI 单测及浏览器   |
| V1-08 | 自建 V1 fixture 与真实官方 V1                                               | 无账号正常配对和双向消息；失败显示连接错误                            | 集成 / 独立协议探测     |
| V1-09 | 桌面会话在手机恢复                                                          | 既有 owner、workspaceIdentity、bridge generation、replayable 测试通过 | 既有定向回归            |
| V1-10 | Desktop 构建与反向代理路径                                                  | out/web-remote 存在；/remote/ 引用有效；停止后资源不可访问            | build / HTTP            |

V1-08 另验证官方旧页可列出并打开预置的桌面历史任务，且列表更新只来自现有 Controller。

V2/OAuth 用例不进入此功能矩阵；真实公网部署、手机硬件与不同网络运营商的可达性另行验收。候选 E2E 放入 manual-review/pending，不自动提升为正式套件。

候选交互用例：`packages/desktop/test/e2e/conversation-session/manual-review/pending/web-remote-v1-connections.test.ts`。隔离 HOME、合成 relay、真实桌面与浏览器；不依赖真实模型请求。

## 使用方式

打开桌面远控弹窗，选择连接方式并点击开启。直接访问可使用生成的完整链接，或先打开 `http://电脑地址:端口/` 再粘贴配对链接。手机与电脑需处于可互访的网络。默认端口自动分配，nginx 转发时填写固定端口。

同机 nginx 转发示例：桌面监听 `127.0.0.1:8080`，访问地址填写 nginx 的 HTTP/HTTPS 地址。保持 `/remote/` 与 `/ws` 两个路径：

```nginx
location = / {
    return 302 /remote/;
}
location /remote {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    # 配对参数在 URL 中；此路径不记录请求查询串。
    access_log off;
}
location = /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
}
```

自建模式使用兼容本项目 V1 合同的 relay：支持 `device_register_init`、HMAC challenge/proof、`waiting/matched`、心跳查询和双向 `data` 转发。手机页面可单独部署，构建命令为 `pnpm --filter @zcode/web exec vite build --base=/remote/`，输出在 `packages/web/dist/`。在弹窗中分别填写 relay WS 地址和页面 HTTP 地址；HTTPS 页面需配套 WSS。本文提供客户端接入和静态页构建，不自动安装或部署 relay 服务。

官方模式直接选择官方 V1 preset。官方服务的停用或协议变化显示为连接错误，不切换到账号登录。
