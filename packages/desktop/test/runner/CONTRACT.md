# Desktop E2E runner

所有者为 desktop-testing。`packages/desktop/wdio.conf.ts` 是 WDIO 唯一入口，复用通用 helper 完成准备、隔离 HOME、启动、窗口屏障、报告和进程回收。

入口不保存产品 session/task 状态，不注入官方账号、套餐或遥测。各 worker 只管理所属 run/cid 的临时目录与进程。准备失败必须阻止用例执行，收尾保留失败报告。Provider 默认正常上下文窗口，仅显式 Compact 场景使用小窗口。

验证：Desktop E2E 类型检查及 runner、隔离、进程回收和报告单元测试；这些检查不替代真实 Electron、手机或 SSH 场景运行。
