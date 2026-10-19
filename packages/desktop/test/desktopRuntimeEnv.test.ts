import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appMock = {
  isPackaged: false,
  getPath: vi.fn((name: string) => `/mock/${name}`),
};

// 编译期常量 ZCODE_PRODUCT_FLAVOR 决定 isPreviewPackagedRuntime；Dynamic Workflow 灰度的
// 「打包 production」档位必须能与 preview 区分，因此这里改成可切换的持有者，默认仍是 preview。
const productFlavorMock = { value: "preview" as string };

vi.mock("electron", () => ({
  app: appMock,
}));

vi.mock("@zcode/shared", async () => ({
  ...(await import("@zcode/shared/runtime-env")),
  ...(await import("@zcode/shared/zcodeEndpoint")),
  OPENZWORK_APP_NAME: "OpenZWork",
  OPENZWORK_APP_NAME_DEV: "OpenZWork Dev",
  OPENZWORK_APP_NAME_PREVIEW: "OpenZWork Preview",
  OPENZWORK_DATA_DIR_NAME: ".openzwork",
  ZCODE_APP_VERSION_ENV: "ZCODE_APP_VERSION",
  ZCODE_AGENT_RUNTIME: {
    binaryKind: "native-binary",
    binaryEnvVar: "GLM_BINARY_PATH",
    bundledResourceDir: "glm",
    version: "0.0.0-test",
    spawnArgs: ["app-server", "--stdio"],
    nativeConfigDir: ".openzwork/cli",
    nativeConfigFileName: "config.json",
    missingBinaryMessage: "[OpenZWork Agent] missing test binary",
    resolveEntrySegments: (platform: string) => [
      platform === "win32" ? "zcode-agent.exe" : "zcode-agent",
    ],
  },
  ZCODE_ENV: "test",
  get ZCODE_PRODUCT_FLAVOR() {
    return productFlavorMock.value;
  },
  ZCODE_DYNAMIC_WORKFLOW_MODE_ENV: "ZCODE_DYNAMIC_WORKFLOW_MODE",
  normalizeDynamicWorkflowMode: (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return ["disabled", "onDemand", "alwaysOn"].includes(trimmed) ? trimmed : undefined;
  },
  ZCODE_VERSION: "0.0.0-test",
}));

vi.mock("@zcode/services/node", () => ({
  getAppConfigDir: vi.fn(() => "/mock/config"),
  getDataBaseDir: vi.fn(() => "/mock/db"),
  ZCODE_WINDOWS_APP_INSTALL_DIR_ENV: "ZCODE_WINDOWS_APP_INSTALL_DIR",
}));

const originalUseCdnSwitch = process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"];
const originalCdnBaseUrl = process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"];
const originalRemoteAssetCacheDir = process.env["ZCODE_REMOTE_ASSET_CACHE_DIR"];
const originalNodeNoWarnings = process.env["NODE_NO_WARNINGS"];
const originalNodeEnv = process.env["NODE_ENV"];
const originalZCodeRuntimeEnv = process.env["ZCODE_RUNTIME_ENV"];
const originalGlmBinaryPath = process.env["GLM_BINARY_PATH"];
const originalZCodeBaseUrl = process.env["ZCODE_BASE_URL"];
const originalZCodeEndpointOrigin = process.env["ZCODE_ENDPOINT_ORIGIN"];
const originalDynamicWorkflowMode = process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"];
const originalDesktopApplicationName = process.env["ZCODE_DESKTOP_APPLICATION_NAME"];
const originalDesktopHomeDir = process.env["ZCODE_DESKTOP_HOME_DIR"];
const originalDesktopUserDataDir = process.env["ZCODE_DESKTOP_USER_DATA_DIR"];
const originalDesktopSessionDataDir = process.env["ZCODE_DESKTOP_SESSION_DATA_DIR"];
const originalDesktopUseElectronDefaultUserData =
  process.env["ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA"];
const originalCwd = process.cwd();
const originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const createdDirs: string[] = [];

function restoreEnvValue(key: string, value: string | undefined) {
  if (value == null) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

// 测试头被截断后丢失了 mock 与环境快照；恢复时按当前 Host 合同隔离代理和证书变量，
// 避免开发机环境影响工具透传断言。环境清理函数复用 shared 公开入口。
const AMBIENT_TOOL_PASSTHROUGH_ENV_KEYS = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
]);
const AMBIENT_PACKAGE_MANAGER_PROXY_ENV_PATTERN =
  /^(npm_config|yarn|pnpm)_(http_proxy|https_proxy|proxy|all_proxy|no_proxy|cafile|ca)$/i;

function isAmbientHostEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return (
    AMBIENT_TOOL_PASSTHROUGH_ENV_KEYS.has(upperKey) ||
    AMBIENT_PACKAGE_MANAGER_PROXY_ENV_PATTERN.test(key)
  );
}

const originalAmbientHostEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && isAmbientHostEnvKey(key)) {
    originalAmbientHostEnv[key] = value;
  }
}

function deleteAmbientHostEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (isAmbientHostEnvKey(key)) {
      delete process.env[key];
    }
  }
}

function resolveTestMockCdnReleaseDir(): string {
  return join(process.cwd(), "packages", "desktop", "mock-cdn", "releases", "0.0.0-test");
}

async function withTestMockCdnReleaseDir<T>(
  mode: "present" | "missing",
  task: () => Promise<T>,
): Promise<T> {
  const releaseDir = resolveTestMockCdnReleaseDir();
  const backupDir = `${releaseDir}.backup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hadReleaseDir = existsSync(releaseDir);
  if (hadReleaseDir) {
    renameSync(releaseDir, backupDir);
  }

  try {
    if (mode === "present") {
      mkdirSync(releaseDir, { recursive: true });
    } else {
      rmSync(releaseDir, { recursive: true, force: true });
    }
    vi.resetModules();
    return await task();
  } finally {
    rmSync(releaseDir, { recursive: true, force: true });
    if (hadReleaseDir) {
      renameSync(backupDir, releaseDir);
    }
  }
}
function expectRuntimePath(actualPath: string | undefined, expectedPath: string) {
  // Bugfix: macOS 的 /var 是 /private/var 的符号链接，chdir 后 process.cwd() 会返回真实路径。
  // buildHostProcessEnv 按 cwd 解析 bundled runtime，因此断言也要比较真实路径，避免路径拼写差异掩盖优先级语义。
  expect(actualPath).toBe(realpathSync(expectedPath));
}

describe("desktopRuntimeEnv resolveRemoteAssetDirs", () => {
  beforeEach(() => {
    vi.resetModules();
    appMock.isPackaged = false;
    appMock.getPath.mockImplementation((name: string) => `/mock/${name}`);
    delete process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"];
    process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"] =
      "https://cdn.example.invalid/remote-assets/0.0.0-test";
    delete process.env["ZCODE_REMOTE_ASSET_CACHE_DIR"];
  });

  afterAll(() => {
    if (originalUseCdnSwitch == null) {
      delete process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"];
    } else {
      process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"] = originalUseCdnSwitch;
    }

    if (originalCdnBaseUrl == null) {
      delete process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"];
    } else {
      process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"] = originalCdnBaseUrl;
    }

    if (originalRemoteAssetCacheDir == null) {
      delete process.env["ZCODE_REMOTE_ASSET_CACHE_DIR"];
    } else {
      process.env["ZCODE_REMOTE_ASSET_CACHE_DIR"] = originalRemoteAssetCacheDir;
    }

    if (originalNodeNoWarnings == null) {
      delete process.env["NODE_NO_WARNINGS"];
    } else {
      process.env["NODE_NO_WARNINGS"] = originalNodeNoWarnings;
    }
  });

  it("开发态当前版本 mock-cdn 存在时默认走 mock-cdn", async () => {
    await withTestMockCdnReleaseDir("present", async () => {
      const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
      const dirs = resolveRemoteAssetDirs({
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      });

      expect(dirs.mockCdnDir).toMatch(/[\\/]mock-cdn$/);
      expect(dirs.sourceServerArtifactPolicy).toBe("development-content-addressed");
      expect(dirs.remoteCdnBaseUrl).toBe("https://cdn.example.invalid/remote-assets/0.0.0-test");
      expect(dirs.remoteCdnBaseUrls).toEqual([
        "https://cdn.example.invalid/remote-assets/0.0.0-test",
      ]);
      expect(dirs.remoteCacheDir).toMatch(/[\\/]userData[\\/]remote-assets-cache$/);
    });
  });

  it("开发态当前版本 mock-cdn 缺失时保留内容寻址策略并由连接 fail-closed", async () => {
    await withTestMockCdnReleaseDir("missing", async () => {
      const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
      const dirs = resolveRemoteAssetDirs({
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      });

      expect(dirs.mockCdnDir).toBeUndefined();
      expect(dirs.sourceServerArtifactPolicy).toBe("development-content-addressed");
      expect(dirs.remoteCdnBaseUrl).toBe("https://cdn.example.invalid/remote-assets/0.0.0-test");
      expect(dirs.remoteCdnBaseUrls).toEqual([
        "https://cdn.example.invalid/remote-assets/0.0.0-test",
      ]);
      expect(dirs.remoteCacheDir).toMatch(/[\\/]userData[\\/]remote-assets-cache$/);
    });
  });
  it("开发态打开开关后应直接走 CDN", async () => {
    process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"] = "TRUE";
    const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
    const dirs = resolveRemoteAssetDirs({
      locale: "en-US",
      timeZone: "Asia/Shanghai",
    });

    expect(dirs.mockCdnDir).toBeUndefined();
    expect(dirs.sourceServerArtifactPolicy).toBeUndefined();
    expect(dirs.remoteCdnBaseUrl).toBe("https://cdn.example.invalid/remote-assets/0.0.0-test");
    expect(dirs.remoteCdnBaseUrls).toEqual([
      "https://cdn.example.invalid/remote-assets/0.0.0-test",
    ]);
    expect(dirs.remoteCacheDir).toMatch(/[\\/]userData[\\/]remote-assets-cache$/);
  });

  it("生产态应始终走 CDN 分支", async () => {
    appMock.isPackaged = true;
    process.env["ZCODE_DEV_REMOTE_ASSET_USE_CDN"] = "0";
    process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"] = "https://cdn.example.com/releases///";
    const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
    const dirs = resolveRemoteAssetDirs({
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    });

    expect(dirs.mockCdnDir).toBeUndefined();
    expect(dirs.sourceServerArtifactPolicy).toBeUndefined();
    expect(dirs.remoteCdnBaseUrl).toBe("https://cdn.example.com/releases");
    expect(dirs.remoteCdnBaseUrls).toEqual(["https://cdn.example.com/releases"]);
    expect(dirs.remoteCacheDir).toMatch(/[\\/]userData[\\/]remote-assets-cache$/);
  });

  it("remote asset cache 目录支持环境变量覆盖", async () => {
    const overrideCacheDir = join(tmpdir(), "zcode-prod-remote-assets-cache");
    process.env["ZCODE_REMOTE_ASSET_CACHE_DIR"] = overrideCacheDir;
    const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
    const dirs = resolveRemoteAssetDirs({
      locale: "zh-CN",
      timeZone: "Asia/Shanghai",
    });

    expect(dirs.remoteCacheDir).toBe(overrideCacheDir);
  });

  it("remote asset cache 目录支持本地 env 文件覆盖", async () => {
    const overrideCacheDir = join(tmpdir(), "zcode-local-env-remote-assets-cache");
    const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
    const dirs = resolveRemoteAssetDirs(
      {
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      },
      {
        ZCODE_REMOTE_ASSET_CACHE_DIR: overrideCacheDir,
      },
    );

    expect(dirs.remoteCacheDir).toBe(overrideCacheDir);
  });

  it("开发态本地 env 文件可切到 CDN 并覆盖 CDN 与 cache", async () => {
    delete process.env["ZCODE_REMOTE_ASSET_CDN_BASE_URL"];
    const overrideCacheDir = join(tmpdir(), "zcode-local-env-cdn-remote-assets-cache");
    const { resolveRemoteAssetDirs } = await import("../src/main/desktopRuntimeEnv.js");
    const dirs = resolveRemoteAssetDirs(
      {
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      },
      {
        ZCODE_DEV_REMOTE_ASSET_USE_CDN: "1",
        ZCODE_REMOTE_ASSET_CDN_BASE_URL: "https://cdn.example.com/releases///",
        ZCODE_REMOTE_ASSET_CACHE_DIR: overrideCacheDir,
      },
    );

    expect(dirs.mockCdnDir).toBeUndefined();
    expect(dirs.remoteCdnBaseUrl).toBe("https://cdn.example.com/releases");
    expect(dirs.remoteCdnBaseUrls).toEqual(["https://cdn.example.com/releases"]);
    expect(dirs.remoteCacheDir).toBe(overrideCacheDir);
  });
});

describe("desktopRuntimeEnv buildHostProcessEnv", () => {
  beforeEach(() => {
    vi.resetModules();
    appMock.isPackaged = false;
    appMock.getPath.mockImplementation((name: string) => `/mock/${name}`);
    delete process.env["NODE_NO_WARNINGS"];
    delete process.env["NODE_ENV"];
    delete process.env["ZCODE_RUNTIME_ENV"];
    deleteAmbientHostEnv();
    delete process.env["GLM_BINARY_PATH"];
    delete process.env["ZCODE_BASE_URL"];
    delete process.env["ZCODE_ENDPOINT_ORIGIN"];
    delete process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"];
    productFlavorMock.value = "preview";
    process.chdir(originalCwd);
  });

  afterAll(() => {
    restoreEnvValue("NODE_NO_WARNINGS", originalNodeNoWarnings);
    restoreEnvValue("ZCODE_DYNAMIC_WORKFLOW_MODE", originalDynamicWorkflowMode);
    productFlavorMock.value = "preview";
    restoreEnvValue("NODE_ENV", originalNodeEnv);
    restoreEnvValue("ZCODE_RUNTIME_ENV", originalZCodeRuntimeEnv);
    deleteAmbientHostEnv();
    for (const [key, value] of Object.entries(originalAmbientHostEnv)) {
      process.env[key] = value;
    }

    if (originalGlmBinaryPath == null) {
      delete process.env["GLM_BINARY_PATH"];
    } else {
      process.env["GLM_BINARY_PATH"] = originalGlmBinaryPath;
    }
    restoreEnvValue("ZCODE_BASE_URL", originalZCodeBaseUrl);
    restoreEnvValue("ZCODE_ENDPOINT_ORIGIN", originalZCodeEndpointOrigin);
    if (originalResourcesPathDescriptor) {
      Object.defineProperty(process, "resourcesPath", originalResourcesPathDescriptor);
    } else {
      Reflect.deleteProperty(process, "resourcesPath");
    }

    process.chdir(originalCwd);
    for (const dir of createdDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("host 进程 env 不再注入 NODE_NO_WARNINGS", async () => {
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({});

    // Bugfix: warning 抑制改由 utilityProcess.fork 的 execArgv 负责，避免 Node 专用变量继续泄漏到 shell。
    expect(env.NODE_NO_WARNINGS).toBeUndefined();
  });

  it("host 进程显式注入 app version 供 agent 使用", async () => {
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({});

    expect(env.ZCODE_APP_VERSION).toBe("0.0.0-test");
  });

  it("Windows 打包态会从 resourcesPath 推导安装目录供数据目录保护使用", async () => {
    const { resolveWindowsAppInstallDirForDataBaseDirGuard } =
      await import("../src/main/desktopRuntimeEnv.js");

    expect(
      resolveWindowsAppInstallDirForDataBaseDirGuard({
        platform: "win32",
        isPackaged: true,
        resourcesPath: "C:\\Users\\tester\\AppData\\Local\\Programs\\OpenZWork\\resources",
      }),
    ).toBe("C:\\Users\\tester\\AppData\\Local\\Programs\\OpenZWork");
  });

  it("非 Windows 或开发态不会注入安装目录保护路径", async () => {
    const { resolveWindowsAppInstallDirForDataBaseDirGuard } =
      await import("../src/main/desktopRuntimeEnv.js");

    expect(
      resolveWindowsAppInstallDirForDataBaseDirGuard({
        platform: "darwin",
        isPackaged: true,
        resourcesPath: "/Applications/OpenZWork.app/Contents/Resources",
      }),
    ).toBeUndefined();
    expect(
      resolveWindowsAppInstallDirForDataBaseDirGuard({
        platform: "win32",
        isPackaged: false,
        resourcesPath: "C:\\repo\\packages\\desktop",
      }),
    ).toBeUndefined();
  });

  it("本地开发态 host 进程显式注入 ZCODE_RUNTIME_ENV=development 且不传 NODE_ENV", async () => {
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({});

    expect(env.ZCODE_RUNTIME_ENV).toBe("development");
    expect(env.NODE_ENV).toBeUndefined();
  });

  it("打包态 host 进程显式注入 ZCODE_RUNTIME_ENV=production 且不传 NODE_ENV", async () => {
    appMock.isPackaged = true;
    Object.defineProperty(process, "resourcesPath", {
      value: "/mock/resources",
      configurable: true,
    });
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({});

    expect(env.ZCODE_RUNTIME_ENV).toBe("production");
    expect(env.NODE_ENV).toBeUndefined();
  });

  it("打包 Preview 向 Host 下发 Main 决定的 OpenZWork 数据根", async () => {
    appMock.isPackaged = true;
    Object.defineProperty(process, "resourcesPath", {
      value: "/mock/resources",
      configurable: true,
    });
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({});

    expect(env.ZCODE_STORAGE_PROFILE).toBeUndefined();
    expect(env.ZCODE_DATA_BASE_DIR).toBe("/mock/db");
    expect(env.ZCODE_STORAGE_DIR).toBe(join("/mock/db", ".openzwork"));
    expect(env.ZCODE_SESSION_DB_PATH).toBe(
      join("/mock/db", ".openzwork", "cli", "db", "db.sqlite"),
    );
    expect(env.ZCODE_HOME).toBeUndefined();
  });

  it("源码开发态向 Host 下发 Main 决定的 OpenZWork 数据根", async () => {
    appMock.isPackaged = false;
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    // 旧继承路径会令 Agent 与存储预备进程指向不同数据库；Main 统一下发当前数据根并移除旧别名。
    const env = buildHostProcessEnv({
      ZCODE_DATA_BASE_DIR: "/stale/data",
      ZCODE_STORAGE_DIR: "/stale/storage",
      ZCODE_SESSION_DB_PATH: "/stale/current.sqlite",
      ZCODE_SESSION_DB: "/stale/legacy.sqlite",
    });

    expect(env.ZCODE_STORAGE_PROFILE).toBeUndefined();
    expect(env.ZCODE_DATA_BASE_DIR).toBe("/mock/db");
    expect(env.ZCODE_STORAGE_DIR).toBe(join("/mock/db", ".openzwork"));
    expect(env.ZCODE_SESSION_DB_PATH).toBe(
      join("/mock/db", ".openzwork", "cli", "db", "db.sqlite"),
    );
    expect(env.ZCODE_SESSION_DB).toBeUndefined();
    expect(env.ZCODE_HOME).toBeUndefined();
  });

  it("host 进程过滤 shell 注入的运行时、代理和证书变量", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["HTTP_PROXY"] = "http://ambient-proxy:8080";
    process.env["NODE_EXTRA_CA_CERTS"] = "/tmp/ambient-ca.pem";
    process.env["npm_config_proxy"] = "http://npm-proxy:8080";
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({
      http_proxy: "http://local-proxy:8080",
      NODE_NO_WARNINGS: "1",
    });

    expect(env.ZCODE_RUNTIME_ENV).toBe("development");
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.http_proxy).toBeUndefined();
    expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(env.NODE_NO_WARNINGS).toBeUndefined();
    expect(env.npm_config_proxy).toBeUndefined();
    expect(JSON.parse(env.ZCODE_TOOL_ENV_PASSTHROUGH_JSON ?? "{}")).toMatchObject({
      http_proxy: "http://local-proxy:8080",
      HTTP_PROXY: "http://ambient-proxy:8080",
      NODE_EXTRA_CA_CERTS: "/tmp/ambient-ca.pem",
      npm_config_proxy: "http://npm-proxy:8080",
    });
  });

  it("bundled GLM runtime 优先于本地显式 GLM_BINARY_PATH", async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), "zcode-desktop-runtime-env-"));
    createdDirs.push(sandboxRoot);
    const platformKey = `${process.platform}-${process.arch}`;
    const bundledBinaryName = process.platform === "win32" ? "zcode-agent.exe" : "zcode-agent";
    const bundledPath = join(sandboxRoot, "bundled-agents", platformKey, "glm", bundledBinaryName);
    const localGlmPath = join(sandboxRoot, "local", "zcode-agent");
    mkdirSync(join(sandboxRoot, "bundled-agents", platformKey, "glm"), {
      recursive: true,
    });
    mkdirSync(join(sandboxRoot, "local"), { recursive: true });
    writeFileSync(bundledPath, "bundled\n", "utf-8");
    writeFileSync(localGlmPath, "local\n", "utf-8");
    process.chdir(sandboxRoot);

    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    const env = buildHostProcessEnv({ GLM_BINARY_PATH: localGlmPath });

    expectRuntimePath(env.GLM_BINARY_PATH, bundledPath);
  });

  it("main 进程 endpoint 临时覆盖优先读取命令行环境变量", async () => {
    process.env["ZCODE_ENDPOINT_ORIGIN"] = "http://127.0.0.1:18765";
    const { resolveZCodeEndpointEnvBaseOrigin } = await import("../src/main/desktopRuntimeEnv.js");

    expect(resolveZCodeEndpointEnvBaseOrigin({})).toBe("http://127.0.0.1:18765");
  });

  // DWG-05（docs/dynamic-workflow/launch.md「Gray release」）：Main 对
  // ZCODE_DYNAMIC_WORKFLOW_MODE 只有「写」和「删」两种动作，先在纯函数上钉住三档语义。
  describe("resolveDynamicWorkflowModeHostEnv", () => {
    it("未打包 dev 透传 shell 里的合法取值", async () => {
      const { resolveDynamicWorkflowModeHostEnv } =
        await import("../src/main/desktopRuntimeEnv.js");

      expect(
        resolveDynamicWorkflowModeHostEnv({
          inheritedValue: "disabled",
          isPackaged: false,
          isPreview: false,
        }),
      ).toEqual({ ZCODE_DYNAMIC_WORKFLOW_MODE: "disabled" });
    });

    it("未打包 dev 丢弃非法取值和缺省值，而不是转发给 Host", async () => {
      const { resolveDynamicWorkflowModeHostEnv } =
        await import("../src/main/desktopRuntimeEnv.js");

      expect(
        resolveDynamicWorkflowModeHostEnv({
          inheritedValue: "garbage",
          isPackaged: false,
          isPreview: false,
        }),
      ).toEqual({});
      expect(
        resolveDynamicWorkflowModeHostEnv({
          inheritedValue: undefined,
          isPackaged: false,
          isPreview: false,
        }),
      ).toEqual({});
    });

    it("打包 preview 固定写入 alwaysOn，忽略 shell 的相反取值", async () => {
      const { resolveDynamicWorkflowModeHostEnv } =
        await import("../src/main/desktopRuntimeEnv.js");

      expect(
        resolveDynamicWorkflowModeHostEnv({
          inheritedValue: "disabled",
          isPackaged: true,
          isPreview: true,
        }),
      ).toEqual({ ZCODE_DYNAMIC_WORKFLOW_MODE: "alwaysOn" });
    });

    it("打包 production 永不写入，shell 的合法取值同样无效", async () => {
      const { resolveDynamicWorkflowModeHostEnv } =
        await import("../src/main/desktopRuntimeEnv.js");

      expect(
        resolveDynamicWorkflowModeHostEnv({
          inheritedValue: "alwaysOn",
          isPackaged: true,
          isPreview: false,
        }),
      ).toEqual({});
    });
  });

  it("未打包 dev 的 host env 带上 shell 里的 Dynamic Workflow 覆盖，非法取值则整键消失", async () => {
    process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"] = "onDemand";
    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    expect(buildHostProcessEnv({}).ZCODE_DYNAMIC_WORKFLOW_MODE).toBe("onDemand");

    vi.resetModules();
    process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"] = "not-a-mode";
    const { buildHostProcessEnv: rebuilt } = await import("../src/main/desktopRuntimeEnv.js");

    // 非法值必须被删掉而不是随 inheritedEnv 穿透；否则 Host 还要自己分辨来源。
    expect(rebuilt({}).ZCODE_DYNAMIC_WORKFLOW_MODE).toBeUndefined();
  });

  it("打包 preview 的 host env 把 Dynamic Workflow 覆盖改写成 alwaysOn", async () => {
    appMock.isPackaged = true;
    productFlavorMock.value = "preview";
    Object.defineProperty(process, "resourcesPath", {
      value: "/mock/resources",
      configurable: true,
    });
    process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"] = "disabled";

    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    expect(buildHostProcessEnv({}).ZCODE_DYNAMIC_WORKFLOW_MODE).toBe("alwaysOn");
  });

  it("打包 production 的 host env 删除继承的 Dynamic Workflow 覆盖", async () => {
    appMock.isPackaged = true;
    productFlavorMock.value = "production";
    Object.defineProperty(process, "resourcesPath", {
      value: "/mock/resources",
      configurable: true,
    });
    process.env["ZCODE_DYNAMIC_WORKFLOW_MODE"] = "alwaysOn";

    const { buildHostProcessEnv } = await import("../src/main/desktopRuntimeEnv.js");

    // shell 和 .env 两条继承路径都要被删干净，本机环境变量不能自行打开灰度。
    expect(buildHostProcessEnv({}).ZCODE_DYNAMIC_WORKFLOW_MODE).toBeUndefined();
    expect(
      buildHostProcessEnv({ ZCODE_DYNAMIC_WORKFLOW_MODE: "alwaysOn" }).ZCODE_DYNAMIC_WORKFLOW_MODE,
    ).toBeUndefined();
  });
});

describe("desktopRuntimeEnv runtime identity", () => {
  beforeEach(() => {
    vi.resetModules();
    appMock.isPackaged = false;
    appMock.getPath.mockClear();
    appMock.getPath.mockImplementation((name: string) => `/mock/${name}`);
    delete process.env["ZCODE_DESKTOP_APPLICATION_NAME"];
    delete process.env["ZCODE_DESKTOP_HOME_DIR"];
    delete process.env["ZCODE_DESKTOP_USER_DATA_DIR"];
    delete process.env["ZCODE_DESKTOP_SESSION_DATA_DIR"];
    delete process.env["ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA"];
  });

  afterAll(() => {
    if (originalDesktopApplicationName == null) {
      delete process.env["ZCODE_DESKTOP_APPLICATION_NAME"];
    } else {
      process.env["ZCODE_DESKTOP_APPLICATION_NAME"] = originalDesktopApplicationName;
    }

    if (originalDesktopHomeDir == null) {
      delete process.env["ZCODE_DESKTOP_HOME_DIR"];
    } else {
      process.env["ZCODE_DESKTOP_HOME_DIR"] = originalDesktopHomeDir;
    }

    if (originalDesktopUserDataDir == null) {
      delete process.env["ZCODE_DESKTOP_USER_DATA_DIR"];
    } else {
      process.env["ZCODE_DESKTOP_USER_DATA_DIR"] = originalDesktopUserDataDir;
    }

    if (originalDesktopSessionDataDir == null) {
      delete process.env["ZCODE_DESKTOP_SESSION_DATA_DIR"];
    } else {
      process.env["ZCODE_DESKTOP_SESSION_DATA_DIR"] = originalDesktopSessionDataDir;
    }

    if (originalDesktopUseElectronDefaultUserData == null) {
      delete process.env["ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA"];
    } else {
      process.env["ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA"] =
        originalDesktopUseElectronDefaultUserData;
    }
  });

  it("e2e 可通过环境变量隔离应用名和 Electron 数据目录", async () => {
    process.env["ZCODE_DESKTOP_APPLICATION_NAME"] = "OpenZWork E2E";
    process.env["ZCODE_DESKTOP_HOME_DIR"] = "/tmp/zcode-e2e/home";
    process.env["ZCODE_DESKTOP_USER_DATA_DIR"] = "/tmp/zcode-e2e/user-data";
    process.env["ZCODE_DESKTOP_SESSION_DATA_DIR"] = "/tmp/zcode-e2e/session-data";

    const { runtimeApplicationName, runtimeHomePath, runtimeSessionDataPath, runtimeUserDataPath } =
      await import("../src/main/desktopRuntimeEnv.js");

    expect(runtimeApplicationName).toBe("OpenZWork E2E");
    expect(runtimeHomePath).toBe("/tmp/zcode-e2e/home");
    expect(runtimeUserDataPath).toBe("/tmp/zcode-e2e/user-data");
    expect(runtimeSessionDataPath).toBe("/tmp/zcode-e2e/session-data");
  });

  it("打包测试环境使用 Preview 应用名和独立 Electron 数据目录", async () => {
    appMock.isPackaged = true;

    const {
      isPreviewPackagedRuntime,
      runtimeApplicationName,
      runtimeSessionDataPath,
      runtimeUserDataPath,
    } = await import("../src/main/desktopRuntimeEnv.js");

    expect(isPreviewPackagedRuntime).toBe(true);
    expect(runtimeApplicationName).toBe("OpenZWork Preview");
    // Bugfix：这两条路径由实现用宿主 path.join 从 app.getPath("appData") 拼出，
    // Windows 上是 `\mock\appData\OpenZWork Preview`，写死 POSIX 字面量必然失败。
    // 用例要断言的是「Preview 单独占一个 Electron 数据目录」的目录结构，与分隔符无关，
    // 所以用同样的 join 表达；在 POSIX 上是恒等变换。
    expect(runtimeUserDataPath).toBe(join("/mock/appData", "OpenZWork Preview"));
    expect(runtimeSessionDataPath).toBe(join("/mock/appData", "OpenZWork Preview", "session"));
  });

  it("e2e 可保留 Chromedriver 注入的 Electron userData 目录", async () => {
    process.env["ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA"] = "1";
    appMock.getPath.mockImplementation((name: string) => {
      if (name === "appData") {
        throw new Error("Failed to get 'appData' path");
      }
      return `/mock/${name}`;
    });

    const { runtimeSessionDataPath, runtimeUserDataPath, shouldUseElectronDefaultUserDataPath } =
      await import("../src/main/desktopRuntimeEnv.js");

    expect(shouldUseElectronDefaultUserDataPath).toBe(true);
    expect(runtimeUserDataPath).toBeUndefined();
    expect(runtimeSessionDataPath).toBeUndefined();
    expect(appMock.getPath).not.toHaveBeenCalledWith("appData");
  });
});
