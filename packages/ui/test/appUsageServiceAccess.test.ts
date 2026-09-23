import assert from "node:assert/strict";
import test from "node:test";
import type { IAppUsageService, IServiceAccessor } from "@zcode/services";
import { getLocalAppUsageService } from "../src/hooks/appUsageServiceAccess.js";
import { useRemoteWorkspaceSessionStore } from "../src/store/remoteWorkspaceSessionStore.js";

function createServices(appUsageService?: IAppUsageService): IServiceAccessor {
  return { appUsageService } as unknown as IServiceAccessor;
}

test("App Usage is available only through the explicitly registered Desktop local base", async () => {
  const store = useRemoteWorkspaceSessionStore;
  const previousLocalBase = store.getState().localBaseServices;
  let rpcCalls = 0;
  const localUsageService = {
    async getAppUsageStats(params: { range: "all" | "7d" | "30d" }) {
      rpcCalls += 1;
      assert.deepEqual(params, { range: "30d" });
      return { source: "agent-db" } as Awaited<ReturnType<IAppUsageService["getAppUsageStats"]>>;
    },
  } as IAppUsageService;
  const localServices = createServices(localUsageService);
  const webContextServices = createServices(localUsageService);
  const remoteWorkspaceServices = createServices(localUsageService);
  const desktopBaseWithoutUsage = createServices();

  try {
    store.setState({ localBaseServices: null });
    const webUsageService = getLocalAppUsageService(webContextServices);
    const remoteUsageService = getLocalAppUsageService(remoteWorkspaceServices);
    assert.equal(webUsageService, undefined);
    assert.equal(remoteUsageService, undefined);
    await webUsageService?.getAppUsageStats({ range: "30d" });
    await remoteUsageService?.getAppUsageStats({ range: "30d" });

    store.getState().registerLocalBaseServices(localServices);
    const desktopUsageService = getLocalAppUsageService(localServices);
    assert.equal(desktopUsageService, localUsageService);
    assert.equal(getLocalAppUsageService(desktopBaseWithoutUsage), undefined);
    const result = await desktopUsageService?.getAppUsageStats({ range: "30d" });
    assert.deepEqual(result, { source: "agent-db" });
    assert.equal(rpcCalls, 1);
  } finally {
    store.setState({ localBaseServices: previousLocalBase });
  }
});
