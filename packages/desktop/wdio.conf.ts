/* eslint-disable max-lines -- 沿用上游 WDIO 单入口，集中维护隔离启动、窗口屏障、进程回收和报告顺序。 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { AppSettings } from "@zcode/shared";
import {
  buildE2ERunIdArg,
  buildWindowsTaskkillArgs,
  createWindowsE2EHomeMarkerArg,
  listE2EProcessTreePids,
} from "./test/e2e/helpers/e2e-process-cleanup.js";
import {
  collectE2EWebDriverPageHandleCandidates,
  type E2EBrowserTargetInfo,
} from "./test/e2e/helpers/e2e-window-target.js";
import { createE2ERendererBridgeRootHooks } from "./test/e2e/helpers/e2e-renderer-bridge-root-hook.js";
import { runMeasuredE2ELifecyclePhase } from "./test/e2e/helpers/e2e-lifecycle-measurement.js";
import { createE2ERunnerFinalizationGuard } from "./test/e2e/helpers/e2e-runner-finalization-guard.js";
import {
  replaceChromeUserDataDirArg,
  resolveE2EWorkerModelStreamIdleTimeoutMs,
  resolveE2EWebDriverRequestLimits,
  resolveE2EWorkerChromiumProfileDir,
} from "./test/e2e/helpers/e2e-worker-isolation.js";
import { stageE2EAppOutput } from "./test/e2e/helpers/e2e-app-output-stage.js";
import { ensureSshRemoteReleaseAssets } from "./test/e2e/helpers/e2e-ssh-remote-release-assets.js";
import { createLocalPairingRelay } from "./test/e2e/helpers/local-pairing-relay.js";
import {
  seedPersonalProviderConfig,
  seedPersonalDefaultModelSelection,
} from "./test/e2e/helpers/model-provider-restart-config.js";
import {
  hasRequiredSshE2EEnvironment,
  resolveEnvironmentGatedFormalSpecExcludes,
} from "./scripts/e2e-formal-spec-selection.mjs";
import { E2EFailureArtifactCollector } from "./test/e2e/reporting/e2e-failure-artifacts.js";
import { classifyError, createE2EReporter } from "./test/e2e/reporting/e2e-reporting.js";
import type { E2ELifecyclePhase } from "./test/e2e/reporting/e2e-reporting-types.js";
import {
  DEFAULT_E2E_ELECTRON_INSTALL_TIMEOUT_MS,
  resolveE2EElectronBinary,
} from "./test/e2e/helpers/e2e-electron-binary.js";

const DESKTOP_DIR = import.meta.dirname;

const REPO_ROOT = resolve(DESKTOP_DIR, "../..");

const E2E_ELECTRON_SERVICE_MODULE_PATH = resolve(
  DESKTOP_DIR,
  "test/e2e/helpers/e2e-electron-service.ts",
);

const E2E_LOCAL_ENV_FILES = [
  resolve(DESKTOP_DIR, ".env.e2e.local"),
  resolve(REPO_ROOT, ".env.e2e.local"),
  // 仓库不再提供共享 key：.env.e2e.local.example 只列变量名、值留空，不作为 fallback 读取。
];
loadE2ELocalEnv();

const BUILD_DESKTOP_AGENT_SCRIPT = resolve(REPO_ROOT, "scripts/build-desktop-agent-cli.mjs");

const ZCODE_CLI_ENTRYPOINT = resolve(REPO_ROOT, "apps/zcode-cli/packages/cli/dist/zcode.cjs");

const E2E_HOME_DIR = resolve(
  process.env.ZCODE_E2E_HOME_DIR?.trim() ||
    // 修复原因：多个 WDIO 本地并发时会互相清理默认 .e2e-home，导致窗口白屏、
    // DevTools 断链或登录页等待失败；默认路径保持兼容，调试时允许显式隔离。
    resolve(DESKTOP_DIR, ".e2e-home"),
);

const E2E_PACKAGED_APP_BINARY_PATH = process.env.ZCODE_E2E_PACKAGED_APP_PATH?.trim()
  ? resolve(process.env.ZCODE_E2E_PACKAGED_APP_PATH)
  : null;
const E2E_STORAGE_ROOT = resolve(E2E_HOME_DIR, ".openzwork");

const E2E_APP_CONFIG_DIR = resolve(E2E_STORAGE_ROOT, "v2");

const E2E_APP_SETTINGS_FILE = resolve(E2E_APP_CONFIG_DIR, "setting.json");

const E2E_APP_PROVIDER_CONFIG_FILE = resolve(E2E_APP_CONFIG_DIR, "provider_config.json");

const E2E_CLI_CONFIG_DIR = resolve(E2E_STORAGE_ROOT, "cli");

const E2E_CLI_CONFIG_FILE = resolve(E2E_CLI_CONFIG_DIR, "config.json");

const DESKTOP_BUILD_OUTPUT_DIR = resolve(DESKTOP_DIR, "out");

const DESKTOP_BUILD_ENTRY_POINT = resolve(DESKTOP_BUILD_OUTPUT_DIR, "main/index.js");

const E2E_RENDERER_ASSETS_DIR = resolve(DESKTOP_DIR, "out/renderer/assets");

const E2E_ELECTRON_INSTALL_TIMEOUT_MS =
  readPositiveIntegerEnv("ZCODE_E2E_ELECTRON_INSTALL_TIMEOUT_MS") ??
  DEFAULT_E2E_ELECTRON_INSTALL_TIMEOUT_MS;
const ELECTRON_APP_BINARY_PATH =
  E2E_PACKAGED_APP_BINARY_PATH ??
  resolveE2EElectronBinary({
    desktopDir: DESKTOP_DIR,
    repoRoot: REPO_ROOT,
    installTimeoutMs: E2E_ELECTRON_INSTALL_TIMEOUT_MS,
  });

const DESKTOP_PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(DESKTOP_DIR, "package.json"), "utf-8"),
) as { devDependencies?: Record<string, string> };

const ELECTRON_VERSION = DESKTOP_PACKAGE_JSON.devDependencies?.electron ?? "";

const PNPM_COMMAND = "pnpm";

const E2E_ELECTRON_APP_QUIT_TIMEOUT_MS =
  readPositiveIntegerEnv("ZCODE_E2E_ELECTRON_APP_QUIT_TIMEOUT_MS") ?? 1000;

const E2E_ELECTRON_FORCE_KILL_GRACE_MS =
  readPositiveIntegerEnv("ZCODE_E2E_ELECTRON_FORCE_KILL_GRACE_MS") ?? 3000;

const E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS =
  readPositiveIntegerEnv("ZCODE_E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS") ?? 15000;

const E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS =
  readPositiveIntegerEnv("ZCODE_E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS") ?? 5000;

const E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS =
  readPositiveIntegerEnv("ZCODE_E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS") ?? 30000;

const E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS = Math.min(
  readPositiveIntegerEnv("ZCODE_E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS") ?? 60_000,
  5 * 60_000,
);

const E2E_WEBDRIVER_REQUEST_LIMITS = resolveE2EWebDriverRequestLimits({
  retryCount: process.env.ZCODE_E2E_WEBDRIVER_REQUEST_RETRY_COUNT,
  timeoutMs: process.env.ZCODE_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS,
});

const E2E_HOME_REMOVE_RETRY_DELAYS_MS = [200, 500, 1000, 2000, 3000, 5000, 8000];

const HOST_HOME_DIR = process.env.HOME?.trim();

const HOST_USERPROFILE_DIR = process.env.USERPROFILE?.trim();

interface E2ERendererBridgePreflightResult {
  bridgeMethods: Record<string, boolean>;
  candidateHandles: string[];
  currentHandle: string | null;
  documentReadyState: string | null;
  handle: string | null;
  handles: string[];
  hasSessionBridge: boolean;
  missingBridgeMethods: string[];
  missingStateMethods: string[];
  ok: boolean;
  reason: string;
  stateMethods: Record<string, boolean>;
  targets: E2EBrowserTargetInfo[];
  url: string | null;
}

const E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS = ["getState", "setState", "subscribe"];

// 修复原因：V4 store 已移除旧 renderer-local queue/message/stop 注入方法；全局 preflight
// 若继续要求这些方法，会在正式 V4 case 执行前把健康 renderer 误判成基础设施失败。
const E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS = [
  "getWorkspaceState",
  "setSlashCommands",
  "setTaskRuntimeState",
  "upsertOptimisticTaskListItem",
];

const requestedE2ESpecs = readRequestedE2ESpecs();

const requestedE2EExcludeSpecs = readRequestedE2EExcludeSpecs();

const containerE2E = process.env.ZCODE_E2E_CONTAINER === "1";
const configuredE2ESpecs = requestedE2ESpecs.length
  ? requestedE2ESpecs
  : ["./test/e2e/**/*.test.ts"];

const e2eReporter = createE2EReporter({
  repoRoot: REPO_ROOT,
  desktopDir: DESKTOP_DIR,
  requestedSpecs: requestedE2ESpecs,
  containerE2E,
});

const e2eRunnerFinalizationGuard = createE2ERunnerFinalizationGuard({
  onTimeout: forceFinalizeE2ERunnerFromGuard,
  timeoutMs: E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS,
});
const E2E_RUN_ID = process.env.ZCODE_E2E_RUN_ID!;

const E2E_RUN_CACHE_DIR = resolve(DESKTOP_DIR, ".e2e-cache", E2E_RUN_ID);

const E2E_APP_OUTPUT_DIR = resolve(E2E_RUN_CACHE_DIR, "app");

const E2E_APP_ENTRY_POINT = resolve(E2E_APP_OUTPUT_DIR, "main/index.js");

const E2E_APP_RENDERER_ASSETS_DIR = resolve(E2E_APP_OUTPUT_DIR, "renderer/assets");

const E2E_REMOTE_ASSET_VERSION = String(
  (
    JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as {
      version?: string;
    }
  ).version ?? "",
).trim();

const E2E_REMOTE_RELEASE_SOURCE_DIR = resolve(
  DESKTOP_DIR,
  "mock-cdn",
  "releases",
  E2E_REMOTE_ASSET_VERSION,
);

const E2E_REMOTE_RELEASE_OUTPUT_DIR = resolve(
  E2E_RUN_CACHE_DIR,
  "mock-cdn",
  "releases",
  E2E_REMOTE_ASSET_VERSION,
);

const E2E_CHROMIUM_USER_DATA_ROOT_DIR = resolve(E2E_RUN_CACHE_DIR, "chromium-profiles");

const containerChromeArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--ozone-platform=x11",
  "--window-size=1440,1000",
];

let e2eRunnerExitWatchdog: ReturnType<typeof setTimeout> | null = null;

let currentE2EElectronAppPid: number | null = null;

let currentE2EWorkerSpecs: string[] = [];

let currentE2EBeforeSessionError: unknown = null;

let e2eFailureArtifacts: E2EFailureArtifactCollector | null = null;

let currentE2EWorkerSessionSpecs: string[] = [];

let currentE2EChromiumUserDataDir: string | null = null;

let closeBotEntryRelay: (() => Promise<void>) | undefined;

const e2eWorkerLifecycleStarts = new Map<string, { specs: string[]; startedAt: Date }>();

async function measureE2ELifecyclePhase<T>(
  phase: E2ELifecyclePhase,
  context: { cid?: string; specs?: string[] },
  run: () => Promise<T> | T,
): Promise<T> {
  return await runMeasuredE2ELifecyclePhase(phase, context, e2eReporter.recordLifecycleEvent, run);
}

async function runE2EDiagnosticWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function loadE2ELocalEnv() {
  for (const envFile of E2E_LOCAL_ENV_FILES) {
    if (!existsSync(envFile)) {
      continue;
    }

    const parsedEnv: Record<string, string> = {};
    const result = loadDotenv({
      path: envFile,
      processEnv: parsedEnv,
      quiet: true,
    });
    if (result.error) {
      throw new Error(`Failed to load e2e env file: ${envFile}`, {
        cause: result.error,
      });
    }
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (!process.env[key]?.trim()) {
        process.env[key] = value;
      }
    }
  }
}

function readRequestedE2ESpecs() {
  const specs = new Set<string>();
  appendRequestedE2ESpecs(specs, process.env.ZCODE_E2E_SPEC);

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--spec") {
      appendRequestedE2ESpecs(specs, process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--spec=")) {
      appendRequestedE2ESpecs(specs, arg.slice("--spec=".length));
    }
  }

  return [...specs];
}

function readRequestedE2EExcludeSpecs() {
  const specs = new Set<string>();
  appendRequestedE2ESpecs(specs, process.env.ZCODE_E2E_EXCLUDE_SPEC);

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--exclude") {
      appendRequestedE2ESpecs(specs, process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      appendRequestedE2ESpecs(specs, arg.slice("--exclude=".length));
    }
  }

  return [...specs];
}

function appendRequestedE2ESpecs(specs: Set<string>, value?: string) {
  if (!value?.trim()) {
    return;
  }

  // 修复原因：`pnpm test:e2e -- --spec <file>` 下 WDIO 仍会先加载配置；
  // 如果配置只读 ZCODE_E2E_SPEC，实际会回落到全量 spec，多个 worker 轮流重置
  // .e2e-home 后就会把 上游 flash 选择冲掉。
  for (const spec of value.split(",")) {
    const trimmed = spec.trim();
    if (trimmed) {
      specs.add(trimmed);
    }
  }
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return Math.floor(parsed);
}

function prepareDesktopAppBuild() {
  if (E2E_PACKAGED_APP_BINARY_PATH) {
    if (!existsSync(E2E_PACKAGED_APP_BINARY_PATH)) {
      throw new Error(`[e2e] packaged app binary missing: ${E2E_PACKAGED_APP_BINARY_PATH}`);
    }
    console.log(`[e2e] using packaged app: ${E2E_PACKAGED_APP_BINARY_PATH}`);
    return;
  }
  // 修复原因：WDIO 配置会先被 esbuild 解析，CI 可执行字符串必须保持 ASCII 引号。
  // 官方购买页面 fixture 已移除，复用条件只保留显式构建标记。
  if (process.env.ZCODE_E2E_SKIP_BUILD === "1") {
    console.log("[e2e] ZCODE_E2E_SKIP_BUILD=1, skipping onPrepare build");
    assertDesktopE2EBuildReady("ZCODE_E2E_SKIP_BUILD=1");
    return;
  }
  // Bugfix: 直接执行 `wdio run` 会绕过 package.json 的 pretest:e2e；只检查
  // out 文件是否存在又会跑到旧 renderer，表现成”已修复但 e2e 仍白屏/没动作”。
  // 因此 WDIO 入口始终先构建，确保测试使用当前源码对应的桌面产物。
  runPnpmWorkspaceCommand(["--filter", "@zcode/desktop", "build:no-runtime-assets"]);
  assertDesktopE2EBuildReady("onPrepare build");
}

function runPnpmWorkspaceCommand(args: string[], options?: { timeoutMs?: number }) {
  execFileSync(PNPM_COMMAND, args, {
    cwd: REPO_ROOT,
    env: createPnpmChildEnv(),
    stdio: "inherit",
    // Bug 根因：prepare:remote-assets 会在 CI 上下载 node 二进制并串行构建多个包，
    // 无 timeout 时一旦下载/构建挂死，wdio onPrepare 会一直占住专用 runner 直到 job
    // 全局超时。这里只给防挂死的宽裕上限（冷缓存全量 prepare 约 10 分钟），不参与限速；
    // 其余调用点（本地构建）保持无 timeout。
    ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    // 修复原因：Windows runner 上 `pnpm` 由 cmd shim 提供，直接 execFileSync("pnpm.cmd")
    // 在部分 CI 环境会报 spawnSync EINVAL，导致 WDIO 继续用缺失/旧产物启动 Electron。
    shell: process.platform === "win32",
  });
}

function assertDesktopE2EBuildReady(context: string) {
  if (!existsSync(DESKTOP_BUILD_ENTRY_POINT)) {
    throw new Error(
      `[e2e] ${context}: desktop main entrypoint missing: ${DESKTOP_BUILD_ENTRY_POINT}`,
    );
  }

  if (!isRendererE2EStoreBridgeCompiled(E2E_RENDERER_ASSETS_DIR)) {
    throw new Error(`[e2e] ${context}: renderer build is missing VITE_ZCODE_E2E_STORE_BRIDGE=1`);
  }
}

async function stageDesktopE2EAppOutput() {
  await rm(E2E_APP_OUTPUT_DIR, { force: true, recursive: true });
  // 修复原因：开发态 pre-dev/tsup watch 会重建共享 packages/desktop/out；长批次若直接
  // 从 out 启动，运行中目录被清空后后续 loadFile 会进入 chrome-error://。构建完成后
  // 按 runId 复制不可变应用产物，让 E2E 与并行开发进程彻底隔离。
  // 使用写时复制降低多 shard 的准备成本；不能使用共享 inode 的硬链接，否则类型检查
  // 原地覆盖 out/host 时会同时破坏已经启动的隔离副本。
  await stageE2EAppOutput(DESKTOP_BUILD_OUTPUT_DIR, E2E_APP_OUTPUT_DIR);
  if (
    hasRequiredSshE2EEnvironment(process.env) ||
    process.env.ZCODE_E2E_SSH_HOST?.trim() ||
    process.env.ZCODE_E2E_SSH_A_HOST?.trim() ||
    process.env.ZCODE_E2E_SSH_B_HOST?.trim()
  ) {
    // Bug 根因：CI 只有 build:remote:assets job 产出 mock-cdn/releases/<version>，且跑在通用
    // macos runner 槽位；conversation e2e 在专用 runner 上，mock-cdn 工作区持久化目录互不
    // 相通，版本 bump 后专用 runner 必然缺新版本 release，直接 fatal 会把每次升级变成
    // CI-only 失败。改为缺目录时自动跑 prepare:remote-assets（幂等），产出后仍缺失才
    // fail-closed。
    // Bug 根因：packages/desktop 的 prepare:remote-assets 已随 legacy asset pipeline 一并删除，
    // `pnpm --filter @zcode/desktop prepare:remote-assets` 会以 ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT
    // 失败并让所有 SSH E2E 在 onPrepare 阶段 fatal；必须调用根 package.json 的
    // prepare:remote-assets（→ @zcode/server-cli stage:remote-assets）。runPnpmWorkspaceCommand
    // 的 cwd 固定为 REPO_ROOT，直接传脚本名即可命中根脚本。
    ensureSshRemoteReleaseAssets({
      releaseDir: E2E_REMOTE_RELEASE_SOURCE_DIR,
      prepareReleaseAssets: () =>
        runPnpmWorkspaceCommand(["prepare:remote-assets"], {
          // 防挂死上限：冷缓存全量 prepare 约 10 分钟，给到 30 分钟只兑现在「彻底卡死」时
          // 让 onPrepare 失败退出，正常慢路径不受影响。
          timeoutMs: 30 * 60 * 1000,
        }),
    });
    // Bug 根因：dual-SSH case 只配置 A/B target；若这里只识别 common host，就不会把
    // 当前源码构建的 remote release 放进 runId 隔离目录，远端会继续复用同版本的旧
    // server bundle，并用旧协议 schema 拒绝 enabledSource 等新字段。
    await stageE2EAppOutput(E2E_REMOTE_RELEASE_SOURCE_DIR, E2E_REMOTE_RELEASE_OUTPUT_DIR);
  }
  if (!existsSync(E2E_APP_ENTRY_POINT)) {
    throw new Error(`[e2e] staged desktop main entrypoint missing: ${E2E_APP_ENTRY_POINT}`);
  }
  if (!isRendererE2EStoreBridgeCompiled(E2E_APP_RENDERER_ASSETS_DIR)) {
    throw new Error("[e2e] staged renderer is missing VITE_ZCODE_E2E_STORE_BRIDGE=1");
  }
}

function isRendererE2EStoreBridgeCompiled(rendererAssetsDir: string) {
  if (!existsSync(rendererAssetsDir)) {
    return false;
  }

  return readdirSync(rendererAssetsDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      return false;
    }

    const source = readFileSync(resolve(rendererAssetsDir, entry.name), "utf-8");
    return /["'\x60]?VITE_ZCODE_E2E_STORE_BRIDGE["'\x60]?\s*:\s*["'\x60]1["'\x60]/u.test(source);
  });
}

function createPnpmChildEnv() {
  // Bugfix: WDIO 为加载 TypeScript config 会通过 NODE_OPTIONS 注入 tsx loader。
  // pnpm 11 继承该 loader 后会误尝试加载仓库根不存在的 .pnpmfile.mjs，
  // 导致 onPrepare 构建报错；子 pnpm 只负责执行 workspace script，不需要继承它。
  const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  return {
    ...env,
    // Bugfix: WDIO 会把 HOME/USERPROFILE 改到 .e2e-home 隔离应用数据；
    // 但 onPrepare 的子 pnpm 需要真实用户目录里的 corepack/nvm 缓存，否则
    // CI 清理 .e2e-home 后会找不到 corepack 管理的 pnpm.mjs。
    ...(HOST_HOME_DIR ? { HOME: HOST_HOME_DIR } : {}),
    ...(HOST_USERPROFILE_DIR ? { USERPROFILE: HOST_USERPROFILE_DIR } : {}),
    // Bugfix: agent 构建脚本会进入 apps/zcode-cli 子 workspace；pnpm 11 的
    // verify-deps-before-run 会触发子 workspace install，但该 workspace 运行时
    // 依赖根仓库 @zcode/shared，自动 install 无法解析，必须在 E2E 构建链路关闭。
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    // 修复原因：E2E 依赖 renderer 暴露 store bridge；只在 WDIO 构建链路显式注入，
    // 避免普通 production/test 产品构建意外暴露可变全局 store。
    VITE_ZCODE_E2E_STORE_BRIDGE: "1",
    ZCODE_DESKTOP_AGENT_BUILD_MODE: env.ZCODE_DESKTOP_AGENT_BUILD_MODE ?? "pnpm",
  };
}

function prepareZCodeAgentServer() {
  if (E2E_PACKAGED_APP_BINARY_PATH) {
    // 真正的 Preview 包必须使用随包 Agent，禁止测试 runner 注入源码入口掩盖漏打包。
    configureZCodeAgentServerEnv();
    return;
  }
  if (process.env.ZCODE_E2E_SKIP_AGENT_BUILD === "1") {
    // 修复原因：Windows 全量 E2E 分片由父 runner 统一构建一次 agent；子 WDIO 若再次构建，
    // 会并发覆盖同一 dist 目录。跳过时仍校验入口，避免旧或缺失产物静默启动。
    console.log("[e2e] ZCODE_E2E_SKIP_AGENT_BUILD=1, skipping agent build");
    if (!existsSync(ZCODE_CLI_ENTRYPOINT)) {
      throw new Error(`ZCode CLI entrypoint not found: ${ZCODE_CLI_ENTRYPOINT}`);
    }
    configureZCodeAgentServerEnv();
    return;
  }

  // Bugfix: e2e 还在找仓库外的旧原生 zcode-agent binary，并调用已经删除的
  // `build:agent-exe`。当前桌面端统一通过 zcode-cli 的 app-server JS bundle
  // 暴露 ZCode Protocol，这里复用正式开发入口的构建脚本，之后由 bundled resolver
  // 选择已校验的 bundle，保留存储准备能力和正式桌面启动契约。
  execFileSync(process.execPath, [BUILD_DESKTOP_AGENT_SCRIPT], {
    cwd: REPO_ROOT,
    env: createPnpmChildEnv(),
    stdio: "inherit",
  });

  if (!existsSync(ZCODE_CLI_ENTRYPOINT)) {
    throw new Error(`ZCode CLI entrypoint not found: ${ZCODE_CLI_ENTRYPOINT}`);
  }

  configureZCodeAgentServerEnv();
}

function configureZCodeAgentServerEnv() {
  // 数据库准备只信任 bundled resolver 确认的入口。E2E 即使把本轮 bundle 填进自定义
  // command，也会按 unsupported_runtime 拒绝；清除继承的覆盖，复用正式桌面解析链。
  delete process.env.ZCODE_AGENT_SERVER_COMMAND;
  delete process.env.ZCODE_AGENT_SERVER_ARGS_JSON;
  delete process.env.ZCODE_AGENT_SERVER_CWD;
}

async function armCurrentElectronAppQuit(stage: string) {
  currentE2EElectronAppPid = null;
  try {
    const result = (await browser.electron.execute((electron) => {
      const currentAppPid = process.pid;
      const appName = electron.app.getName();
      if (appName !== "ZCode E2E") {
        return {
          appName,
          appPid: currentAppPid,
          armedWindowCount: 0,
        };
      }

      const appWindows = electron.BrowserWindow.getAllWindows();
      let quitRequested = false;
      const requestQuitAfterDriverClose = () => {
        if (quitRequested || electron.BrowserWindow.getAllWindows().length > 0) {
          return;
        }
        quitRequested = true;
        electron.app.quit();
      };

      // 修复原因：after 里直接 app.quit 会让 renderer 先于 ChromeDriver 的
      // deleteSession 消失，ChromeDriver 随后会对失效 browsing context 等待超时。
      // 这里只给当前进程、当前窗口挂一次性监听；由 deleteSession 先关闭窗口，
      // 再走 app.quit 的 before-quit 链路回收 host/agent。没有跨 session 的 timer。
      for (const appWindow of appWindows) {
        appWindow.once("closed", requestQuitAfterDriverClose);
      }
      return {
        appName,
        appPid: currentAppPid,
        armedWindowCount: appWindows.length,
      };
    })) as {
      appName?: string;
      appPid?: number;
      armedWindowCount?: number;
    };

    currentE2EElectronAppPid = typeof result.appPid === "number" ? result.appPid : null;
    if (!result.armedWindowCount) {
      writeE2ECleanupWarning(
        `${stage}: skip app quit barrier because current Electron app is ${result.appName ?? "unknown"} or has no windows`,
      );
      return;
    }
  } catch (error) {
    writeE2ECleanupWarning(`${stage}: app quit barrier failed: ${formatErrorMessage(error)}`);
  }
}

async function cleanupE2EElectronProcesses(
  stage: string,
  {
    requireExit = false,
    waitForGracefulExit = false,
  }: { requireExit?: boolean; waitForGracefulExit?: boolean } = {},
) {
  try {
    // 修复原因：after 已记录当前 Electron 主 PID；常规路径先按已知根进程等待/回收，
    // 避免每个 worker 在高并发下重复启动 PowerShell/CIM 扫描整机进程树。
    // 最后的 runId/HOME 扫描仍是严格屏障，会捕获主进程退出后遗留的 host/agent。
    let targetPids =
      currentE2EElectronAppPid !== null && isProcessAlive(currentE2EElectronAppPid)
        ? [currentE2EElectronAppPid]
        : listCurrentE2EProcessPids();
    if (waitForGracefulExit && targetPids.length > 0) {
      // 修复原因：app.quit 发出时 ChromeDriver 仍持有 session，主进程通常要到
      // deleteSession 后才能退出；afterSession 才是等待自然退出的正确屏障位置。
      await waitForProcessesExit(targetPids, E2E_ELECTRON_APP_QUIT_TIMEOUT_MS);
      targetPids = targetPids.filter((pid) => isProcessAlive(pid));
      if (targetPids.length === 0) {
        targetPids = listCurrentE2EProcessPids();
      }
    }
    if (targetPids.length === 0) {
      return;
    }

    writeE2ECleanupWarning(
      `${stage}: force terminating leftover Electron e2e pids=${targetPids.join(",")}`,
    );
    if (process.platform === "win32") {
      forceTerminateWindowsProcesses(targetPids);
      await waitForProcessesExit(targetPids, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
    } else {
      terminatePosixProcesses(targetPids, "SIGTERM");
      await waitForProcessesExit(targetPids, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
      const remainingAfterTerm = targetPids.filter((pid) => isProcessAlive(pid));
      terminatePosixProcesses(remainingAfterTerm, "SIGKILL");
      await waitForProcessesExit(remainingAfterTerm, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
    }

    const remainingPids = listCurrentE2EProcessPids();
    if (remainingPids.length > 0) {
      throw new Error(`E2E process exit barrier failed, remaining pids=${remainingPids.join(",")}`);
    }
  } catch (error) {
    writeE2ECleanupWarning(
      `${stage}: leftover Electron cleanup failed: ${formatErrorMessage(error)}`,
    );
    if (requireExit) {
      throw error;
    }
  }
}

function listCurrentE2EProcessPids() {
  const detectedPids = listE2EProcessTreePids({
    chromiumProfileRootDir: E2E_CHROMIUM_USER_DATA_ROOT_DIR,
    homeDir: E2E_HOME_DIR,
    runId: E2E_RUN_ID,
  });
  if (
    currentE2EElectronAppPid !== null &&
    currentE2EElectronAppPid !== process.pid &&
    isProcessAlive(currentE2EElectronAppPid)
  ) {
    detectedPids.push(currentE2EElectronAppPid);
  }
  return [...new Set(detectedPids)];
}

async function cleanupE2EDirectory(stage: string, userDataDir: string, requireRemoved = false) {
  try {
    await rm(userDataDir, {
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      recursive: true,
      retryDelay: 300,
    });
    if (existsSync(userDataDir)) {
      throw new Error(`E2E directory still exists: ${userDataDir}`);
    }
  } catch (error) {
    writeE2ECleanupWarning(
      `${stage}: E2E directory cleanup failed (${userDataDir}): ${formatErrorMessage(error)}`,
    );
    if (requireRemoved) {
      throw error;
    }
  }
}

function forceTerminateWindowsProcesses(pids: number[]) {
  if (pids.length === 0) {
    return;
  }
  try {
    // 修复原因：目标集合包含同一 Electron 树的父子 PID；逐 PID 执行 `/T`
    // 会重复递归终止同一棵树，并在多 shard 下放大 taskkill 进程创建开销。
    execFileSync("taskkill", buildWindowsTaskkillArgs(pids), {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    const alivePids = pids.filter((pid) => isProcessAlive(pid));
    if (alivePids.length > 0) {
      writeE2ECleanupWarning(
        `taskkill failed for pids=${alivePids.join(",")}: ${formatErrorMessage(error)}`,
      );
    }
  }
}

function terminatePosixProcesses(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (isProcessAliveError(error)) {
        writeE2ECleanupWarning(`${signal} failed for pid=${pid}: ${formatErrorMessage(error)}`);
      }
    }
  }
}

async function waitForProcessesExit(pids: number[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isProcessAlive(pid))) {
      return true;
    }
    await delay(100);
  }
  return pids.every((pid) => !isProcessAlive(pid));
}

async function runE2ERendererBridgePreflight(specs: string[] = []) {
  const attempt = await waitForE2ERendererBridgePreflight();
  if (!attempt.error) {
    return;
  }

  // Bug 根因：hook 内 reloadSession 不会先等待旧 Electron 进程树退出，旧 target 与
  // 新 session 会再次争用 ContextId。启动失败必须交给 worker/afterSession 完整清理。
  throw createE2ERendererBridgePreflightError(attempt.latest, specs, attempt.error, false);
}

async function waitForE2ERendererBridgePreflight(): Promise<{
  error: unknown | null;
  latest: E2ERendererBridgePreflightResult | null;
}> {
  let latest: E2ERendererBridgePreflightResult | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await inspectE2ERendererBridgePreflight();
        return latest.ok;
      },
      {
        interval: 250,
        timeout: E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS,
        timeoutMsg: "E2E renderer bridge preflight timed out",
      },
    );
    return { error: null, latest };
  } catch (error) {
    return { error, latest: latest as E2ERendererBridgePreflightResult | null };
  }
}

function createE2ERendererBridgePreflightError(
  lastResult: E2ERendererBridgePreflightResult | null,
  specs: string[],
  cause: unknown,
  recoveryAttempted: boolean,
): Error {
  return new Error(
    [
      "e2e-bridge-preflight infra failure",
      `reason=${lastResult?.reason ?? "unknown"}`,
      `url=${lastResult?.url ?? "unknown"}`,
      `readyState=${lastResult?.documentReadyState ?? "unknown"}`,
      `currentHandle=${lastResult?.currentHandle ?? "unknown"}`,
      `handles=${JSON.stringify(lastResult?.handles ?? [])}`,
      `candidateHandles=${JSON.stringify(lastResult?.candidateHandles ?? [])}`,
      `targets=${JSON.stringify(lastResult?.targets ?? [])}`,
      `missingBridgeMethods=${JSON.stringify(lastResult?.missingBridgeMethods ?? [])}`,
      `missingStateMethods=${JSON.stringify(lastResult?.missingStateMethods ?? [])}`,
      `recoveryAttempted=${recoveryAttempted}`,
      `specs=${JSON.stringify(specs)}`,
      `cause=${formatErrorMessage(cause)}`,
    ].join("; "),
  );
}

async function inspectE2ERendererBridgePreflight(): Promise<E2ERendererBridgePreflightResult> {
  const handles = await browser.getWindowHandles();
  const targets = await getE2EBrowserTargetInfo().catch(() => []);
  const candidates = collectE2EWebDriverPageHandleCandidates(handles, targets);
  const fallback: E2ERendererBridgePreflightResult = {
    bridgeMethods: {},
    candidateHandles: candidates.map((candidate) => candidate.handle),
    currentHandle: await browser.getWindowHandle().catch(() => null),
    documentReadyState: null,
    handle: null,
    handles,
    hasSessionBridge: false,
    missingBridgeMethods: E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS,
    missingStateMethods: E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS,
    ok: false,
    reason:
      handles.length === 0
        ? "renderer-handle-missing"
        : candidates.length === 0
          ? "renderer-page-handle-intersection-missing"
          : "renderer-url-missing",
    stateMethods: {},
    targets,
    url: null,
  };

  let latest = fallback;
  for (const candidate of candidates) {
    const handle = candidate.handle;
    try {
      await browser.switchToWindow(handle);
      const currentHandle = await browser.getWindowHandle().catch(() => null);
      if (currentHandle !== handle) {
        latest = {
          ...fallback,
          currentHandle,
          handle,
          reason: "renderer-handle-switch-mismatch",
        };
        continue;
      }
      const result = (await browser.execute(
        (requiredBridgeMethods, requiredStateMethods) => {
          const bridge = (
            window as typeof window & {
              __zcodeSessionStoreE2E?: Record<string, unknown> & {
                getState?: () => Record<string, unknown>;
                setState?: (...args: unknown[]) => unknown;
                subscribe?: (...args: unknown[]) => unknown;
              };
            }
          ).__zcodeSessionStoreE2E;
          const bridgeMethods = Object.fromEntries(
            requiredBridgeMethods.map((method) => [method, typeof bridge?.[method] === "function"]),
          ) as Record<string, boolean>;
          const missingBridgeMethods = requiredBridgeMethods.filter(
            (method) => !bridgeMethods[method],
          );
          const state =
            typeof bridge?.getState === "function"
              ? (() => {
                  try {
                    return bridge.getState?.() ?? null;
                  } catch {
                    return null;
                  }
                })()
              : null;
          const stateMethods = Object.fromEntries(
            requiredStateMethods.map((method) => [
              method,
              Boolean(state && typeof state[method] === "function"),
            ]),
          ) as Record<string, boolean>;
          const missingStateMethods = requiredStateMethods.filter(
            (method) => !stateMethods[method],
          );
          const url = window.location.href;
          const isRendererUrl = url.includes("/renderer/index.html");
          const hasSessionBridge = Boolean(bridge);
          const ok =
            isRendererUrl &&
            hasSessionBridge &&
            missingBridgeMethods.length === 0 &&
            missingStateMethods.length === 0;
          const reason = !isRendererUrl
            ? "renderer-url-missing"
            : !hasSessionBridge
              ? "session-bridge-missing"
              : missingBridgeMethods.length > 0
                ? "session-bridge-method-missing"
                : missingStateMethods.length > 0
                  ? "session-state-method-missing"
                  : "ok";

          return {
            bridgeMethods,
            documentReadyState: document.readyState,
            hasSessionBridge,
            missingBridgeMethods,
            missingStateMethods,
            ok,
            reason,
            stateMethods,
            url,
          };
        },
        E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS,
        E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS,
      )) as Omit<
        E2ERendererBridgePreflightResult,
        "candidateHandles" | "currentHandle" | "handle" | "handles" | "targets"
      >;
      latest = {
        ...result,
        candidateHandles: fallback.candidateHandles,
        currentHandle,
        handle,
        handles,
        targets,
      };
      if (latest.ok || latest.url?.includes("/renderer/index.html")) {
        // 修复原因：electron service 的自动聚焦也读取该 handle；只有经过
        // ChromeDriver handle 表和实际 renderer URL 双重校验后才允许更新。
        (
          browser.electron as typeof browser.electron & {
            windowHandle?: string;
          }
        ).windowHandle = handle;
        return latest;
      }
    } catch (error) {
      latest = {
        ...fallback,
        handle,
        reason: `renderer-preflight-execute-failed:${formatErrorMessage(error)}`,
      };
    }
  }

  return latest;
}

async function getE2EBrowserTargetInfo(): Promise<E2EBrowserTargetInfo[]> {
  const puppeteer = await browser.getPuppeteer();
  return puppeteer.targets().map((target) => ({
    id: (target as unknown as { _targetId?: string })._targetId ?? null,
    type: target.type(),
    url: target.url(),
  }));
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isProcessAliveError(error);
  }
}

function isProcessAliveError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code !== "ESRCH",
  );
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, Math.max(ms, 0));
    timer.unref?.();
  });
}

function writeE2ECleanupWarning(message: string) {
  process.stderr.write(`[desktop-e2e-cleanup] ${message}\n`);
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function armE2ERunnerExitWatchdog(exitCode: number) {
  if (e2eRunnerExitWatchdog) {
    clearTimeout(e2eRunnerExitWatchdog);
  }

  // 修复原因：Electron 和 replay server 都清理完后，WDIO CLI 仍可能被历史
  // handle 卡住，形成 conversation-session 这类孤儿进程；正常退出不会触发该兜底。
  e2eRunnerExitWatchdog = setTimeout(() => {
    writeE2ECleanupWarning(
      `onComplete: forcing WDIO runner exit after ${E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS}ms`,
    );
    process.exit(exitCode);
  }, E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS);
  e2eRunnerExitWatchdog.unref?.();
}
function forceFinalizeE2ERunnerFromGuard() {
  writeE2ECleanupWarning(
    `finalization guard: onComplete did not start within ${E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS}ms`,
  );
  try {
    // Bug 根因：历史 full run 在 122 个 worker 结束后静默退出 0，onComplete 没有
    // 写 summary。guard 超时先同步保全已有 NDJSON 的失败汇总，再做 best-effort 清理。
    e2eReporter.writeSummary(1);
  } catch (error) {
    writeE2ECleanupWarning(
      `finalization guard: summary recovery failed: ${formatErrorMessage(error)}`,
    );
  }
  armE2ERunnerExitWatchdog(1);

  const cleanupKeepAlive = setInterval(() => {}, 1000);
  void (async () => {
    try {
      await cleanupE2EElectronProcesses("finalization-guard");
      // 失败保留诊断现场（同 onComplete-home 条件）：guard 路径本身就是失败收尾。
      if (process.env.ZCODE_E2E_KEEP_HOME_ON_FAIL === "1") {
        console.warn(`[e2e] finalization guard keeping failure home: ${E2E_HOME_DIR}`);
      } else {
        await cleanupE2EDirectory("finalization-guard-home", E2E_HOME_DIR);
      }
      await cleanupE2EDirectory("finalization-guard-cache", E2E_RUN_CACHE_DIR);
    } catch (error) {
      writeE2ECleanupWarning(
        `finalization guard: emergency cleanup failed: ${formatErrorMessage(error)}`,
      );
    } finally {
      clearInterval(cleanupKeepAlive);
      process.exit(1);
    }
  })();
}
async function resetE2EHome(specs: string[]) {
  await removeE2EHomeWithRetry();
  await mkdir(E2E_APP_CONFIG_DIR, { recursive: true });
  await mkdir(resolve(E2E_STORAGE_ROOT, "workspace/default"), { recursive: true });
  const settings: Partial<AppSettings> = { locale: "en-US" };
  if (specs.some((spec) => spec.endsWith("side-pane-full-view.test.ts"))) {
    // 完整视图测试需要固定项目 cwd；产品首次启动只建立 conversation workspace，
    // 不再隐式创建 ZCodeProject，因此由这两个 spec 的夹具显式声明恢复项目。
    const workspacePath = resolve(E2E_HOME_DIR, "ZCodeProject");
    await mkdir(workspacePath, { recursive: true });
    settings.lastWorkspaceSession = [{ kind: "local", workspacePath, workspacePurpose: "project" }];
    settings.lastActiveTabIndex = 0;
  }
  await writeFile(E2E_APP_SETTINGS_FILE, JSON.stringify(settings));
  seedE2EWorkerModelStreamConfig(specs);
  // 小窗口只用于显式 Compact 场景；普通未读与重连用例需要完整历史。
  const autoCompactSpec = specs.some((spec) =>
    [
      "conversation-session-compact-auto.test.ts",
      "conversation-session-compact-auto-actions.test.ts",
      "conversation-session-goal-run-cases.test.ts",
      "conversation-session-model-switch-auto-compact.test.ts",
    ].some((name) => spec.endsWith(name)),
  );
  const upstreamE2EContextWindowOverride = readPositiveIntegerEnv(
    "ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW",
  );
  const contextWindow = upstreamE2EContextWindowOverride ?? (autoCompactSpec ? 240 : 128000);
  const maxOutputTokens =
    readPositiveIntegerEnv("ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS") ??
    (autoCompactSpec ? 80 : undefined);
  const baseURL = process.env.E2E_PROVIDER_BASE_URL?.trim();
  const model = process.env.E2E_PROVIDER_MODEL?.trim();
  if (!baseURL || !model) return;
  const id = process.env.E2E_PROVIDER_ID?.trim() || "e2e-personal";
  await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, {
    id,
    label: process.env.E2E_PROVIDER_NAME?.trim() || "E2E Personal",
    apiFormat: "openai-chat-completions",
    apiKey: process.env.E2E_PROVIDER_API_KEY?.trim() || "",
    baseURL,
    models: [
      { id: model, contextWindow, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) },
    ],
  });
  await seedPersonalDefaultModelSelection(E2E_APP_PROVIDER_CONFIG_FILE, {
    providerId: id,
    modelId: model,
  });
}

async function removeE2EHomeWithRetry() {
  for (let attempt = 0; attempt <= E2E_HOME_REMOVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rm(E2E_HOME_DIR, {
        force: true,
        maxRetries: process.platform === "win32" ? 3 : 1,
        recursive: true,
        retryDelay: 500,
      });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt === E2E_HOME_REMOVE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      // 修复原因：Windows 会短暂保留 SQLite WAL/SHM 文件句柄；先兜底清掉遗留 Electron/host，
      // 再退避重试，避免 beforeSession 因上一轮 app 退出慢而重置失败。
      await cleanupE2EElectronProcesses(`beforeSession-remove-home-attempt-${attempt + 1}`);
      await delay(E2E_HOME_REMOVE_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}

function isRetryableRemoveError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["EBUSY", "ENOTEMPTY", "EPERM"].includes(String((error as { code?: unknown }).code)),
  );
}

function seedE2EWorkerModelStreamConfig(specs: string[] = []) {
  const modelStreamIdleTimeoutMs = resolveE2EWorkerModelStreamIdleTimeoutMs(specs);
  if (modelStreamIdleTimeoutMs === undefined) return;
  mkdirSync(E2E_CLI_CONFIG_DIR, { recursive: true });
  writeFileSync(
    E2E_CLI_CONFIG_FILE,
    JSON.stringify({ modelStream: { idleTimeoutMs: modelStreamIdleTimeoutMs } }, null, 2),
    "utf-8",
  );
}

Object.assign(process.env, {
  HOME: E2E_HOME_DIR,
  USERPROFILE: E2E_HOME_DIR,
  ZCODE_DATA_BASE_DIR: E2E_HOME_DIR,
  ZCODE_DESKTOP_HOME_DIR: E2E_HOME_DIR,
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: resolve(REPO_ROOT, "config/provider/zcode-builtin.json"),
  ZCODE_DESKTOP_APPLICATION_NAME: "ZCode E2E",
  VITE_ZCODE_E2E_STORE_BRIDGE: "1",
  ZCODE_E2E_HOME_DIR: E2E_HOME_DIR,
  ZCODE_E2E_RUN_ID: E2E_RUN_ID,
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
});
export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  reporters: ["spec"],
  maxInstances: 1,
  connectionRetryCount: E2E_WEBDRIVER_REQUEST_LIMITS.retryCount,
  connectionRetryTimeout: E2E_WEBDRIVER_REQUEST_LIMITS.timeoutMs,
  runnerEnv: {
    HOME: E2E_HOME_DIR,
    USERPROFILE: E2E_HOME_DIR,
    ZCODE_DATA_BASE_DIR: E2E_HOME_DIR,
    ZCODE_DESKTOP_HOME_DIR: E2E_HOME_DIR,
    ZCODE_E2E_HOME_DIR: E2E_HOME_DIR,
    ZCODE_E2E_RUN_ID: E2E_RUN_ID,
    ZCODE_E2E_ARTIFACT_DIR: e2eReporter.artifactDir,
    ZCODE_E2E_DEFER_APP_DATA_CLEANUP: "1",
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: resolve(REPO_ROOT, "config/provider/zcode-builtin.json"),
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode E2E",
    ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "1",
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    VITE_ZCODE_E2E_STORE_BRIDGE: "1",
    ZCODE_ENV: "test",
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => key.startsWith("E2E_PROVIDER_") && value !== undefined,
      ),
    ),
  },
  services: [[E2E_ELECTRON_SERVICE_MODULE_PATH, { rootDir: DESKTOP_DIR }]],
  capabilities: [
    {
      browserName: "electron",
      browserVersion: ELECTRON_VERSION,
      "wdio:electronServiceOptions": {
        appArgs: [
          ...(E2E_PACKAGED_APP_BINARY_PATH ? [] : [`--app=${E2E_APP_ENTRY_POINT}`]),
          "--no-sandbox",
          buildE2ERunIdArg(E2E_RUN_ID),
          createWindowsE2EHomeMarkerArg(E2E_HOME_DIR),
        ],
        appBinaryPath: ELECTRON_APP_BINARY_PATH,
      },
      "goog:chromeOptions": {
        windowTypes: ["page"],
        args: [...(containerE2E ? containerChromeArgs : [])],
      },
    },
  ],
  ...(containerE2E ? { autoXvfb: true, xvfbAutoInstall: false } : {}),
  specs: configuredE2ESpecs,
  exclude: [
    "./test/e2e/manual-review/**",
    "./test/e2e/upstream-provider.test.ts",
    ...resolveEnvironmentGatedFormalSpecExcludes({
      env: process.env,
      targeted: requestedE2ESpecs.length > 0,
    }),
    ...requestedE2EExcludeSpecs,
  ],
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
    rootHooks: createE2ERendererBridgeRootHooks(
      async () => {
        await measureE2ELifecyclePhase(
          "before-suite",
          { specs: currentE2EWorkerSpecs },
          async () => {
            await runE2ERendererBridgePreflight(currentE2EWorkerSpecs);
          },
        );
      },
      () => currentE2EBeforeSessionError,
    ),
  },
  async onPrepare() {
    try {
      e2eReporter.prepare(configuredE2ESpecs);
      await measureE2ELifecyclePhase("prepare", { specs: configuredE2ESpecs }, async () => {
        await cleanupE2EElectronProcesses("onPrepare");
        prepareDesktopAppBuild();
        if (!E2E_PACKAGED_APP_BINARY_PATH) await stageDesktopE2EAppOutput();
        prepareZCodeAgentServer();
      });
    } catch (error) {
      console.error("[e2e] fatal onPrepare failure", error);
      process.exit(1);
    }
  },
  async beforeSession(_config, capabilities, specs, cid) {
    currentE2EWorkerSessionSpecs = specs;
    currentE2EBeforeSessionError = null;
    currentE2EChromiumUserDataDir = resolveE2EWorkerChromiumProfileDir(
      E2E_CHROMIUM_USER_DATA_ROOT_DIR,
      cid,
    );
    const cap = capabilities as { "goog:chromeOptions"?: { args?: string[] } };
    const chrome = cap["goog:chromeOptions"] ?? {};
    chrome.args = replaceChromeUserDataDirArg(chrome.args ?? [], currentE2EChromiumUserDataDir);
    cap["goog:chromeOptions"] = chrome;
    try {
      await measureE2ELifecyclePhase("before-session", { cid, specs }, async () => {
        await cleanupE2EElectronProcesses("beforeSession-start", { requireExit: true });
        if (specs.some((spec) => spec.endsWith("conversation-session-r3-subagent.test.ts"))) {
          process.env.ZCODE_DYNAMIC_WORKFLOW_MODE = "alwaysOn";
        }
        configureZCodeAgentServerEnv();
        e2eReporter.beforeSession(cid, specs);
        await resetE2EHome(specs);
        if (specs.some((spec) => spec.endsWith("feishu-runtime-error-ui.test.ts"))) {
          // CF-01 的 Bots 入口会启动远控；在 Electron 读取 env 前提供隔离 relay，
          // 避免无关的空 URL 错误污染该用例，也不改变其它场景的连接配置。
          const relay = await createLocalPairingRelay();
          const envPatch = {
            ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL: relay.wsUrl,
            ZCODE_WEB_REMOTE_CONTROL_URL: `${relay.httpUrl}/remote/v4`,
          };
          const previous = Object.fromEntries(
            Object.keys(envPatch).map((key) => [key, process.env[key]]),
          );
          Object.assign(process.env, envPatch);
          closeBotEntryRelay = async () => {
            try {
              await relay.close();
            } finally {
              for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
              }
            }
          };
        }
      });
    } catch (error) {
      currentE2EBeforeSessionError = error ?? new Error("beforeSession setup failed");
    }
  },
  async before(_capabilities, specs) {
    // Bug 根因：WDIO 将项目与 wdio-electron-service 的 before hooks 放进 Promise.all；
    // 这里发 renderer/CDP 命令会与 service 的 ContextId、Puppeteer 和窗口初始化竞态。
    // before 只保存 worker 归属，browser 命令统一延后到 Mocha root hook 时序屏障。
    currentE2EWorkerSpecs = specs;
  },
  async beforeTest(test) {
    // 修复原因：当前 Electron runner 的 before hook 阶段 `browser.electron`
    // 还没注入；等到 beforeTest 再启动采样，才能持续调用 electron.execute。
    await e2eReporter.startUICoverage(browser);
    await e2eReporter.startProcessSampling(browser, currentE2EWorkerSpecs);
    e2eFailureArtifacts ??= new E2EFailureArtifactCollector({
      artifactDir: e2eReporter.artifactDir,
      browser,
    });
    try {
      await e2eFailureArtifacts.start(test);
    } catch (error) {
      // 修复原因：诊断产物的初始化失败不能让 beforeTest 变成新的 E2E 失败根因。
      console.warn("[e2e] failure artifact collection could not start", error);
    }
  },
  async beforeCommand(commandName) {
    if (commandName !== "refresh") {
      return;
    }
    try {
      // 修复原因：renderer 刷新会重建 globalThis.__coverage__；必须在页面销毁前
      // 合并本轮 counter，否则刷新前已走过的交互会从 suite 覆盖率中消失。
      await e2eReporter.snapshotUICoverage();
    } catch (error) {
      console.warn("[e2e-coverage] renderer pre-refresh snapshot failed", error);
    }
  },
  async after(_result, _capabilities, specs) {
    await measureE2ELifecyclePhase("after", { specs }, async () => {
      try {
        await e2eReporter.stopProcessSampling(browser, specs);
        await e2eReporter.stopUICoverage();
      } finally {
        // 先让 ChromeDriver 正常关闭 renderer；同进程的 closed 监听再触发
        // app.quit，afterSession 最后验证整个进程树已经退出。
        await armCurrentElectronAppQuit("after");
        currentE2EWorkerSpecs = [];
      }
    });
  },
  async afterTest(test, _context, result) {
    let failureArtifacts;
    const collectionErrors: string[] = [];
    try {
      // Mocha suite after 里的 clearAppData 会先退出 Electron；afterTest 是读取
      // renderer coverage 的最后稳定时机，WDIO after 只保留失败兜底。
      await e2eReporter.stopUICoverage();
    } catch (error) {
      console.warn("[e2e-coverage] renderer snapshot failed", error);
      collectionErrors.push(
        `renderer coverage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      failureArtifacts = await runE2EDiagnosticWithTimeout(
        async () =>
          e2eFailureArtifacts?.complete(test, {
            ...result,
            errorCategory: result.passed
              ? undefined
              : classifyError(
                  result.error instanceof Error ? result.error.message : String(result.error ?? ""),
                ),
          }),
        E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS,
        "E2E failure artifact collection",
      );
    } catch (error) {
      // 修复原因：失败证据采集属于诊断补充，采集器自身异常不能掩盖原始 E2E 失败。
      console.warn("[e2e] failure artifact collection failed", error);
      collectionErrors.push(
        `failure artifacts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    e2eReporter.recordTestResult(test, result, failureArtifacts, collectionErrors);
  },
  onWorkerStart(cid, _caps, specs) {
    e2eRunnerFinalizationGuard.disarm();
    e2eWorkerLifecycleStarts.set(cid, {
      specs,
      startedAt: new Date(),
    });
  },
  onWorkerEnd(cid, exitCode, specs) {
    e2eRunnerFinalizationGuard.arm();
    const workerLifecycle = e2eWorkerLifecycleStarts.get(cid);
    if (!workerLifecycle) {
      return;
    }
    e2eWorkerLifecycleStarts.delete(cid);
    const completedAt = new Date();
    e2eReporter.recordLifecycleEvent({
      cid,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - workerLifecycle.startedAt.getTime(),
      error: exitCode === 0 ? undefined : `worker exited with code ${exitCode}`,
      phase: "worker",
      specs: specs.length > 0 ? specs : workerLifecycle.specs,
      startedAt: workerLifecycle.startedAt.toISOString(),
      status: exitCode === 0 ? "passed" : "failed",
    });
  },
  async afterSession() {
    await measureE2ELifecyclePhase(
      "after-session",
      { specs: currentE2EWorkerSessionSpecs },
      async () => {
        try {
          await cleanupE2EElectronProcesses("afterSession", {
            requireExit: true,
            waitForGracefulExit: true,
          });
        } finally {
          const close = closeBotEntryRelay;
          closeBotEntryRelay = undefined;
          await close?.();
        }
        if (currentE2EChromiumUserDataDir)
          await cleanupE2EDirectory("afterSession", currentE2EChromiumUserDataDir, true);
        e2eReporter.compactNodeCoverage();
        currentE2EElectronAppPid = null;
        currentE2EBeforeSessionError = null;
        e2eFailureArtifacts = null;
        currentE2EWorkerSessionSpecs = [];
        currentE2EChromiumUserDataDir = null;
      },
    );
  },
  async onComplete(exitCode) {
    e2eRunnerFinalizationGuard.disarm();
    try {
      await measureE2ELifecyclePhase("complete", { specs: configuredE2ESpecs }, async () => {
        await cleanupE2EElectronProcesses("onComplete");
        await cleanupE2EDirectory("onComplete-home", E2E_HOME_DIR, true);
        await cleanupE2EDirectory("onComplete", E2E_RUN_CACHE_DIR);
      });
    } finally {
      e2eReporter.writeSummary(exitCode);
      armE2ERunnerExitWatchdog(exitCode);
    }
  },
};
