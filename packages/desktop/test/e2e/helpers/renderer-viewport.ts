/** 布局测试固定 renderer 尺寸；原生窗口几何仍由 desktop-app 的窗口 helper 验证。 */
export async function setCurrentRendererViewport(width: number, height: number): Promise<void> {
  const targetUrl = await browser.getUrl();
  await browser.electron.execute(
    async (electron, targetUrl, width, height) => {
      const target = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
      );
      if (!target) throw new Error("当前 renderer 没有对应的 Electron 窗口");
      // macOS 会按显示器可用区域截断原生窗口高度；布局断言使用明确的 CSS 视口。
      if (!target.webContents.debugger.isAttached()) target.webContents.debugger.attach("1.3");
      await target.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    targetUrl,
    width,
    height,
  );
  await browser.waitUntil(() =>
    browser.execute(
      (width, height) => innerWidth === width && innerHeight === height,
      width,
      height,
    ),
  );
}

export async function clearCurrentRendererViewport(): Promise<void> {
  const targetUrl = await browser.getUrl();
  await browser.electron.execute(async (electron, targetUrl) => {
    const target = electron.BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === targetUrl,
    );
    if (target?.webContents.debugger.isAttached()) {
      await target.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
    }
  }, targetUrl);
}
