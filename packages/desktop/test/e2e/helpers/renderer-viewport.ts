/** 响应式断言用 renderer viewport；不受桌面最小窗口或宿主屏幕可用高度限制。 */
const ownedDebuggerTargets = new Set<number>();

export async function setRendererViewport(width: number, height: number) {
  await sendViewportCommand("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.waitUntil(
    () =>
      browser.execute((w, h) => window.innerWidth === w && window.innerHeight === h, width, height),
    { timeout: 10000, timeoutMsg: `renderer viewport 没有应用 ${width}x${height}` },
  );
}

export async function clearRendererViewport() {
  await sendViewportCommand("Emulation.clearDeviceMetricsOverride", {});
}

async function sendViewportCommand(command: string, parameters: Record<string, unknown>) {
  const targetUrl = await browser.getUrl();
  const session = await browser.electron.execute(
    async (electron, targetUrl, command, parameters, ownedTargets) => {
      const target = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
      );
      if (!target) throw new Error("当前 renderer 没有对应的 Electron 窗口");
      const debuggerApi = target.webContents.debugger;
      const attachedHere = !debuggerApi.isAttached();
      if (attachedHere) debuggerApi.attach("1.3");
      const owned = attachedHere || ownedTargets.includes(target.webContents.id);
      try {
        await debuggerApi.sendCommand(command, parameters);
      } catch (error) {
        if (attachedHere) debuggerApi.detach();
        throw error;
      }
      // 提前 detach 会在下一次渲染撤销 metrics；清除模拟后才释放自己创建的会话。
      const cleared = command === "Emulation.clearDeviceMetricsOverride";
      if (cleared && owned) debuggerApi.detach();
      return { id: target.webContents.id, owned: owned && !cleared };
    },
    targetUrl,
    command,
    parameters,
    [...ownedDebuggerTargets],
  );
  if (session.owned) ownedDebuggerTargets.add(session.id);
  else ownedDebuggerTargets.delete(session.id);
}

// OpenZWork 净化口径：上游 v3.17.1 改名为 setRendererViewport/clearRendererViewport；
// 保留旧名别名，避免既有 e2e 用例迁移受合并节奏牵制。
export const setCurrentRendererViewport = setRendererViewport;
export const clearCurrentRendererViewport = clearRendererViewport;
