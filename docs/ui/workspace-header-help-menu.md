# Workspace Header Help Menu

工作区任务页、草稿页和设置页复用 `WorkspaceHelpMenuButton`。按钮使用现有 DropdownMenu 和本地化文案，并避开 Electron 标题栏拖拽区；手机窄屏按挂载处的布局条件控制显示。

## 当前菜单

- 用户社群：调用 `IPlatformService.openCommunity()`。
- Desktop：在分隔线后提供资源管理器和关于窗口，分别执行 `DesktopCommandIds.OpenResourceManager` 与 `DesktopCommandIds.ShowAbout`。
- Web：只显示其可执行的平台入口，不展示 Desktop 原生窗口命令。

`isDesktop` 由挂载方注入；平台接口存在 no-op 方法时，不能用方法是否存在推断原生能力。菜单组件不直接调用 `window.zcode`。

本地诊断归档仍使用现有导出服务；菜单项以当前组件实际提供的入口为准。

<!-- 上游完整菜单（产品文档 zcode.z.ai、问题上报/给产品提需求 feedback、检查更新 autoUpdater、复制设备 MID deviceMid）属净化域，随 5aba47d9 净化删除；保留我方精简菜单口径 -->
