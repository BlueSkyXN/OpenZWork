import { afterEach, describe, expect, it, vi } from "vitest";

// OW-P026 回归：setCurrentElectronRendererContentSize 必须在调整窗口尺寸前释放
// 遗留的 Emulation.setDeviceMetricsOverride（覆盖会钉住 innerWidth/innerHeight，收敛永不成立）。
// 上游同缺陷；顺序执行 plugin-localization-creator 两用例时复现（run 155225442-p85137）。

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("e2e 窗口尺寸调整先清除设备度量覆盖（OW-P026）", () => {
  it("clearDeviceMetricsOverride 先于 setContentSize 发出", async () => {
    const order: string[] = [];
    let contentSize: [number, number] = [1280, 844];
    const win = {
      isDestroyed: () => false,
      webContents: {
        getURL: () => "file:///e2e/index.html",
        getZoomFactor: () => 1,
        debugger: {
          isAttached: () => false,
          attach: () => order.push("debugger-attach"),
          detach: () => order.push("debugger-detach"),
          sendCommand: async (command: string) => {
            order.push(`cdp:${command}`);
          },
        },
      },
      getContentSize: () => [...contentSize] as [number, number],
      setContentSize: (width: number, height: number) => {
        order.push(`setContentSize:${width}x${height}`);
        contentSize = [width, height];
      },
      focus: () => {},
    };
    const electron = { BrowserWindow: { getAllWindows: () => [win] } };
    vi.stubGlobal("browser", {
      getUrl: async () => "file:///e2e/index.html",
      electron: {
        execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(electron, ...args),
      },
      execute: async () => ({ width: contentSize[0], height: contentSize[1] }),
      waitUntil: async (predicate: () => Promise<boolean>) => {
        if (!(await predicate())) throw new Error("viewport 轮询未收敛（测试桩）");
      },
    });

    const { setCurrentElectronRendererContentSize } = await import("./e2e/helpers/desktop-app.js");
    await setCurrentElectronRendererContentSize(1200, 800);

    const clearIndex = order.indexOf("cdp:Emulation.clearDeviceMetricsOverride");
    const resizeIndex = order.findIndex((entry) => entry.startsWith("setContentSize:"));
    // 先释放覆盖再调窗口尺寸：顺序颠倒或缺失清除都会让收敛契约失效（OW-P026）。
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(resizeIndex).toBeGreaterThan(clearIndex);
    expect(contentSize).toEqual([1200, 800]);
  });
});
