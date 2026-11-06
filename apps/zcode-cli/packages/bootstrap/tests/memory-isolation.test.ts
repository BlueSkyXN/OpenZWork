import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";

// 插件发布内容有独立回归；本组只运行真实 app 启动和存储路径，避免访问共享插件缓存。
vi.mock("../src/app/bundled-plugins.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/app/bundled-plugins.js")>()),
  resolveOfficialPluginRoots: () => [],
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("旧 ZCode 记忆与 OpenZWork 启动隔离", () => {
  it.each([
    { custom: false, existing: false },
    { custom: true, existing: false },
    { custom: false, existing: true },
    { custom: true, existing: true },
  ])("MISO03/04 custom=$custom existing=$existing", async ({ custom, existing }) => {
    const root = await mkdtemp(join(tmpdir(), "openzwork-memory-isolation-"));
    vi.stubEnv("HOME", root);
    vi.stubEnv("USERPROFILE", root);
    expect(homedir()).toBe(root);
    const storageRoot = custom ? join(root, "custom", ".openzwork") : join(root, ".openzwork");
    const relativeMemory = join("cli", "memories", "projects", "fixture", "memory", "MEMORY.md");
    const legacyFile = join(root, ".zcode", relativeMemory);
    const targetFile = join(storageRoot, relativeMemory);
    const markerFile = join(storageRoot, "v2", "memory-migration.json");
    const legacyContent = "# ZCode fixture\nOld product memory.\n";
    const ownContent = "# OpenZWork fixture\nExisting memory remains.\n";
    const markerContent = JSON.stringify({
      version: 1,
      source: join(root, ".zcode", "cli", "memories"),
      target: join(storageRoot, "cli", "memories"),
      completedAt: "2026-01-01T00:00:00.000Z",
      filesCopied: 1,
      filesSkipped: 0,
    });
    try {
      await mkdir(dirname(legacyFile), { recursive: true });
      await writeFile(legacyFile, legacyContent);
      if (existing) {
        await mkdir(dirname(targetFile), { recursive: true });
        await writeFile(targetFile, ownContent);
        await mkdir(dirname(markerFile), { recursive: true });
        await writeFile(markerFile, markerContent);
      }
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      // 连续两次构造真实 app，覆盖首启与后续启动；不执行模型请求。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const app = await createRegistryBackedTestApp({
          env: {
            HOME: root,
            USERPROFILE: root,
            ...(custom ? { ZCODE_STORAGE_DIR: storageRoot } : {}),
          },
          runtimeConfig: { workingDirectory: workspace },
          skipUserConfig: true,
        });
        await app.close();
        expect(await readFile(legacyFile, "utf8")).toBe(legacyContent);
        if (existing) {
          expect(await readFile(targetFile, "utf8")).toBe(ownContent);
          expect(await readFile(markerFile, "utf8")).toBe(markerContent);
        } else {
          await expect(access(targetFile)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(access(markerFile)).rejects.toMatchObject({ code: "ENOENT" });
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
