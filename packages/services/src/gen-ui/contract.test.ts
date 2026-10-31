import { describe, expect, it } from "vitest";
import { exampleGenUiPrepare } from "./contract.example.js";
import type { IGenUiService } from "./contract.js";
import { IGenUiService as descriptor } from "./contract.js";

describe("gen-ui-service contract", () => {
  it("描述符绑定 gen-ui 频道", () => {
    expect(descriptor.channelName).toBe("gen-ui");
  });

  it("示例参数携带 Host 输出根内的执行路径与沙箱归属", () => {
    // prepareSandbox 在桌面 base services 侧注册沙箱，html 只留在执行机；
    // ownerWebContentsId/instanceKey 是注册时的显式 gen-ui 来源字段。
    expect(exampleGenUiPrepare.path).toBe("/workspace/chart.html");
    expect(exampleGenUiPrepare.workspacePath).toBe("/workspace");
    expect(exampleGenUiPrepare.ownerWebContentsId).toBeGreaterThan(0);
    expect(exampleGenUiPrepare.instanceKey.length).toBeGreaterThan(0);
  });

  it("示例只依赖契约方法", async () => {
    // 状态读写与列表留在桌面 base services；readDocument 由执行侧 Host 提供。
    const calls: string[] = [];
    const service: IGenUiService = {
      readDocument: async (target) => {
        calls.push("readDocument");
        return { path: target.path, html: "<div>chart</div>" };
      },
      prepareSandbox: async (input) => {
        calls.push("prepareSandbox");
        expect(input.html).toContain("chart");
        throw new Error("sandbox registration is desktop-owned; not exercised here");
      },
      getState: async () => {
        calls.push("getState");
        return null;
      },
      setState: async () => {
        calls.push("setState");
      },
      listState: async () => {
        calls.push("listState");
        return [];
      },
      onStateChanged: () => ({ dispose: () => undefined }),
    };
    const target = {
      workspacePath: exampleGenUiPrepare.workspacePath,
      sessionId: exampleGenUiPrepare.sessionId,
      path: exampleGenUiPrepare.path,
    };
    await expect(service.readDocument(target)).resolves.toMatchObject({ path: target.path });
    await expect(service.getState(target)).resolves.toBeNull();
    await expect(
      service.setState({ target, state: { modelContent: null, privateContent: {} } }),
    ).resolves.toBeUndefined();
    await expect(
      service.listState({ workspacePath: target.workspacePath, sessionId: target.sessionId }),
    ).resolves.toEqual([]);
    expect(calls).toEqual(["readDocument", "getState", "setState", "listState"]);
  });
});
