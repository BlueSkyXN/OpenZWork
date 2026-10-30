# Todo 50：Provider Enabled 与 Account Access Entitlement 拆分

> 状态：已完成
>
> 日期：2026-08-31
>
> 前置关系：Todo 49 先删除虚构的 Account API Provider，并恢复 Family 按量 API 的真实身份。

## 1. 问题

当前 Provider 顶层 `enabled` 同时表达了两件不同的事：

```text
普通 Built-in
└─ Personal enabled=true 表示用户已经把它加入当前配置

Account Provider
└─ Account enabled=true/false 表示当前账号是否拥有套餐资格
```

Resolver 又把两者统一解释成执行门禁。这使“用户是否启用配置”和“账号是否享有这种 Access”无法独立表达。

## 2. 最终契约

Provider 顶层保留 `enabled`，但只表达“这份 Provider 配置是否已经启用并加入用户当前配置”。账号资格收缩到对应 Access：

- Built-in 独占 `type/family/mode`；Account Overlay 只允许覆盖 `access.entitled`；
- Personal Overlay 禁止修改固定 Account Provider 的任何 Access 字段；
- Account Service 的丰富权益证据进入 Effective Provider Config 后只投影 `entitled`；unknown 按现有 LKG/fail-closed 处理；
- 不增加 Provider 顶层 `available`、`configured`、`activated` 或第二套状态 DTO。

## 3. Settings 与 Registry

- 普通 Built-in：Built-in `enabled=false`；“添加供应商”写 Personal `enabled=true`；删除 Overlay 后回落为 false；
- Personal-only：创建时 `enabled=true`，删除时整个定义消失；
- Family 按量 API：Built-in `enabled=true`，固定显示，不提供启停按钮；Key 缺失只导致不完整；
- Account Provider：Built-in `enabled=true`，固定显示；Account Overlay 只更新 `access.entitled` 及账号模型事实；

## 4. 实施范围

2. Account Source Schema 只允许账号 Provider 写 `access.entitled`，拒绝 `type/family/mode`；
3. Account Resolver 从写 Provider 顶层 `enabled` 改为写 `access.entitled`；
4. Registry Resolver 分别检查 Provider `enabled` 与 Account `access.entitled`；
5. Settings View 直接按 `enabled` 将普通 Built-in 放入主列表或添加菜单，entitlement 不改变 Settings placement；
6. 删除把 Provider `enabled` 当成套餐权益的判断、命名和注释；
7. Model Config `enabled` 不变。

## 5. 测试与完成标准

- 普通 Built-in 添加/删除只改变 Personal `enabled`；
- Account Provider `enabled=true, entitled=false` 时固定可见但不进入 Registry；
- Account Provider `enabled=true, entitled=true` 且完整时进入 Registry；
- API Key Provider Schema 不接受也不需要 `entitled`；
- Account Overlay 不能改写 Access 身份，只能改 `entitled`；Personal 不能写 Account Access；
- entitlement unknown 的 LKG/fail-closed 行为保持现状；
- `rg` 证明 Account Resolver 不再写 Provider 顶层 `enabled`；
- `pnpm typecheck`、`pnpm lint`、相关 E2E 与 `git diff --check` 通过。

## 6. 实施结果与验证

- Settings placement 只读取 Provider `enabled`；entitlement 只影响 Registry 可执行性。设置页不再提供通用
  Provider 启停按钮，只展示只读状态；普通 Built-in 的加入/移除仍由正式 Personal Overlay 流程完成。
  `pnpm typecheck` 通过，`pnpm lint` 为 0 error（仓库其余既存 warning 不属于本 Todo）。
- 本轮变更文件定向格式检查与 `git diff --check` 通过；全仓 `fmt:check` 仍被 Electron 文档内既存非法 HTML
  和二进制 `gb2312.js` 阻断，未通过修改无关文件掩盖该基线问题。
