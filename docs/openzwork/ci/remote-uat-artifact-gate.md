# 远端本地 UAT 的产物与权限门禁

- 远端本地 UAT 的受支持平台是 POSIX macOS/Linux；Windows 明确跳过 POSIX 链，不把该跳过写成远端验收通过。
- `remote-chain-local.test.ts` 不得因缺 `packages/server/dist/remote/zcode-server.cjs` 而跳过。缺失或非普通文件必须失败并提示先执行 `pnpm --filter @zcode/server build:remote`。
- workflow 已有构建步骤；测试自身拥有产物期望，未来构建步骤调整也不能使缺产物变成成功。既有未提交 CI/Action/Linux 配置本批不改动、不提交。
- 权限由异步 Node `stat().mode` 验证至少一个 POSIX 执行位，不依赖 BSD/GNU stat 参数。真实 installFile、staging 清理和隔离断言保留。
- 负例仅使用临时缺失路径/非执行文件，通过真实子进程确认缺产物返回非零，且移除执行位时权限断言失败；禁止删除现有产物模拟。
- 验证范围是本地 /bin/sh 传输和真实 server bundle；真实 SSH/WSL/Docker、完整 Agent 部署、安装离线仍需独立验收。
