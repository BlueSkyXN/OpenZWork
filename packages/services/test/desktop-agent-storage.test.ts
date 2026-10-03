import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const fixtureRoot = await mkdtemp(join(tmpdir(), "ozw-desktop-storage-"));
const home = join(fixtureRoot, "home");
await mkdir(home);
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.ZCODE_DATA_BASE_DIR;
delete process.env.ZCODE_STORAGE_DIR;
delete process.env.ZCODE_SESSION_DB_PATH;
delete process.env.ZCODE_SESSION_DB;

const pathsModule = resolve(import.meta.dirname, "../src/paths.ts");
const runtimeModule = resolve(import.meta.dirname, "../../desktop/src/main/desktopRuntimeEnv.ts");
const bundlePath = join(fixtureRoot, "desktop-runtime.mjs");
await build({
  stdin: {
    contents: `export { buildHostProcessEnv } from ${JSON.stringify(runtimeModule)}; export { setDataBaseDir } from ${JSON.stringify(pathsModule)};`,
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@zcode/server/remote"],
  plugins: [
    {
      name: "node-desktop-test-boundaries",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
        build.onResolve({ filter: /^@zcode\/services\/node$/ }, () => ({
          path: "services-node",
          namespace: "test",
        }));
        build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
          contents:
            path === "electron"
              ? `export const app = { isPackaged: false, getPath: () => ${JSON.stringify(home)} };`
              : `export { getAppConfigDir, getDataBaseDir, ZCODE_WINDOWS_APP_INSTALL_DIR_ENV } from ${JSON.stringify(pathsModule)}; export function listSSHConfigAliasesFromLocalConfig() { throw new Error("unused test boundary"); }`,
          resolveDir: import.meta.dirname,
          loader: "ts",
        }));
      },
    },
  ],
});
const desktop = await import(pathToFileURL(bundlePath).href);
const { setDataBaseDir, getZCodeDataRootDir } = await import("../src/paths.js");
const { createMemoryService } = await import("../src/memory/memoryService.js");
const { sanitizeZCodeRuntimeEnv } = await import("@zcode/shared");
const { createConfig } =
  await import("../../../apps/zcode-cli/packages/adapters/src/config/config-factory.js");
const { resolvePath } =
  await import("../../../apps/zcode-cli/packages/adapters/src/config/file-config.adapter.js");
const { getCliStorageRoot } =
  await import("../../../apps/zcode-cli/packages/bootstrap/src/app/paths.js");
const { resolveProjectMemoryRoot } =
  await import("../../../apps/zcode-cli/packages/core/src/memory/project-root.js");
const { createNodeFileSystemAdapter } =
  await import("../../../apps/zcode-cli/packages/adapters/src/fs/index.js");
const { scanMemoryManifest } =
  await import("../../../apps/zcode-cli/packages/core/src/memory/recall/index.js");
const workspacePath = join(fixtureRoot, "project");
await mkdir(workspacePath);
const userConfigPath = join(home, ".openzwork", "cli", "config.json");
await mkdir(dirname(userConfigPath), { recursive: true });
await writeFile(
  userConfigPath,
  JSON.stringify({
    storage: {
      dir: join(fixtureRoot, "config-root"),
      sessionDbPath: join(fixtureRoot, "config.sqlite"),
    },
  }),
);

function agentConfig(env: Record<string, string>) {
  return createConfig({
    env: sanitizeZCodeRuntimeEnv(env),
    userConfigPath,
    workingDirectory: workspacePath,
  }).config;
}

after(async () => {
  setDataBaseDir(null);
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("Desktop 默认根覆盖继承的旧数据根、storage 和两种 DB 环境键", () => {
  desktop.setDataBaseDir(home);
  const env = desktop.buildHostProcessEnv({
    ZCODE_DATA_BASE_DIR: join(fixtureRoot, "stale-base"),
    ZCODE_STORAGE_DIR: join(fixtureRoot, "stale-storage"),
    ZCODE_SESSION_DB_PATH: join(fixtureRoot, "stale.sqlite"),
    ZCODE_SESSION_DB: join(fixtureRoot, "alias.sqlite"),
  });
  const root = join(home, ".openzwork");
  assert.equal(env.ZCODE_DATA_BASE_DIR, home);
  assert.equal(env.ZCODE_STORAGE_DIR, root);
  assert.equal(env.ZCODE_SESSION_DB_PATH, join(root, "cli", "db", "db.sqlite"));
  assert.equal(env.ZCODE_SESSION_DB, undefined);
  const config = agentConfig(env);
  assert.equal(resolvePath(config.storage.dir), root);
  assert.equal(resolvePath(config.storage.sessionDbPath), join(root, "cli", "db", "db.sqlite"));
});

test("Desktop 自定义根同时传给存储预备和 Agent 配置，记忆经 catalog 与 recall 同根可见", async () => {
  const base = join(fixtureRoot, "custom data");
  desktop.setDataBaseDir(base);
  setDataBaseDir(base);
  const env = desktop.buildHostProcessEnv({});
  const config = agentConfig(env);
  const root = getZCodeDataRootDir();
  assert.equal(env.ZCODE_DATA_BASE_DIR, base);
  assert.equal(resolvePath(config.storage.dir), root);
  assert.equal(resolvePath(config.storage.sessionDbPath), join(root, "cli", "db", "db.sqlite"));
  const memoryRoot = resolveProjectMemoryRoot({
    cliStorageRoot: getCliStorageRoot(resolvePath(config.storage.dir)),
    workspacePath,
  });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(join(memoryRoot, "MEMORY.md"), "# Index\n");
  await writeFile(
    join(memoryRoot, "topic.md"),
    "---\nname: Shared topic\ndescription: shared root fixture\nmetadata:\n  type: project\n---\n\nRemember this.\n",
  );
  const service = createMemoryService();
  const catalog = await service.listProjectMemories();
  assert.equal(catalog.length, 1);
  const manifest = await scanMemoryManifest({
    fileSystem: createNodeFileSystemAdapter(),
    rootDir: memoryRoot,
  });
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].filePath, join(memoryRoot, "topic.md"));
  const reloaded = agentConfig(desktop.buildHostProcessEnv({}));
  assert.equal(
    resolveProjectMemoryRoot({
      cliStorageRoot: getCliStorageRoot(resolvePath(reloaded.storage.dir)),
      workspacePath,
    }),
    memoryRoot,
  );
  assert.match(await readFile(join(memoryRoot, "topic.md"), "utf8"), /Remember this/);
});

test("两个真实子进程按 Desktop 环境解析到同一存储根与数据库，远端不继承本机路径", async () => {
  const base = join(fixtureRoot, "child data");
  desktop.setDataBaseDir(base);
  const env = desktop.buildHostProcessEnv({
    ZCODE_SESSION_DB: join(fixtureRoot, "stale-alias.sqlite"),
  });
  const configModule = resolve(
    import.meta.dirname,
    "../../../apps/zcode-cli/packages/adapters/src/config/config-factory.ts",
  );
  const childScript = join(fixtureRoot, "child-config.mts");
  // Windows 盘符会被 ESM 当作 URL 协议；模块说明符用 file URL，配置与 cwd 保留文件路径。
  await writeFile(
    childScript,
    `import { createConfig } from ${JSON.stringify(pathToFileURL(configModule).href)}; const { storage } = createConfig({ userConfigPath: ${JSON.stringify(userConfigPath)}, workingDirectory: ${JSON.stringify(workspacePath)} }).config; process.stdout.write(JSON.stringify(storage));`,
  );
  const execute = promisify(execFile);
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const results = await Promise.all(
    [0, 1].map(() =>
      execute(process.execPath, ["--import", "tsx", childScript], { env: childEnv }),
    ),
  );
  for (const result of results) {
    assert.deepEqual(JSON.parse(result.stdout), {
      dir: join(base, ".openzwork"),
      sessionDbPath: join(base, ".openzwork", "cli", "db", "db.sqlite"),
    });
  }
  const { pickRemoteRuntimeEnv } = await import("../../server/src/remote/connect.js");
  const remoteEnv = pickRemoteRuntimeEnv(env);
  assert.equal("ZCODE_DATA_BASE_DIR" in remoteEnv, false);
  assert.equal("ZCODE_STORAGE_DIR" in remoteEnv, false);
  assert.equal("ZCODE_SESSION_DB_PATH" in remoteEnv, false);
});

test("独立 CLI 显式存储配置不被 Desktop 映射改变", () => {
  const root = join(fixtureRoot, "standalone-root");
  const database = join(fixtureRoot, "standalone.sqlite");
  const config = agentConfig({ ZCODE_STORAGE_DIR: root, ZCODE_SESSION_DB_PATH: database });
  assert.equal(config.storage.dir, root);
  assert.equal(config.storage.sessionDbPath, database);
  assert.equal(homedir(), home);
});
