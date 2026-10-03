# Self 构建的 Computer Use：已撤回的单点修复与待定边界

状态：**2026-10-03 撤回“不传 launcher pid 即可修复”的方案。本文不再授权将官方 CUA 二进制引入 OpenZWork，也不要求复用该单点补丁。** 此前将 socket 监听成功外推为完整兼容，漏掉了连接时的 peer/责任进程签名验证。

## 两个工程分开

- `Qoder-self/ZCodeself` 是官方应用的本地补丁工程，不是 OpenZWork 的源码构建产物。
- 该工程 0.2.3 / `telemetry-blocker-0.1.7` 曾省略 node-repl 宿主的 launcher pid。0.2.4 / 0.1.8 新候选已撤回这个无效操作；旧候选仅保留校验和还原兼容，不改已安装版本。
- OpenZWork 没有因这些实验恢复完整 CUA 实现。本轮没有修改它的运行时、打包管线或插件资产。独立产品是否引入 CUA、使用何种可维护来源及许可，需要另立实现方案，不能从 ZCodeself 的局部实验推导。

## 已确认的签名边界

```text
node-repl → Helper 启动 → socket 连接 → 工具调用
              │              │            │
         launcher 签名    peer 与责任进程   TCC / controller / presentation
```

1. 官方 Helper 在传入 launcher pid 时校验启动方是否满足官方签名要求。
2. 不传 pid 可以让被测 Helper 创建 socket，但连接时仍用 audit token 校验客户端，并校验 macOS 责任进程或父进程的官方 Team 签名。
3. 当前 self 运行链中，Electron Helper 保留官方签名，但其责任进程为本地重签的主进程。省略参数不改变第二层拒绝结果。
4. launcher pid 还控制存活监视、standalone 空闲退出与 presentation 资格；省略并非语义无损。
5. 生产 Helper 的开发逃生参数不能作为本地签名适配方案。TCC 也不能代替连接鉴权。

## 后续实现必须满足的条件

- 保留 launcher 与 peer 鉴权，不采用放行全部同 uid、删除验证或假装官方签名的方案。
- 如选择本地签名适配，需要同时设计 Helper、原生校验、安装器与证书固定信任；证书应以指纹和允许的 bundle 标识限制，而非信任显示名称。
- 修改 Helper 涉及现有产品“保留官方 Helper”的边界、TCC 身份、共享安装位置和回滚，不属于调整一个启动参数。来源、许可和复现构建需独立明确。
- 验收至少覆盖签名正负例、真实连接与工具返回、拒绝权限、生命周期和恢复；离线函数测试、构建成功、签名通过、socket 出现均不能替代端到端验收。
- 不自动停止当前应用、不改共享 Helper 或配置、不把包内备份、重签和覆盖安装当作探测步骤。

## 当前证据范围

2026-10-01 的浏览器控制实测通过不等于本轮重新验证；CUA 三组合实验仅是启动门证据。新的补丁工程规范位于 `Qoder-self/ZCodeself/docs/CUA_COMPATIBILITY.md`，那里明确区分工具校验修正与尚未解决的 Computer Use 功能。
