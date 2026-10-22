# ZCode Endpoint DeviceMid Header









## 远端 server 的设备身份


```text
桌面端                                   远端主机
main ──ensureDesktopDeviceMidSync──┐     entry-stdio ──ensureTelemetryDeviceMid──┐
                                   ├─> ~/.openzwork/v2/telemetry-state.json.deviceMid <─┤
host ──buildZCodeSourceHeaders 读──┘     services ──buildZCodeSourceHeaders 读──────┤
                                          zcode-cli ──ensureCliDeviceMid──────────┘
```

- 远端 server 在 `packages/server/src/entry-stdio.ts` 握手完成后、services 创建前调用 `ensureRemoteServerDeviceMid()`，内部复用 `@zcode/services/node` 的 `ensureTelemetryDeviceMid()`，与 telemetry 上报、CLI 使用同一个文件、字段与锁，同一主机上 server 与 Agent 得到同一个 `deviceMid`。
- 远端拥有自己的设备身份，不借用也不下发桌面 `deviceMid`；同一远端被多台桌面连接时身份保持稳定。
- 确保失败（文件系统或锁异常）只记录 warn 并继续启动；此时请求与修复前一样省略 `X-Device-Mid`，不伪造设备 ID。
