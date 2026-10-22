import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderConfigRuntime } from "#src/model-provider/providerConfigRuntime.js";
import { createProviderRuntimeFromConfigRuntime } from "#src/model-provider/providerRuntime.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "builtin-refresh-failure-"));
  const bundled = join(root, "bundled.json");
  const activePath = join(root, "active.json");
  await writeFile(
    bundled,
    await readFile(new URL("../../../config/provider/zcode-builtin.json", import.meta.url)),
  );
  const configRuntime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: bundled,
    zcodeBuiltinActiveFilePath: activePath,
    personalFilePath: join(root, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  const runtime = createProviderRuntimeFromConfigRuntime({ configRuntime });
  cleanups.push(async () => {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await runtime.start();
  return { runtime, bundled, activePath };
}

describe("本地 Builtin 配置刷新边界", () => {
  it("Active 缓存损坏时使用 Bundled 并修复缓存", async () => {
    const fixture = await setup();
    await writeFile(fixture.activePath, "invalid json");
    await expect(
      fixture.runtime.providerSettings.refresh("settings-manual"),
    ).resolves.toBeDefined();
    expect(JSON.parse(await readFile(fixture.activePath, "utf8"))).toEqual(
      JSON.parse(await readFile(fixture.bundled, "utf8")),
    );
  });
  it("Bundled 与 Active 都不可用时拒绝刷新", async () => {
    const fixture = await setup();
    await writeFile(fixture.bundled, "invalid json");
    await writeFile(fixture.activePath, "invalid json");
    await expect(fixture.runtime.providerSettings.refresh("settings-manual")).rejects.toThrow(
      "均不可用",
    );
  });
});
