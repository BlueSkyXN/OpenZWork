import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// v3.17.1 同步复核产生的退役守护：上游 sync（a60ba6a7）整体退役了三组下游补丁的
// 原回归宿主，本文件按 docs/spec/downstream-patch-registry.md 对 retired 条目的要求
// （回归带编号标记并进入核心 CI）提供存活载体，防止退役事实被悄悄回退：
// - OW-P003：providerProvisioningRealStores 夹具域已退役，Registry 刷新仍在
//   providerRuntime 中由 start/dispose 生命周期管理；
// - OW-P007：botsService 消息流单测域已退役，runStartupBackgroundTasks 开关与
//   disposeAllAndWait 等待语义仍保留在服务实现中；
// - OW-P008：zcodeAgentResourceTelemetry RPC 单测域已退役，固定睡眠夹具不复存在。
const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("OW-P003/OW-P007/OW-P008：上游 v3.17.1 退役的下游补丁宿主保持退役", () => {
  it("OW-P003：providerProvisioning 真实 Store 夹具不再存在，Registry 刷新由 Runtime 生命周期管理", async () => {
    const runtime = await read("../src/model-provider/providerRuntime.ts");
    // OW-P003：原缺陷是夹具 dispose 不等待已排入的刷新；退役后刷新只经
    // start()/dispose() 生命周期入口，不再有绕过生命周期的夹具清理路径。
    expect(runtime).toMatch(/registryService\.start\(\)/);
    expect(runtime).toMatch(/this\.registryService\.dispose\(\)/);
    await expect(read("../test/providerProvisioningRealStores.test.ts")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("OW-P007：消息流单测域保持退役，后台任务开关与等待式清理语义仍在服务中", async () => {
    const service = await read("../src/bots/botsService.ts");
    // OW-P007：原缺陷是夹具默认启动后台轮询且同步 dispose；服务侧保留的
    // runStartupBackgroundTasks 开关与 disposeAllAndWait 即该修复语义的存活面。
    expect(service).toMatch(/deps\.runStartupBackgroundTasks !== false/);
    expect(service).toMatch(/disposeAllAndWait\(\): Promise<void>/);
    await expect(read("../test/botsService.messageFlow.test.ts")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("OW-P008：资源遥测 RPC 单测域保持退役，固定睡眠夹具不再存在", async () => {
    await expect(read("../test/zcodeAgentResourceTelemetry.rpc.test.ts")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
