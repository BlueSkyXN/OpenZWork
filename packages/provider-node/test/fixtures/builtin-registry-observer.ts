import { NodeProviderRegistryRuntime } from "../../src/provider-registry-runtime.js";

// 真实子进程消费共享文件，各自从当前 Config Source 刷新 Registry。
const runtime = new NodeProviderRegistryRuntime({
  zcodeBuiltinFilePath: process.argv[2]!,
  personalFilePath: process.argv[3]!,
  personalPollingIntervalMs: false,
});
function report() {
  const snapshot = runtime.registryService.getSnapshot()!;
  process.send?.({
    pid: process.pid,
    builtin: snapshot.config.zcodeBuiltinRevision,
    config: snapshot.sourceRevisions.config,
  });
}
runtime.registryService.onDidChange(report);
await runtime.start();
report();
process.on("message", () => {
  runtime.dispose();
  process.disconnect();
});
process.on("disconnect", () => {
  runtime.dispose();
});
