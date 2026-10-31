/** 响应式断言用 renderer viewport；不受桌面最小窗口或宿主屏幕可用高度限制。 */
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
  await browser.electron.execute(
    async (electron, targetUrl, command, parameters) => {
      const target = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
      );
      if (!target) throw new Error("当前 renderer 没有对应的 Electron 窗口");
      if (!target.webContents.debugger.isAttached()) target.webContents.debugger.attach("1.3");
      await target.webContents.debugger.sendCommand(command, parameters);
      target.webContents.debugger.detach();
    },
    targetUrl,
    command,
    parameters,
  );
}

// OpenZWork 净化口径：上游 v3.17.1 改名为 setRendererViewport/clearRendererViewport；
// 保留旧名别名，避免既有 e2e 用例迁移受合并节奏牵制。
export const setCurrentRendererViewport = setRendererViewport;
export const clearCurrentRendererViewport = clearRendererViewport;
