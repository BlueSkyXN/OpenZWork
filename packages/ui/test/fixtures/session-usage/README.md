# Session usage browser fixture

从仓库根目录运行：

```sh
mise exec node -- pnpm exec vite --config packages/ui/test/fixtures/session-usage/vite.config.mts
```

打开终端报告的 `http://127.0.0.1:5178/`。fixture 只提供合成的 V4 用量 props，挂载真实 `ChatContextUsage` 与项目样式，不启动 Host/Agent，不访问账户、模型或真实用户数据。

## 可重复交互检查

1. 默认中文：hover 或 focus 右下角用量按钮。上下文为 `12,000 / 128,000`；累计总量为 `1,200`，输入 `1,000`、输出 `200`、缓存读 `600`、写 `100`。
2. `Usage update`：再打开面板，总量变为 `1,800`，不是旧值叠加新值。
3. `Unknown context`：按钮改为「本会话累计」/ `Session token usage`，面板只显示累计值，无容量条或百分比。
4. `Zero usage`：上下文依然可见，累计各行显示 `0`。`New session`：触发器与累计区均消失，不保留上一会话用量。
5. `Switch language`：中英文均显示完整本地化数字；`Switch theme`：检查 Zai Light / Zai Dark。
6. `Large counts` + 375px 窄屏：完整长数字可读，无页面或累计区横向溢出。
7. 触摸设备中点击触发器可展开。桌面合成 `pointerdown(pointerType=touch)` 只验证事件分支，不等同真实手机验收。

## 本轮记录

- 已执行：真实浏览器 hover、focus；中文/英文数据；累计更新、上下文未知、零值、新会话清空；375px 下长数字布局边界检查（页面宽度与 scrollWidth 均 375，累计区 scrollWidth = clientWidth）。
- 已执行：触摸 pointerdown 分支模拟、深色主题切换及 DOM 内容检查。真实移动设备未测。
- 已视觉检查：桌面浅色英文面板。窄屏截图接口超时，未完成窄屏/深色截图视觉验收，不将 DOM 检查替代视觉通过。
- 未覆盖：真实模型请求到 V4 订阅全链、Desktop/手机远控的实际断线恢复、安装包运行。
