import assert from "node:assert/strict";
import { IConfigPackageService } from "@zcode/services";
import { createLocalServices, disposeServiceResourcesAndWait } from "@zcode/services/node";

// CP-10 从独立进程启动桌面 Host，让 CLI 注册表只能通过目标机器的个人配置文件看到变化。
const [home, file, builtin] = process.argv.slice(2);
assert.ok(home && file && builtin);
assert.equal(process.env.ZCODE_DATA_BASE_DIR, home);
assert.equal(process.env.HOME, home);
assert.equal(process.env.USERPROFILE, home);
const services = createLocalServices({
  agentRuntimeContext: { runtimeSurface: "desktop_local_host" },
  serviceAuthorityMode: "desktop-local",
  zcodeBuiltinProviderConfigFilePath: builtin,
});
try {
  const service = services.get(IConfigPackageService);
  const preview = await service.previewFile(file);
  const result = await service.applyPreview(preview.previewId, preview.rows);
  assert.deepEqual(
    result.items.map(({ status }) => status),
    ["updated", "updated"],
  );
  await service.releasePreview(preview.previewId);
} finally {
  await disposeServiceResourcesAndWait(services);
}
