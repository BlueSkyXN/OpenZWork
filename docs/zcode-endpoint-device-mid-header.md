# ZCode Endpoint DeviceMid Header

<!-- 头部要点段绑定 Start Plan 权益查询（/api/v1/zcode-plan/billing，官方套餐净化域）与官方端点 header 规则，保持我方净化删除口径，不随上游恢复 -->

## 远端 server 的设备身份

```text
桌面端                                   远端主机 / 独立 Server
main ──ensureDesktopDeviceMidSync──┐     Core / Lite ─> createServerHostServices ──ensureTelemetryDeviceMid──┐
                                   │     entry-stdio（旧）──ensureRemoteServerDeviceMid──────────────────────┤
                                   ├─> ~/.openzwork/v2/telemetry-state.json.deviceMid <─────────────────────────┤
host ──buildZCodeSourceHeaders 读──┘     services ──buildZCodeSourceHeaders 读──────────────────────────────┤
                                          zcode-cli ──ensureCliDeviceMid────────────────────────────────────┘
<!-- 结构图采用上游独立 Server 装配（createServerHostServices/ensureTelemetryDeviceMid，保留域）；数据根沿用 OpenZWork .openzwork -->
```

- 独立 Server 的入口（`packages/zcode-server-cli/src/server-core/core.ts`、`packages/server/src/entry-http.ts`）都经 `createServerHostServices()` 装配；该函数在迁移与创建 services 前 await `ensureTelemetryDeviceMid()`，入口在它返回后才开放 RPC/HTTP，因此首次 Start Plan 权益查询前 `deviceMid` 已落盘。新增独立 Server 入口必须复用这条装配，不在入口各自补一份。
- 旧 `packages/server/src/entry-stdio.ts` 不走 `createServerHostServices()`，仍在握手完成后、services 创建前调用 `ensureRemoteServerDeviceMid()`。
- 以上调用都复用 `@zcode/services/node` 的 `ensureTelemetryDeviceMid()`，与 telemetry 上报、CLI 使用同一个文件、字段与锁，同一主机上 server 与 Agent 得到同一个 `deviceMid`；已有 `deviceMid` 保持不变。
- 远端拥有自己的设备身份，不借用也不下发桌面 `deviceMid`；同一远端被多台桌面连接时身份保持稳定。
- 确保失败（文件系统或锁异常）只记录 warn 并继续启动；此时请求与修复前一样省略 `X-Device-Mid`，不伪造设备 ID。
