// OpenZWork（T12/v4.0.0）：保留上游预装工具、ChromeDriver 直连与共享 stage 等中性 E2E 基础设施，
// 按 ledger OZ-D 域剥离官方套餐 / 闲时套餐 / 加速卡 / 分享 / 遥测 / 登录等裁剪域 mock。
import {
  bindPrelaunchedElectronSession,
  PrelaunchedElectronOwner,
} from "#e2e/helpers/e2e-prelaunched-electron";
import { startPreinstalledToolsRealFixture } from "#e2e/helpers/preinstalled-tools-real-fixture";
import { startPreinstalledToolsRewriteFixture } from "#e2e/helpers/preinstalled-tools-rewrite-fixture";
import { startPreinstalledToolsFaultFixture } from "#e2e/helpers/preinstalled-tools-fault-fixture";
import {
  startPreinstalledToolsFixture,
  writeEmptyPreinstalledToolsCatalog,
} from "#e2e/helpers/preinstalled-tools-fixture";
import { seedSidebarRichContentFixture } from "./test/e2e/helpers/sidebar-rich-content-fixture.js";
import { resolveWindowsE2EMobileBrowserExecutable } from "./test/e2e/helpers/e2e-mobile-browser-executable.js";
import {
  loadToolSearchResponses,
  toolSearchResponseStage,
  type ToolSearchRequest,
} from "./test/e2e/helpers/toolsearch-provider.js";
/* eslint-disable max-lines -- WDIO 配置需要集中维护 Electron、Xvfb、代理和容器 demo 参数，拆开会让测试入口更难追踪。 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tmpdir, userInfo } from "node:os";
import {
  resolveE2EChromedriverExecutable,
  startE2EChromedriverServer,
} from "./scripts/e2e-chromedriver-server.mjs";
import {
  captureWorkspaceSources,
  withE2ESourceEvidence,
} from "./test/e2e/reporting/e2e-source-evidence.js";
import { installBashPrefixPermissionPnpmShim } from "./test/e2e/helpers/bash-prefix-permission-shim.js";
import {
  applyDynamicWorkflowConfigMockEnv,
  clearDynamicWorkflowConfigMockEnv,
  resolveDynamicWorkflowConfigMockScenario,
  startDynamicWorkflowConfigMockServer,
  type DynamicWorkflowConfigMockServer,
} from "./test/e2e/helpers/dynamic-workflow-config-mock-server.js";
import { installHookTrustFixture } from "./test/e2e/helpers/hook-trust-fixture.js";
import { installHooksLifecycleFixture } from "./test/e2e/helpers/hooks-lifecycle-fixture.js";
import {
  DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY,
  startE2ENetworkCaptureProxy,
  type E2ENetworkCaptureProxy,
} from "./test/e2e/helpers/network-capture-proxy.js";
import {
  PASSIVE_AGENT_STARTUP_SCENARIO,
  SMALL_AGENT_WARMUP_SCENARIO,
  seedPassiveAgentStartupWorkspaces,
} from "./test/e2e/helpers/passive-agent-startup-fixture.js";
import {
  CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
  CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
  CONTEXT_WINDOW_COLD_RESUME_PROVIDER_NAME,
  seedProviderReadinessHistoryFixture,
} from "./test/e2e/helpers/provider-readiness-history-fixture.js";
import { seedSessionHistoryFirstFixture } from "./test/e2e/helpers/session-history-first-fixture.js";
import { installStopToolResultsFixture } from "./test/e2e/helpers/stop-tool-results-fixture.js";
import { seedTaskIndexRowAuthorityFixture } from "./test/e2e/helpers/task-list-row-authority-fixture.js";
import { seedTaskTitleMarqueeFixture } from "./test/e2e/helpers/task-title-marquee-fixture.js";
import { resolveUpstreamModels } from "./test/e2e/helpers/upstream-recorded-models.js";
import {
  hasUpstreamCaseLocalReplayFixtureForWorker,
  resolveUpstreamE2EHttpMode,
  resolveUpstreamE2EHttpModeForWorker,
  resolvePluginReplayFixturePaths,
  resolveUpstreamReplayFixturePaths as resolveUpstreamReplayFixturePathsFromContract,
  type UpstreamReplayFixtureMode,
} from "./test/e2e/helpers/upstream-replay-fixture-resolution.js";
import {
  startUpstreamReplayServer,
  type UpstreamReplayServer,
} from "./test/e2e/helpers/upstream-replay-server.js";
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
import {
  PROJECT_UPGRADE_ORDER_SPEC,
  seedProjectUpgradeOrderFixture,
} from "./test/e2e/helpers/project-upgrade-order-fixture.js";
import {
  isNativeKeychainCredentialSpec,
  resolveAskUserQuestionClockScaleForWorker,
  resolveE2ECredentialSecret,
} from "./test/e2e/helpers/e2e-worker-environment.js";
import { createE2ERendererBridgeRootHooks } from "./test/e2e/helpers/e2e-renderer-bridge-root-hook.js";
import { E2E_AGENT_WORKSPACE_NAME } from "./test/e2e/helpers/e2e-runtime-paths.js";
import { resetDraftRegenerationResend } from "#e2e/helpers/draft-regeneration-resend";
import { installHookTrustWorktreeFixture } from "./test/e2e/helpers/hook-trust-worktree-fixture.js";
import { runMeasuredE2ELifecyclePhase } from "./test/e2e/helpers/e2e-lifecycle-measurement.js";
import { createE2ERunnerFinalizationGuard } from "./test/e2e/helpers/e2e-runner-finalization-guard.js";
import {
  applyE2EWorkerReplayProxyEnv,
  replaceChromeUserDataDirArg,
  resolveE2EWorkerModelStreamIdleTimeoutMs,
  resolveE2EWebDriverRequestLimits,
  resolveE2EWorkerChromiumProfileDir,
  workerSpecsContain,
} from "./test/e2e/helpers/e2e-worker-isolation.js";
import { seedRemoteOnboardingFixture } from "./test/e2e/helpers/remote-startup-profile.js";
import {
  installOfficialPluginCacheTemplate,
  prepareOfficialPluginCacheTemplate,
} from "./test/e2e/helpers/official-plugin-cache-prewarm.js";
import { getE2EProviderEndpointEnv } from "#e2e/helpers/e2e-provider-endpoint";
import { prepareWebRemoteControlAuthGateFixture } from "./test/e2e/helpers/web-remote-control-auth-gate-fixture.js";
import { prepareMcpFailureGuidanceFixture } from "#e2e/helpers/mcp-failure-guidance-fixture";
import { createE2EReplayFixtureVariables } from "./test/e2e/helpers/e2e-runtime-paths.js";
import { stageE2EAppOutput } from "./test/e2e/helpers/e2e-app-output-stage.js";
import {
  ensureSharedSnapshot,
  fileSignature,
  stageE2EAppOutputWithSharedRenderer,
} from "./test/e2e/helpers/e2e-shared-stage-cache.js";
import { withE2EDesktopBuildLock } from "./scripts/ensure-e2e-desktop-build.mjs";
import { PREINSTALLED_ENTRY_SHIM_PROCESS_TIMEOUT_MS } from "./scripts/build-windows-preinstalled-entry-shim.mjs";
import {
  ensureSshRemoteReleaseAssets,
  resolveSshRemoteReleaseScope,
} from "./test/e2e/helpers/e2e-ssh-remote-release-assets.js";
import { createLocalPairingRelay } from "./test/e2e/helpers/local-pairing-relay.js";
import {
  listSpecsRequiringRemoteRelease,
  REMOTE_RELEASE_DIR_ENV,
} from "./test/e2e/helpers/e2e-remote-release-requirement.js";
import {
  seedPersonalProviderConfig,
  seedPersonalDefaultModelSelection,
  type PersonalProviderConfigSeed,
} from "./test/e2e/helpers/model-provider-restart-config.js";
import {
  resolveE2EMaxInstances,
  resolveE2EScheduledSpecFiles,
} from "./test/e2e/helpers/e2e-spec-resolution.js";
import {
  MANUAL_REVIEW_SPEC_GLOB,
  hasRequiredSshE2EEnvironment,
  isExplicitE2ESpecSelection,
  resolveEnvironmentGatedFormalSpecExcludes,
} from "./scripts/e2e-formal-spec-selection.mjs";
import { E2EFailureArtifactCollector } from "./test/e2e/reporting/e2e-failure-artifacts.js";
import {
  classifyError,
  createE2EReporter,
  isSkippedWdioStatus,
  resolveWdioTestStatus,
} from "./test/e2e/reporting/e2e-reporting.js";
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
let preinstalledToolsFixture: Awaited<ReturnType<typeof startPreinstalledToolsFixture>> | undefined;
let e2eChromedriverServer: Awaited<ReturnType<typeof startE2EChromedriverServer>> | undefined;
const E2E_BROWSER_DRIVER_CACHE_DIR = resolve(REPO_ROOT, ".cache/wdio-browser-drivers");
function shouldReuseDesktopE2EBuild(environment: Record<string, string | undefined>): boolean {
  return environment.ZCODE_E2E_SKIP_BUILD === "1";
}
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
const UPSTREAM_PROVIDER_SPEC = "./test/e2e/infrastructure/smoke/upstream-provider.test.ts";
const PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC = "plugin-no-git-github-archive.test.ts";
const GIT_COMMIT_DIALOG_UI_FLOW_SPEC = "git-commit-dialog-ui-flow.test.ts";
const OAUTH_CREDENTIAL_RECOVERY_SPEC = "oauth-credential-recovery.test.ts";
const JWT_EXPIRY_REAUTHENTICATION_SPEC = "jwt-expiry-reauthentication.test.ts";
const AGENT_ALWAYS_BACKGROUND_SPEC = "conversation-session-agent-always-background.test.ts";
const SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_SPEC =
  "subagent-coding-plan-login-catalog-stale.test.ts";
const SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE = "subagent-login-catalog-stale";
const SUBAGENT_CODING_PLAN_OAUTH_FLOW_ID = "e2e-subagent-bigmodel-flow";
const SUBAGENT_CODING_PLAN_OAUTH_STATE = "e2e-subagent-bigmodel-state";
const PROVIDER_READINESS_AGENT_STARTUP_SPEC = "provider-readiness-agent-startup.test.ts";
const CONTEXT_WINDOW_COLD_RESUME_SPEC = "conversation-session-context-window-cold-resume.test.ts";
const PASSIVE_AGENT_STARTUP_SPEC = "workspace-passive-agent-startup.test.ts";
const AGENT_WARMUP_LIFECYCLE_SPEC = "workspace-agent-warmup-lifecycle.test.ts";
const AGENT_WARMUP_SMALL_SET_SPEC = "workspace-agent-warmup-small-set.test.ts";
const PROVIDER_SAVE_DORMANT_AGENT_SPEC = "workspace-provider-save-dormant-agent.test.ts";
const MODEL_PROVIDER_REGRESSION_GAPS_SPEC =
  "conversation-session-model-provider-regression-gaps.test.ts";
// 只借用这套 fixture 的「多 workspace 已恢复」启动态来做 workspace 切换，不断言 agent 预热行为。
const BROWSER_CROSS_WORKSPACE_CLOSE_SPEC = "browser-tab-close-cross-workspace.test.ts";
const BROWSER_CROSS_WORKSPACE_ATTACHMENT_SPEC =
  "browser-tab-attachment-restore-cross-workspace.test.ts";
const WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC = "workspace-removal-runtime-release.test.ts";
// Agent Browser Use 对话 + 两个已恢复 workspace：验证 tab 关闭后别的 workspace 的残留壳不留下出声 guest。
const BROWSER_USE_AGENT_TAB_CLOSED_RESIDUAL_GUEST_SPEC =
  "conversation-session-browser-use-agent-tab-closed-residual-guest.test.ts";
const AGENT_WARMUP_FIXTURE_SPECS = [
  PASSIVE_AGENT_STARTUP_SPEC,
  AGENT_WARMUP_LIFECYCLE_SPEC,
  AGENT_WARMUP_SMALL_SET_SPEC,
  PROVIDER_SAVE_DORMANT_AGENT_SPEC,
  BROWSER_CROSS_WORKSPACE_CLOSE_SPEC,
  BROWSER_CROSS_WORKSPACE_ATTACHMENT_SPEC,
  BROWSER_USE_AGENT_TAB_CLOSED_RESIDUAL_GUEST_SPEC,
  WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC,
  MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
] as const;
/** 只需要两个 workspace 的 spec，用小号 scenario 少 seed 7 个目录。 */
const SMALL_AGENT_WARMUP_SPECS = [
  AGENT_WARMUP_SMALL_SET_SPEC,
  BROWSER_CROSS_WORKSPACE_CLOSE_SPEC,
  BROWSER_CROSS_WORKSPACE_ATTACHMENT_SPEC,
  BROWSER_USE_AGENT_TAB_CLOSED_RESIDUAL_GUEST_SPEC,
  WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC,
  MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
] as const;
const TASK_INDEX_ROW_AUTHORITY_SPEC = "conversation-session-task-index-row-authority.test.ts";
const TASK_TITLE_MARQUEE_SPEC = "conversation-session-task-title-marquee.test.ts";
const GIT_REVIEW_ENTRY_SPEC = "conversation-session-git-review-entry.test.ts";
const WINDOWS_AGENT_METRIC_PROBE_ABSENCE_SPEC = "windows-agent-metric-probe-absence.test.ts";
const HOOKS_LIFECYCLE_SPEC = "conversation-session-hooks-lifecycle.test.ts";
const HOOK_TRUST_SPEC = "conversation-session-hook-trust.test.ts";
const HOOK_TRUST_WORKTREE_SPEC = "conversation-session-hook-trust-worktree.test.ts";
const E2E_PROVIDER_ID = "e2e-upstream";
const E2E_PROVIDER_ALTERNATE_PROVIDER_ID = "e2e-upstream-alt";
const E2E_PROVIDER_ALTERNATE_PROVIDER_NAME = "Upstream E2E Alt";
// 模型名由 E2E_PROVIDER_MODEL / E2E_PROVIDER_SECONDARY_MODEL 控制，未设置时使用回放夹具的录制模型。
const { model: E2E_PROVIDER_MODEL, secondaryModel: E2E_PROVIDER_SECONDARY_MODEL } =
  resolveUpstreamModels();
const SUBAGENT_PROVIDER_REGISTRY_COLD_START_SPEC =
  "conversation-session-subagent-provider-registry-cold-start.test.ts";
const BUILT_IN_SUBAGENT_MODEL_OVERRIDES_SPEC =
  "conversation-session-built-in-subagent-model-overrides.test.ts";
const SETTINGS_SUBAGENT_CREATE_EDIT_PERSISTENCE_SPEC =
  "settings-subagent-create-edit-persistence.test.ts";
const SUBAGENT_REASONING_AGENT_NAME = "e2e-reasoning-reviewer";
const SUBAGENT_RUNTIME_CATALOG_REASONING_SPEC =
  "conversation-session-subagent-runtime-catalog-reasoning.test.ts";
const SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID = "e2e-claude-runtime-catalog";
const SUBAGENT_RUNTIME_CATALOG_PROVIDER_NAME = "Claude Runtime Catalog E2E";
const SUBAGENT_RUNTIME_CATALOG_MODEL = "claude-opus-4-8";
const SUBAGENT_RUNTIME_CATALOG_AGENT_NAME = "e2e-claude-catalog-reviewer";
const MODEL_PROVIDER_PLAN_SURFACE_SPEC = "conversation-session-model-provider-plan-surface.test.ts";
const SUBAGENT_TEAM_SCOPE_SPEC = "conversation-session-subagent-team-scope.test.ts";
const TOOL_ERROR_SURFACE_SPEC = "conversation-session-tool-error-surface.test.ts";
const MODEL_OUTPUT_TOKEN_BUDGET_SPEC = "conversation-session-model-output-token-budget.test.ts";
const MODEL_OUTPUT_TOKEN_PREFLIGHT_SPEC = "conversation-session-model-output-token-preflight";
const OUTPUT_LIMIT_CONTINUE_MARKDOWN_PROTOCOLS_SPEC =
  "conversation-session-output-limit-continue-markdown-protocols.test.ts";
const SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME = "e2e-provider-registry-reviewer";
const TOOL_ERROR_SURFACE_STALE_AGENT_NAME = "e2e-stale-error-reviewer";
const TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME = "e2e-healthy-error-reviewer";
// 上游供应商地址由 E2E_PROVIDER_BASE_URL 提供，仓库不写死任何供应商；只有 capture 模式访问真实上游时需要。
// 回放模式使用本地回放服务器，实际生效的地址经 E2E_PROVIDER_RUNTIME_BASE_URL 传给各测试进程。
const E2E_PROVIDER_UPSTREAM_BASE_URL = process.env.E2E_PROVIDER_BASE_URL?.trim() ?? "";
const E2E_PROVIDER_REPLAY_API_KEY = "e2e-fixture-key";
const E2E_AUTH_PROVIDER_ID = "zai";
// OpenZWork（T12）：E2E provider preset 只保留 env（自建回放/自备端点）；
// 上游指向官方端点的 preset（glm 加速卡/bigmodel53/stagingmodel）与闲时/加速卡域不引入。
const E2E_PROVIDER_PRESETS = {
  env: {
    apiKeyEnvNames: ["E2E_PROVIDER_API_KEY"],
    baseUrl: E2E_PROVIDER_UPSTREAM_BASE_URL,
    expectedHost: readUpstreamBaseUrlPart("host"),
    expectedProtocol: readUpstreamBaseUrlPart("protocol"),
    model: E2E_PROVIDER_MODEL,
    providerId: E2E_PROVIDER_ID,
    providerName: "Upstream E2E",
    thoughtLevel: "high",
  },
} as const;
type E2EProviderPresetName = keyof typeof E2E_PROVIDER_PRESETS;

function readUpstreamBaseUrlPart(part: "host" | "protocol") {
  if (!E2E_PROVIDER_UPSTREAM_BASE_URL) return "";
  const url = new URL(E2E_PROVIDER_UPSTREAM_BASE_URL);
  return part === "host" ? url.host : url.protocol.replace(/:$/u, "");
}

function readE2EProviderPresetName(): E2EProviderPresetName {
  const configured =
    process.env.E2E_PROVIDER_PRESET?.trim() || process.env.LLM_E2E_PROVIDER_PRESET?.trim();
  if (!configured) {
    // OpenZWork：默认使用环境变量配置的上游供应商（E2E_PROVIDER_BASE_URL / API_KEY / MODEL）。
    return "env";
  }
  if (configured === "env" || configured in E2E_PROVIDER_PRESETS) {
    return configured as E2EProviderPresetName;
  }
  throw new Error(
    `Unsupported E2E_PROVIDER_PRESET=${configured}. Expected one of: ${Object.keys(E2E_PROVIDER_PRESETS).join(", ")}.`,
  );
}

const e2eProviderPresetName = readE2EProviderPresetName();
const e2eProviderPreset = E2E_PROVIDER_PRESETS[e2eProviderPresetName];
const upstreamE2EContextWindowOverride = readPositiveIntegerEnv(
  "ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW",
);
const upstreamE2EMaxOutputTokensOverride = readPositiveIntegerEnv(
  "ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS",
);
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

const configuredE2EWorkerNetworkEnv = {
  httpProxy: process.env.ZCODE_HTTP_PROXY,
  noProxy: process.env.ZCODE_NO_PROXY,
};
const E2E_APP_CREDENTIALS_FILE = resolve(E2E_APP_CONFIG_DIR, "credentials.json");
const E2E_AGENTS_STATE_FILE = resolve(E2E_APP_CONFIG_DIR, "agents-state.json");
const execFileAsync = promisify(execFile);

const E2E_CERT_CACHE_ROOT =
  process.env.ZCODE_E2E_CERT_CACHE_DIR?.trim() || resolve(REPO_ROOT, ".cache");


const E2E_NETWORK_CAPTURE_DIR = resolve(
  process.env.ZCODE_E2E_NETWORK_CAPTURE_DIR?.trim() ||
    // 修复原因：beforeSession 会清空 .e2e-home；抓包代理的 CA 必须放在
    // reset 范围之外，否则 agent 读 httpProxyCaCertPath 时会遇到 ENOENT。
    resolve(DESKTOP_DIR, ".e2e-network-capture"),
);


const E2E_NETWORK_CAPTURE_CA_DIR = resolve(E2E_CERT_CACHE_ROOT, "desktop-e2e-network-capture-ca");


const UPSTREAM_CAPTURE_ARTIFACT_PATH = resolve(E2E_NETWORK_CAPTURE_DIR, "upstream-provider.json");


const UPSTREAM_CAPTURE_RESPONSE_PREVIEW_BYTES = 8 * 1024 * 1024;


const UPSTREAM_CAPTURE_RESPONSE_CHUNK_TIMELINE_BYTES = 16 * 1024 * 1024;





const UPSTREAM_REPLAY_FIXTURE_ROOT = resolve(DESKTOP_DIR, "test/e2e/fixtures/upstream");


const UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR = resolve(
  UPSTREAM_REPLAY_FIXTURE_ROOT,
  "conversation-session",
);


const UPSTREAM_CONVERSATION_SESSION_CASE_MANIFEST_DIR = resolve(
  DESKTOP_DIR,
  "test/e2e/fixtures/cases/conversation-session",
);


const UPSTREAM_COMMON_REPLAY_FIXTURE_PATH = resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "common.json");


const LEGACY_UPSTREAM_REPLAY_FIXTURE_PATHS = [
  resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "provider-conversation-tool-cross-product.json"),
  resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "provider-basic.json"),
];


const E2E_USER_AGENTS_DIR = resolve(E2E_STORAGE_ROOT, "agents");


const E2E_CLI_AGENTS_DIR = resolve(E2E_CLI_CONFIG_DIR, "agents");


const E2E_USER_PROFILE = {
  displayName: "ZCode E2E",
  id: "zcode-e2e-user",
  username: "zcode-e2e-user",
};


const E2E_AUTH_TOKEN = "e2e-oauth-token";


const E2E_PROVIDER_RUNTIME_FILE = resolve(E2E_NETWORK_CAPTURE_DIR, "upstream-runtime.json");


const REQUESTED_UPSTREAM_HTTP_MODE_ENV = "ZCODE_E2E_REQUESTED_UPSTREAM_HTTP_MODE";


const INITIAL_ZCODE_BUILTIN_PROVIDER_CONFIG_FILE =
  process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE?.trim();


const E2E_DEFAULT_ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = resolve(
  REPO_ROOT,
  "config/provider/zcode-builtin.json",
);

const requestedE2ESpecs = readRequestedE2ESpecs();
const manualReviewE2E =
  process.env.ZCODE_E2E_MANUAL_REVIEW?.trim() === "1" ||
  requestedE2ESpecs.some((spec) => spec.replaceAll("\\", "/").includes("/manual-review/"));
if (manualReviewE2E) process.env.ZCODE_E2E_MANUAL_REVIEW = "1";

const requestedE2EExcludeSpecs = readRequestedE2EExcludeSpecs();

const containerE2E = process.env.ZCODE_E2E_CONTAINER === "1";
const requestedUpstreamE2EHttpMode =
  process.env[REQUESTED_UPSTREAM_HTTP_MODE_ENV] !== undefined
    ? process.env[REQUESTED_UPSTREAM_HTTP_MODE_ENV]?.trim() || undefined
    : process.env.E2E_PROVIDER_HTTP_MODE?.trim() || undefined;
let upstreamE2EHttpMode = resolveUpstreamE2EHttpMode({
  explicitReplayFixture: Boolean(process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim()),
  manualReview:
    process.env.ZCODE_E2E_MANUAL_REVIEW?.trim() === "1" ||
    requestedE2ESpecs.some((spec) => spec.replaceAll("\\", "/").includes("/manual-review/")),
  requestedMode: requestedUpstreamE2EHttpMode,
});

// 修复依据（OpenZWork）：T12 重建 wdio.conf 时丢失了上游的 applyUpstreamE2EHttpModeForWorker
// （上游 wdio.conf.ts:932，beforeSession 内调用）。没有它，pending manual-review 用例即使已有
// 确定性 case-local fixture 也无法进入 replay（runner 级 manualReview 开关把它们固定到
// capture，或要求显式 E2E_PROVIDER_REPLAY_FIXTURE_PATH，而显式路径会绕过 common/legacy
// 响应池使工具循环断链）。按上游原位恢复 per-worker 决策。
function applyUpstreamE2EHttpModeForWorker(specs: string[]) {
  upstreamE2EHttpMode = resolveUpstreamE2EHttpModeForWorker({
    caseLocalReplayFixtureAvailable: hasUpstreamCaseLocalReplayFixtureForWorker({
      caseFixtureDir: UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR,
      specs,
    }),
    explicitReplayFixture: Boolean(process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim()),
    requestedMode: requestedUpstreamE2EHttpMode,
    specs,
  });
  // Bug 根因（上游注释）：combined run 的全局 manual-review 开关过去把正式 worker 也固定为
  // capture，case-local replay 因此直连真实模型并产生假失败。mode 必须在每个 Electron
  // 启动前按该 worker 的 spec 与 fixture 完整性重新决策。
  process.env.E2E_PROVIDER_HTTP_MODE = upstreamE2EHttpMode;
}
const manualReviewHoldMs = readPositiveIntegerEnv("ZCODE_E2E_MANUAL_REVIEW_HOLD_MS") ?? 0;
const configuredE2ESpecs = requestedE2ESpecs.length
  ? requestedE2ESpecs
  : ["./test/e2e/**/*.test.ts"];
const pluginNoGitGitHubArchiveE2E = configuredE2ESpecs.some((spec) =>
  spec.includes(PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC),
);

// 调度前校验：worker 共用 .e2e-home，只支持串行（见 resolveE2EMaxInstances）。
const e2eMaxInstances = resolveE2EMaxInstances(process.env);
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
// 复用构建（测试池、CI 子 shard）时桌面产物和 CLI 整轮不变：renderer 和官方插件缓存模板按内容签名
// 只准备一次，之后的批次直接用（见 test/e2e/helpers/e2e-shared-stage-cache.ts）。现场构建、源码证据、
// 正式包和 ZCODE_E2E_SHARED_STAGE=0 时维持按 runId 各备一份。
const E2E_SHARED_STAGE_DIR = resolve(DESKTOP_DIR, ".e2e-cache", "shared");
// 只看 launcher 和 worker 进程一定相同的环境变量：worker 也要算出同一个模板路径。
// 不用 shouldReuseDesktopE2EBuild：它还看 onPrepare 才下发给 worker 的 mock 端口，两边会算得不一样。
const E2E_SHARED_STAGE =
  process.env.ZCODE_E2E_SKIP_BUILD === "1" &&
  process.env.ZCODE_E2E_SKIP_AGENT_BUILD === "1" &&
  process.env.ZCODE_E2E_SOURCE_EVIDENCE !== "1" &&
  process.env.ZCODE_E2E_SHARED_STAGE !== "0" &&
  !E2E_PACKAGED_APP_BINARY_PATH;
const E2E_SHARED_PLUGIN_CACHE_KEY = E2E_SHARED_STAGE ? fileSignature(ZCODE_CLI_ENTRYPOINT) : null;
const E2E_OFFICIAL_PLUGIN_CACHE_TEMPLATE_HOME = E2E_SHARED_PLUGIN_CACHE_KEY
  ? resolve(E2E_SHARED_STAGE_DIR, "official-plugin-cache", E2E_SHARED_PLUGIN_CACHE_KEY)
  : resolve(E2E_RUN_CACHE_DIR, "official-plugin-cache-home");
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

process.env.HOME = E2E_HOME_DIR;
process.env.USERPROFILE = E2E_HOME_DIR;
process.env.ZCODE_E2E_HOME_DIR = E2E_HOME_DIR;
process.env.ZCODE_E2E_RUN_ID = E2E_RUN_ID;
process.env.ZCODE_DATA_BASE_DIR = E2E_HOME_DIR;
process.env.ZCODE_DESKTOP_APPLICATION_NAME = "ZCode E2E";
process.env.ZCODE_DESKTOP_HOME_DIR = E2E_HOME_DIR;
process.env.ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA = "1";
// 修复原因：从 ZCode 客户端拉起的 shell 里带有应用自身环境（ZCODE_ENV=production、
// ZCODE_BASE_URL 指向官方端点）。它们会被 onPrepare 的 agent 构建读走并固化进产物，
// 让 E2E 打到生产域、忽略 settings 里的 endpoint，fixture mock server 收不到请求。
// 桌面包的归一在 ensure-e2e-desktop-build 内完成，这里保证 WDIO 侧构建链路一致。
process.env.ZCODE_ENV = "test";
delete process.env.ZCODE_BASE_URL;
delete process.env.ZCODE_RUNTIME_ENV;
// Bugfix: renderer E2E store bridge 只能由 WDIO 进程显式打开，避免 ZCODE_ENV=test 的产品测试环境暴露全局可变 store。
process.env.VITE_ZCODE_E2E_STORE_BRIDGE = "1";
// Bugfix: e2e session 由 Chromedriver 管理调试端口；禁用主进程开发态固定的 9229，
// 避免和本机已打开的 ZCode Dev 冲突后出现空白窗口并卡在 session 创建阶段。
process.env.ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT = "1";
// 修复原因：Windows CI runner 未安装 Chrome，手机 Web 用例的 `channel: "chrome"` 启动失败；
// 未显式配置时回退到本机 Chrome/Edge，worker 继承该变量后各 spec 无需单独处理。
if (process.platform === "win32" && !process.env.ZCODE_E2E_MOBILE_BROWSER_EXECUTABLE?.trim()) {
  const mobileBrowserExecutable = resolveWindowsE2EMobileBrowserExecutable();
  if (mobileBrowserExecutable) {
    process.env.ZCODE_E2E_MOBILE_BROWSER_EXECUTABLE = mobileBrowserExecutable;
  }
}

let upstreamCaptureProxy: E2ENetworkCaptureProxy | null = null;
let upstreamReplayServer: UpstreamReplayServer | null = null;
let dynamicWorkflowConfigMockServer: DynamicWorkflowConfigMockServer | null = null;
let stopWebRemoteControlAuthGateFixture: (() => Promise<void>) | null = null;
let upstreamE2EBaseUrl: string = e2eProviderPreset.baseUrl;
let e2eRunnerExitWatchdog: ReturnType<typeof setTimeout> | null = null;

let currentE2EElectronAppPid: number | null = null;
let prelaunchedElectronOwner: PrelaunchedElectronOwner | undefined;
async function disposeOwnedElectron() {
  const current = prelaunchedElectronOwner;
  prelaunchedElectronOwner = undefined;
  await current?.dispose();
}
let currentE2EWorkerSpecs: string[] = [];

let currentE2EBeforeSessionError: unknown = null;

let e2eFailureArtifacts: E2EFailureArtifactCollector | null = null;

let currentE2EWorkerSessionSpecs: string[] = [];

let currentE2EChromiumUserDataDir: string | null = null;

let closeBotEntryRelay: (() => Promise<void>) | undefined;
let stopMcpFailureGuidanceFixture: (() => Promise<void>) | null = null;

const e2eWorkerLifecycleStarts = new Map<string, { specs: string[]; startedAt: Date }>();

function readE2EThoughtLevel() {
  for (const envName of ["E2E_PROVIDER_THOUGHT_LEVEL", "LLM_E2E_THOUGHT_LEVEL"]) {
    if (process.env[envName] !== undefined) {
      return process.env[envName]?.trim() ?? "";
    }
  }
  return e2eProviderPreset.thoughtLevel;
}
function resolveActiveE2EProviderEnv(specs: string[] = configuredE2ESpecs) {
  return {
    providerId: e2eProviderPreset.providerId,
    providerName: e2eProviderPreset.providerName,
    model: e2eProviderPreset.model,
    thoughtLevel: readE2EThoughtLevel(),
  };
}
function buildUpstreamE2EAnthropicBaseUrl() {
  const baseURL = upstreamE2EBaseUrl.replace(/\/+$/u, "");
  return baseURL.endsWith("/anthropic") ? baseURL : `${baseURL}/anthropic`;
}
async function resolveUpstreamReplayFixturePaths(specs: string[] = []) {
  const configured = readConfiguredUpstreamReplayFixturePaths();
  const mode = readUpstreamReplayFixtureMode();
  return resolveUpstreamReplayFixturePathsFromContract({
    caseFixtureDir: UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR,
    caseManifestDir: UPSTREAM_CONVERSATION_SESSION_CASE_MANIFEST_DIR,
    commonFixturePath: UPSTREAM_COMMON_REPLAY_FIXTURE_PATH,
    configuredFixturePaths: configured,
    legacyFixturePaths: LEGACY_UPSTREAM_REPLAY_FIXTURE_PATHS,
    mode,
    pluginFixturePaths:
      configured || mode === "strict-case-local"
        ? []
        : await resolvePluginReplayFixturePaths({
            fixtureRoot: UPSTREAM_REPLAY_FIXTURE_ROOT,
            specs,
          }),
    specs,
  });
}
function readConfiguredUpstreamReplayFixturePaths() {
  const configured = process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim();
  if (!configured) {
    return null;
  }

  return configured
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(REPO_ROOT, item));
}
function readUpstreamReplayFixtureMode(): UpstreamReplayFixtureMode {
  const mode = process.env.E2E_PROVIDER_REPLAY_FIXTURE_MODE?.trim() || "compatible";
  if (mode === "compatible" || mode === "strict-case-local") {
    return mode;
  }
  throw new Error(
    `Unsupported E2E_PROVIDER_REPLAY_FIXTURE_MODE=${mode}. Expected compatible or strict-case-local.`,
  );
}
function isBuiltInSubagentModelSelectionOverridesSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(BUILT_IN_SUBAGENT_MODEL_OVERRIDES_SPEC));
}
function isSubagentRuntimeCatalogReasoningSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SUBAGENT_RUNTIME_CATALOG_REASONING_SPEC));
}
function isModelProviderPlanSurfaceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(MODEL_PROVIDER_PLAN_SURFACE_SPEC));
}
function isSettingsSubagentCreateEditPersistenceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SETTINGS_SUBAGENT_CREATE_EDIT_PERSISTENCE_SPEC));
}
function isSubagentProviderRegistryColdStartSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SUBAGENT_PROVIDER_REGISTRY_COLD_START_SPEC));
}
function isToolErrorSurfaceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(TOOL_ERROR_SURFACE_SPEC));
}
function seedE2EBuiltInSubagentModelOverrides(specs: string[] = []) {
  const builtInModelSelectionOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const runtimeCatalogSpec = isSubagentRuntimeCatalogReasoningSpec(specs);
  if (!builtInModelSelectionOverridesSpec && !runtimeCatalogSpec) {
    return;
  }

  // Bug 根因：browser.reloadSession() 会再次触发 beforeSession。若这里无条件重写，
  // 测试刚通过设置页保存的 structured selection 会在冷启动前被初始 fixture 覆盖，
  // 使“冷恢复”实际验证的仍是 seed，而不是用户持久化结果。初始 HOME 为空时才落盘。
  if (existsSync(E2E_AGENTS_STATE_FILE)) {
    return;
  }

  const overrideSelection = runtimeCatalogSpec
    ? {
        providerId: SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID,
        modelId: SUBAGENT_RUNTIME_CATALOG_MODEL,
      }
    : {
        providerId: E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
        modelId: E2E_PROVIDER_SECONDARY_MODEL,
      };
  const initialGeneralPurposeSelection = runtimeCatalogSpec
    ? overrideSelection
    : {
        providerId: e2eProviderPreset.providerId,
        modelId: e2eProviderPreset.model,
      };
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  writeFileSync(
    E2E_AGENTS_STATE_FILE,
    JSON.stringify(
      {
        builtInModelSelectionOverrides: {
          Explore: {
            ...overrideSelection,
            ...(builtInModelSelectionOverridesSpec || runtimeCatalogSpec
              ? { options: { reasoningLevel: "invalid-e2e" } }
              : {}),
          },
          "general-purpose": {
            ...initialGeneralPurposeSelection,
            ...(runtimeCatalogSpec ? { options: { reasoningLevel: "high" } } : {}),
          },
        },
        disabledAgentIds: [],
      },
      null,
      2,
    ),
    "utf-8",
  );
}
function seedE2ESubagentProfiles(specs: string[] = []) {
  if (
    specs.some((spec) =>
      /(?:conversation-session-subagent-cross-host|settings-subagent-create-edit-persistence|plugin-subagent-override-cold)\.test\.ts$/.test(
        spec,
      ),
    )
  ) {
    // 内置文档插件已不再提供子代理（visual-judge 已移除）；插件 subagent 覆盖/清除覆盖场景
    // 统一使用自己的继承模型 fixture 插件。
    const pluginDir = resolve(E2E_STORAGE_ROOT, "cli/plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      resolve(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "e2e-subagent-refresh@e2e-fixture",
            name: "e2e-subagent-refresh",
            marketplace: "e2e-fixture",
            version: "1.0.0",
            installPath: resolve(DESKTOP_DIR, "test/e2e/fixtures/subagent-refresh-plugin"),
            installedAt: "2026-09-18T00:00:00.000Z",
            updatedAt: "2026-09-18T00:00:00.000Z",
            scope: "user",
          },
        ],
      }),
    );
    const config = existsSync(E2E_CLI_CONFIG_FILE)
      ? JSON.parse(readFileSync(E2E_CLI_CONFIG_FILE, "utf8"))
      : {};
    config.plugins = {
      ...config.plugins,
      enabledPlugins: {
        ...config.plugins?.enabledPlugins,
        "e2e-subagent-refresh@e2e-fixture": true,
      },
    };
    writeFileSync(E2E_CLI_CONFIG_FILE, JSON.stringify(config));
  }
  const profileEntries: Array<{ content: string; name: string }> = [];

  if (isBuiltInSubagentModelSelectionOverridesSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_REASONING_AGENT_NAME,
      content: `---
name: ${SUBAGENT_REASONING_AGENT_NAME}
description: E2E custom subagent for reasoning effort persistence coverage.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
thoughtLevel: invalid-e2e
tools: Read
maxTurns: 1
---
You are the E2E reasoning reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isSubagentRuntimeCatalogReasoningSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_RUNTIME_CATALOG_AGENT_NAME,
      content: `---
name: ${SUBAGENT_RUNTIME_CATALOG_AGENT_NAME}
description: E2E custom subagent for runtime reasoning catalog coverage.
model: custom:${SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID}:${SUBAGENT_RUNTIME_CATALOG_MODEL}
thoughtLevel: invalid-e2e
tools: Read
maxTurns: 1
---
You are the E2E Claude catalog reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isSubagentProviderRegistryColdStartSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME,
      content: `---
name: ${SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME}
description: E2E subagent bound to an alternate provider for cold-start registry sync reproduction.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
thoughtLevel: high
tools: Read
maxTurns: 1
---
You are the E2E provider registry reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isToolErrorSurfaceSpec(specs)) {
    profileEntries.push(
      {
        name: TOOL_ERROR_SURFACE_STALE_AGENT_NAME,
        content: `---
name: ${TOOL_ERROR_SURFACE_STALE_AGENT_NAME}
description: E2E subagent intentionally bound to a stale provider/model for tool error surface coverage.
model: custom:e2e-stale-provider:e2e-stale-model
tools: Read
maxTurns: 1
---
You are the stale E2E reviewer. This profile should fail before any child model request.
`,
      },
      {
        name: TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME,
        content: `---
name: ${TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME}
description: E2E subagent used as the healthy sibling when another Agent tool fails.
tools: Read
maxTurns: 1
---
You are the healthy E2E reviewer. Reply only with the requested marker.
`,
      },
    );
  }

  if (specs.some((spec) => spec.includes(SUBAGENT_TEAM_SCOPE_SPEC))) {
    profileEntries.push({
      name: "e2e-team-scope-reviewer",
      content: `---
name: e2e-team-scope-reviewer
description: E2E custom subagent bound to a Team connection without organization/project scope.
model: custom:team-plan:e2e-missing-scope:team-model
tools: Read
maxTurns: 1
---
This child must fail before sending a provider request when the Team scope is unavailable.
`,
    });
  }

  if (profileEntries.length === 0) {
    return;
  }

  for (const agentsDir of [E2E_USER_AGENTS_DIR, E2E_CLI_AGENTS_DIR]) {
    // 修复原因：CLI runtime 从 storageRoot/agents 加载用户 subagent profile，
    // 而设置页/历史路径曾使用 .zcode/cli/agents。双写只作用于本复现 spec，
    // 避免路径差异让 case 停在 agent type not found，而不是 provider registry 缺失。
    mkdirSync(agentsDir, { recursive: true });
    for (const profile of profileEntries) {
      const profilePath = resolve(agentsDir, `${profile.name}.md`);
      // 同 agents-state：reloadSession 不能覆盖设置页已经保存的当前 Markdown。
      if (!existsSync(profilePath)) {
        writeFileSync(profilePath, profile.content, "utf-8");
      }
    }
  }
}
async function seedUpstreamE2EModelConfig(specs: string[] = []) {
  if (isOAuthCredentialRecoverySpec(specs) || usesProviderReadinessColdStartFixture(specs)) {
    // Bugfix: OAuth 凭据恢复及 provider-readiness 冷启动 fixture 必须保持
    // 无可用本地模型配置，避免默认 上游 回放 provider 绕过登录/执行门禁。
    return;
  }

  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    return;
  }

  // 修复原因：固定 e2e 默认回放真实采集 fixture，capture 模式才访问线上
  // 上游；baseURL 必须在每个 session 重置前跟随当前 HTTP 模式写入配置。
  const anthropicBaseURL = buildUpstreamE2EAnthropicBaseUrl();
  const modelProviderListFilteringSpec = specs.some((spec) =>
    spec.includes("conversation-session-model-provider-list-filtering.test.ts"),
  );
  const builtInSubagentModelOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const settingsSubagentCreateEditPersistenceSpec =
    isSettingsSubagentCreateEditPersistenceSpec(specs);
  const exposeSubagentReasoningMetadata =
    // 模型配置隔离和 Edit/Fork 继承直接检查请求参数；空映射会吞掉所选档位。
    specs.some((spec) =>
      /conversation-session-(model-config|model-switch-tool-edit-fork|model-switch-compact|model-switch-auto-compact|goal-session-model|new-session-inherits-model|draft-model-switch-first-send|model-provider-session-isolation|upstream-workspace-smoke|model-switch-edit-fork|model-switch-queue|same-model-provider-identity)\.test\.ts$/.test(
        spec,
      ),
    ) ||
    // SHR 回归检查 child 的真实 wire 参数；仅给菜单 high/max 而把 map 设为 {}
    // 会把所选档位从请求中删掉，导致配置更新用例在第一轮就误报参数丢失。
    specs.some((spec) =>
      /conversation-session-subagent-(runtime-refresh|catalog-refresh|profile-fields|context-boundaries|multi-workspace|cross-host)\.test\.ts$/.test(
        spec,
      ),
    ) ||
    // 思考隔离专项需要核对真实 wire；空 Map 会让参数缺席，无法验证 session 隔离。
    specs.some((spec) =>
      /conversation-session-(thought-level-session-isolation|readstate-model-isolation|v4-goal)\.test\.ts$/.test(
        spec,
      ),
    ) ||
    builtInSubagentModelOverridesSpec ||
    settingsSubagentCreateEditPersistenceSpec ||
    specs.some((spec) => spec.includes("plugin-subagent-override-cold.test.ts")) ||
    isSubagentCodingPlanLoginCatalogStaleSpec(specs);
  const subagentRuntimeCatalogReasoningSpec = isSubagentRuntimeCatalogReasoningSpec(specs);
  // 原因：pending 目录曾统一使用 240/80，导致普通续发插入无关 Compact，
  // 并在转正移动文件后改变测试语义。只有显式自动压缩场景使用小窗口。
  const autoCompactSpec = specs.some((spec) =>
    /conversation-session-(compact-auto|compact-auto-actions|goal-run-cases|model-switch-auto-compact|subagent-runtime-refresh)\.test\.ts$/.test(
      spec,
    ),
  );
  const contextWindow = upstreamE2EContextWindowOverride ?? (autoCompactSpec ? 240 : 128000);
  const maxOutputTokens = upstreamE2EMaxOutputTokensOverride ?? (autoCompactSpec ? 80 : undefined);
  // 菜单只设置下次发送意图；App 和 Agent 使用相同窗口，不再伪造 1 token 触发旧 guard。
  const appContextWindow = contextWindow;
  const appMaxOutputTokens = maxOutputTokens;
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  // 工具栏用例实际选择 high/max；只声明 disabled 会在进入交互断言前失败。
  const composerToolbarSpec = specs.some((spec) =>
    spec.includes("conversation-session-v4-composer-toolbar.test.ts"),
  );
  // 通用 fixture 自带完整 Option Spec，SSH 目标不依赖本机 E2E Built-in 补全。
  // Registry 以末项作为最高档；旧夹具将默认值放首项，导致 alternate 的 max 被 high 覆盖。
  const reasoning = (): PersonalProviderConfigSeed["models"][number]["reasoningLevel"] => ({
    values: specs.some((spec) => spec.endsWith("conversation-session-v4-goal.test.ts"))
      ? ["high", "low", "max"]
      : // 默认 env 的准备步骤选择 high；只声明 disabled 会在进入被测流程前失败。
        e2eProviderPresetName === "env" ||
          e2eProviderPresetName === "stagingmodel" ||
          composerToolbarSpec
        ? builtInSubagentModelOverridesSpec
          ? ["off", "low", "high", "max"]
          : ["high", "max"]
        : ["disabled"],
    // 只有专项 wire 用例注入思考参数；普通 replay 的响应节奏由 fixture 控制。
    map: exposeSubagentReasoningMetadata
      ? '{"thinking":{"type":"enabled","budget_tokens":1024},"output_config":{"effort":reasoningLevel}}'
      : "{}",
  });
  const model = (
    id: string,
    visibility?: "visible" | "hidden",
  ): PersonalProviderConfigSeed["models"][number] => ({
    id,
    contextWindow: appContextWindow,
    // 图片布局和 Stop 收尾用例必须检查真实图片 wire 内容，限定这些 fixture 支持图片输入。
    ...(specs.some(
      (spec) =>
        spec.includes("conversation-session-v4-attachment-layout.test.ts") ||
        spec.includes("conversation-session-stop-tool-results.test.ts"),
    )
      ? { inputModalities: ["text", "image"] as const }
      : {}),
    ...(appMaxOutputTokens !== undefined ? { maxOutputTokens: appMaxOutputTokens } : {}),
    reasoningLevel: reasoning(),
    ...(visibility ? { enabled: visibility !== "hidden" } : {}),
  });
  const provider = (params: {
    apiKey?: string;
    baseURL?: string;
    enabled?: boolean;
    id: string;
    label: string;
    models: PersonalProviderConfigSeed["models"];
    visibility?: "visible" | "hidden";
  }): PersonalProviderConfigSeed => ({
    apiFormat: "anthropic-messages",
    apiKey: params.apiKey ?? apiKey,
    baseURL: params.baseURL ?? anthropicBaseURL,
    enabled: params.enabled ?? true,
    id: params.id,
    label: params.label,
    models: params.models,
    ...(params.visibility ? { visibility: params.visibility } : {}),
  });
  const appProviders: PersonalProviderConfigSeed[] = [
    provider({
      id: e2eProviderPreset.providerId,
      label: e2eProviderPreset.providerName,
      models: [
        model(e2eProviderPreset.model),
        ...(e2eProviderPresetName === "env" ? [model(E2E_PROVIDER_SECONDARY_MODEL)] : []),
      ],
    }),
    ...(e2eProviderPresetName === "env"
      ? [
          provider({
            id: E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
            label: E2E_PROVIDER_ALTERNATE_PROVIDER_NAME,
            models: [model(E2E_PROVIDER_SECONDARY_MODEL)],
          }),
        ]
      : []),
    ...(subagentRuntimeCatalogReasoningSpec
      ? [
          provider({
            id: SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID,
            label: SUBAGENT_RUNTIME_CATALOG_PROVIDER_NAME,
            // I68 验证四档父子请求隔离；通用 high/max 夹具不能代替其明确的 Option Spec。
            models: [
              {
                ...model(SUBAGENT_RUNTIME_CATALOG_MODEL),
                maxOutputTokens: 32_000,
                reasoningLevel: {
                  values: ["low", "medium", "high", "xhigh"],
                  map: '{"thinking":{"type":"enabled","budget_tokens":reasoningLevel == "low" ? 4000 : reasoningLevel == "medium" ? 8000 : reasoningLevel == "high" ? 16000 : 31999},"output_config":{"effort":reasoningLevel}}',
                },
              },
            ],
          }),
        ]
      : []),
    ...(modelProviderListFilteringSpec
      ? [
          provider({
            id: "e2e-hidden-provider",
            label: "Hidden Provider",
            models: [model("hidden-provider-model")],
            visibility: "hidden",
          }),
          provider({
            id: "e2e-visible-provider-hidden-model",
            label: "Visible Provider With Hidden Model",
            models: [model("visible-companion-model"), model("hidden-model", "hidden")],
          }),
          provider({
            enabled: false,
            id: "e2e-hidden-disabled",
            label: "Hidden Disabled Provider",
            models: [model("hidden-disabled-model")],
          }),
          provider({
            apiKey: "",
            id: "e2e-hidden-no-key",
            label: "Hidden No Key Provider",
            models: [model("hidden-no-key-model")],
          }),
          provider({
            baseURL: "",
            id: "e2e-hidden-no-endpoint",
            label: "Hidden No Endpoint Provider",
            models: [model("hidden-no-endpoint-model")],
          }),
          provider({
            baseURL: `${anthropicBaseURL}/builtin-personal-conflict`,
            id: "e2e-zai-template-provider",
            label: "Z.ai Template Provider E2E",
            models: [model("glm-5.3")],
          }),
        ]
      : []),
  ];
  for (const provider of appProviders) {
    await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  }
  await seedPersonalDefaultModelSelection(E2E_APP_PROVIDER_CONFIG_FILE, {
    providerId: e2eProviderPreset.providerId,
    modelId: e2eProviderPreset.model,
    // 远端 Provisioning 只接受完整模型选择；默认模型缺少思考档位会使 SSH 首连与
    // OP10 新建会话退回 Registry 推荐。无思考能力的模型也显式选择 disabled。
    options: { reasoningLevel: readE2EThoughtLevel() || "disabled" },
  });
}
async function seedModelOutputTokenProviders(specs: string[] = []) {
  const providerSeeds: ModelOutputTokenProviderSeed[] = [];
  if (specs.some((spec) => spec.includes(MODEL_OUTPUT_TOKEN_BUDGET_SPEC))) {
    providerSeeds.push({
      id: "output-token-budget-e2e",
      models: [
        { contextWindow: 128_000, id: "otb-default" },
        { contextWindow: 128_000, id: "otb-16k", limitOutput: 16_000 },
        { contextWindow: 128_000, id: "otb-64k", maxOutputTokens: 64_000 },
        { contextWindow: 128_000, id: "otb-runtime-refresh" },
      ],
      name: "Output Token Budget E2E",
    });
  }
  if (specs.some((spec) => spec.includes(MODEL_OUTPUT_TOKEN_PREFLIGHT_SPEC))) {
    providerSeeds.push({
      id: "output-token-preflight-e2e",
      models: [
        {
          contextWindow: 128_000,
          id: "otb-preflight-64k",
          limitOutput: 64_000,
        },
        {
          contextWindow: 64_000,
          id: "otb-preflight-smoke-64k-48k",
          limitOutput: 48_000,
        },
        {
          contextWindow: 200_000,
          id: "otb-preflight-smoke-200k-128k",
          limitOutput: 128_000,
        },
      ],
      name: "Output Token Preflight E2E",
    });
  }
  if (specs.some((spec) => spec.includes(OUTPUT_LIMIT_CONTINUE_MARKDOWN_PROTOCOLS_SPEC))) {
    providerSeeds.push(
      {
        id: "otc-protocol-chat",
        models: [{ contextWindow: 128_000, id: "otc-protocol-chat" }],
        name: "OTC Chat Completions E2E",
      },
      {
        apiFormat: "openai-responses",
        id: "otc-protocol-responses",
        kind: "openai",
        models: [{ contextWindow: 128_000, id: "otc-protocol-responses" }],
        name: "OTC Responses API E2E",
        supportedFormat: "responses",
      },
    );
  }
  if (providerSeeds.length === 0) {
    return;
  }

  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    throw new Error("Output-token E2E 缺少可用 provider API Key");
  }
  const appProviders = providerSeeds.map(
    (provider): PersonalProviderConfigSeed => ({
      // OTC11 明确验证两种协议；不能把 Responses seed 再覆盖成 Chat Completions。
      apiFormat: provider.apiFormat ?? "openai-chat-completions",
      apiKey,
      baseURL: upstreamE2EBaseUrl,
      enabled: true,
      id: provider.id,
      label: provider.name,
      models: provider.models.map((model) => ({
        contextWindow: model.contextWindow,
        id: model.id,
        ...(model.maxOutputTokens === undefined && model.limitOutput === undefined
          ? {}
          : { maxOutputTokens: model.maxOutputTokens ?? model.limitOutput }),
      })),
    }),
  );
  for (const provider of appProviders) {
    await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  }
}
async function seedContextWindowColdResumeModelConfig() {
  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    throw new Error("context-window cold-resume 缺少可用 provider API Key");
  }
  const provider: PersonalProviderConfigSeed = {
    id: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
    label: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_NAME,
    baseURL: upstreamE2EBaseUrl,
    apiFormat: "openai-chat-completions",
    apiKey,
    enabled: true,
    models: [
      {
        id: CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
        contextWindow: CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS,
        maxOutputTokens: CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS,
      },
    ],
  };
  await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  await seedPersonalDefaultModelSelection(E2E_APP_PROVIDER_CONFIG_FILE, {
    providerId: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
    modelId: CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
  });
}
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
  // Bug 根因：Windows 上 Agent CLI 只能经过 zcode-runtime-host.exe 启动，而下面的
  // build:no-runtime-assets 不产出它，Windows CI 全部 case 报 runtime host missing /
  // slash 目录为空。复用构建（ZCODE_E2E_SKIP_BUILD）也必须检查，产物不受 out stamp 保护。
  ensureWindowsRuntimeHost();
  // Bug 原因：轻量构建不产出预装入口 shim，Windows 安装到运行检查时才失败。
  // 在复用判断之前准备，避免旧 out 存在但本机原生资源缺失时进入 case。
  ensureWindowsPreinstalledEntryShim();
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

// 非 Windows 由脚本 --if-windows 跳过；--ensure 按源码摘要复用已有产物，只在缺失或过期时调用 CMake。
// 调用方持有 E2E build 锁，分片 runner 不会并发写同一个 bundled-tools 目录。
function ensureWindowsRuntimeHost() {
  execFileSync(
    process.execPath,
    [resolve(REPO_ROOT, "scripts/build-windows-runtime-host.mjs"), "--if-windows", "--ensure"],
    { cwd: REPO_ROOT, env: createPnpmChildEnv(), stdio: "inherit" },
  );
}

function ensureWindowsPreinstalledEntryShim() {
  if (process.platform !== "win32") return;
  const targetArch = (process.env.ZCODE_TARGET_ARCH ?? process.arch).toLowerCase();
  // 分片父进程已准备缓存；child 只校验并取得独立副本，不能再次编译共享产物。
  const mode = shouldReuseDesktopE2EBuild(process.env) ? "--check" : "--ensure";
  execFileSync(
    process.execPath,
    [
      resolve(REPO_ROOT, "packages/desktop/scripts/build-windows-preinstalled-entry-shim.mjs"),
      mode,
      "--stage-dir",
      resolve(E2E_RUN_CACHE_DIR, "bundled-tools", `win32-${targetArch}`, "preinstalled-entry-shim"),
    ],
    {
      cwd: REPO_ROOT,
      env: createPnpmChildEnv(),
      stdio: "inherit",
      timeout: PREINSTALLED_ENTRY_SHIM_PROCESS_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
  );
}

function runPnpmWorkspaceCommand(
  args: string[],
  options?: { timeoutMs?: number; env?: Record<string, string> },
) {
  execFileSync(PNPM_COMMAND, args, {
    cwd: REPO_ROOT,
    env: { ...createPnpmChildEnv(), ...(options?.env ?? {}) },
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
  if (E2E_SHARED_STAGE && process.platform === "win32") {
    // Windows 没有写时复制，整份复制 out 要 11s；renderer（6650 个文件、141MB）运行时只读，
    // 按签名共享一份，main 等小目录照常复制（用例会往 main 里写启动文件）。
    const staged = await stageE2EAppOutputWithSharedRenderer({
      sourceDir: DESKTOP_BUILD_OUTPUT_DIR,
      destinationDir: E2E_APP_OUTPUT_DIR,
      cacheRoot: resolve(E2E_SHARED_STAGE_DIR, "renderer"),
    });
    console.log(`[e2e] renderer ${staged.reused ? "复用" : "新建"}共享快照 ${staged.renderer}`);
  } else {
    await stageE2EAppOutput(DESKTOP_BUILD_OUTPUT_DIR, E2E_APP_OUTPUT_DIR);
  }
  if (!existsSync(E2E_APP_ENTRY_POINT)) {
    throw new Error(`[e2e] staged desktop main entrypoint missing: ${E2E_APP_ENTRY_POINT}`);
  }
  if (!isRendererE2EStoreBridgeCompiled(E2E_APP_RENDERER_ASSETS_DIR)) {
    throw new Error("[e2e] staged renderer is missing VITE_ZCODE_E2E_STORE_BRIDGE=1");
  }
}

/**
 * 按本轮调度的 spec 准备并 stage SSH remote release；不需要时跳过，也不记录计时阶段。
 * 规格见 docs/testing/conversation-session-automatic-e2e-ci.md「SSH remote assets 自动准备」。
 */
async function prepareSshRemoteReleaseForRun(
  specs: string[],
  agentBundleBuiltThisRun: boolean,
): Promise<void> {
  if (
    !hasRequiredSshE2EEnvironment(process.env) &&
    !process.env.ZCODE_E2E_SSH_HOST?.trim() &&
    !process.env.ZCODE_E2E_SSH_A_HOST?.trim() &&
    !process.env.ZCODE_E2E_SSH_B_HOST?.trim()
  ) {
    return;
  }
  // Bug 根因：过去只要 runner 配置了 SSH 环境变量就准备。CI 的 SSH 凭据是项目级变量，
  // 只改普通 spec 的 MR（2026-11-17 job 1143279，6 个 spec 均不用 SSH）也会因提交回执不匹配
  // 重建全部平台的远端包并多构建一轮 agent。改为只看本轮调度 spec 的 import 关系；
  // 判定漏掉的用例由 ssh-remote-p0 的配置入口兜底失败。
  const requiredSpecs = await listSpecsRequiringRemoteRelease({
    desktopDir: DESKTOP_DIR,
    specFiles: resolveE2EScheduledSpecFiles({
      baseDir: DESKTOP_DIR,
      exclude: config.exclude ?? [],
      specs,
    }),
  });
  if (requiredSpecs.length === 0) {
    console.log("[e2e] no scheduled spec needs the SSH remote release; skipping remote assets");
    return;
  }
  console.log(
    `[e2e] ${requiredSpecs.length} scheduled spec(s) need the SSH remote release, e.g. ${requiredSpecs[0]}`,
  );
  // 与桌面构建同一把锁：mock-cdn/releases/<version> 是工作区共享目录，并行 runner 不能同时重建。
  await measureE2ELifecyclePhase("prepare:remote-release", { specs: requiredSpecs }, () =>
    withE2EDesktopBuildLock({}, async () => {
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
      // 本机 Docker runner 声明「只需 Linux」时，helper 改读 descriptor 判断两个 Linux 目标，
      // 并只调用 `ZCODE_ENV=test pnpm prepare:remote-assets:linux`；未声明时行为不变。
      await ensureSshRemoteReleaseAssets({
        releaseDir: E2E_REMOTE_RELEASE_SOURCE_DIR,
        buildRevision: process.env.CI_COMMIT_SHA,
        scope: resolveSshRemoteReleaseScope(process.env),
        // Bug 根因：stage:remote-assets 第一个 target 会再跑一次 build-desktop-agent-cli.mjs，
        // 与 prepareZCodeAgentServer 的构建脚本、环境完全相同，一次运行构建两轮 agent。
        // 只有本轮 onPrepare 真实构建过 agent 才让打包器复用（评审 CR-01 第二轮）：
        // ZCODE_E2E_SKIP_AGENT_BUILD=1 只检查入口存在，bundle 可能来自旧构建，必须由打包器重建。
        agentBundleBuiltThisRun,
        prepareReleaseAssets: (request) =>
          runPnpmWorkspaceCommand([request.script, ...request.args], {
            // 防挂死上限：冷缓存全量 prepare 约 10 分钟，给到 30 分钟只兑现在「彻底卡死」时
            // 让 onPrepare 失败退出，正常慢路径不受影响。
            timeoutMs: 30 * 60 * 1000,
            env: request.env,
          }),
      });
      // Bug 根因：dual-SSH case 只配置 A/B target；若这里只识别 common host，就不会把
      // 当前源码构建的 remote release 放进 runId 隔离目录，远端会继续复用同版本的旧
      // server bundle，并用旧协议 schema 拒绝 enabledSource 等新字段。
      await stageE2EAppOutput(E2E_REMOTE_RELEASE_SOURCE_DIR, E2E_REMOTE_RELEASE_OUTPUT_DIR);
    }),
  );
  // worker 的兜底检查只认 onPrepare 下发的目录：runnerEnv 是传给 worker 的唯一可靠通道。
  if (!config.runnerEnv) {
    throw new Error("wdio config 缺少 runnerEnv，remote release 目录无法透传给 worker");
  }
  Object.assign(config.runnerEnv, { [REMOTE_RELEASE_DIR_ENV]: E2E_REMOTE_RELEASE_OUTPUT_DIR });
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

/** 返回本轮是否真实构建了 agent bundle；只检查入口存在的分支返回 false（见 prepareSshRemoteReleaseForRun）。 */
function prepareZCodeAgentServer(): boolean {
  if (E2E_PACKAGED_APP_BINARY_PATH) {
    // 真正的 Preview 包必须使用随包 Agent，禁止测试 runner 注入源码入口掩盖漏打包。
    configureZCodeAgentServerEnv();
    return false;
  }
  if (process.env.ZCODE_E2E_SKIP_AGENT_BUILD === "1") {
    // 修复原因：Windows 全量 E2E 分片由父 runner 统一构建一次 agent；子 WDIO 若再次构建，
    // 会并发覆盖同一 dist 目录。跳过时仍校验入口，避免旧或缺失产物静默启动。
    console.log("[e2e] ZCODE_E2E_SKIP_AGENT_BUILD=1, skipping agent build");
    if (!existsSync(ZCODE_CLI_ENTRYPOINT)) {
      throw new Error(`ZCode CLI entrypoint not found: ${ZCODE_CLI_ENTRYPOINT}`);
    }
    configureZCodeAgentServerEnv();
    return false;
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
  return true;
}

function configureZCodeAgentServerEnv() {
  // 数据库准备只信任 bundled resolver 确认的入口。E2E 即使把本轮 bundle 填进自定义
  // command，也会按 unsupported_runtime 拒绝；清除继承的覆盖，复用正式桌面解析链。
  delete process.env.ZCODE_AGENT_SERVER_COMMAND;
  delete process.env.ZCODE_AGENT_SERVER_ARGS_JSON;
  delete process.env.ZCODE_AGENT_SERVER_CWD;
}

function assertUpstreamCaptureConfig() {
  if (!e2eProviderPreset.baseUrl) {
    throw new Error(
      `E2E_PROVIDER_HTTP_MODE=capture with ${e2eProviderPresetName} requires E2E_PROVIDER_BASE_URL.`,
    );
  }
  const apiKey = readE2EProviderApiKey();
  if (apiKey && apiKey !== "xxx") {
    return;
  }

  // 修复原因：默认 e2e 已切成 fixture replay；只有显式 capture 才会访问真实
  // 上游。采集 fixture 时必须提前校验真实 key，避免把失败响应固化进仓库。
  throw new Error(
    `E2E_PROVIDER_HTTP_MODE=capture with ${e2eProviderPresetName} requires one of: ${e2eProviderPreset.apiKeyEnvNames.join(", ")}.`,
  );
}

function readE2EProviderApiKey() {
  for (const envName of e2eProviderPreset.apiKeyEnvNames) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function ensureUpstreamReplayConfig() {
  process.env.E2E_PROVIDER_API_KEY = E2E_PROVIDER_REPLAY_API_KEY;
}

async function startUpstreamE2EHttp(specs: string[] = []) {
  await stopUpstreamE2EHttp();
  if (
    upstreamE2EHttpMode === "capture" ||
    specs.some((spec) => spec.includes("conversation-session-toolsearch"))
  ) {
    applyE2EWorkerReplayProxyEnv(process.env, [], "", configuredE2EWorkerNetworkEnv);
    await startUpstreamCaptureProxy(specs);
    return;
  }

  ensureUpstreamReplayConfig();
  upstreamReplayServer = await startUpstreamReplayServer({
    artifactPath: UPSTREAM_CAPTURE_ARTIFACT_PATH,
    fixtureVariables: createE2EReplayFixtureVariables(E2E_HOME_DIR),
    fixturePaths: await resolveUpstreamReplayFixturePaths(specs),
  });
  upstreamE2EBaseUrl = upstreamReplayServer.baseUrl;
  process.env.E2E_PROVIDER_CAPTURE_MODE = "replay";
  process.env.E2E_PROVIDER_CAPTURE_PATH = upstreamReplayServer.artifactPath;
  process.env.E2E_PROVIDER_CAPTURE_PROXY_URL = upstreamReplayServer.baseUrl;
  process.env.E2E_PROVIDER_EXPECTED_HOST = `${upstreamReplayServer.host}:${upstreamReplayServer.port}`;
  process.env.E2E_PROVIDER_EXPECTED_PROTOCOL = "http";
  process.env.E2E_PROVIDER_RUNTIME_BASE_URL = upstreamReplayServer.baseUrl;
  process.env.NO_PROXY = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;
  process.env.no_proxy = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;
  applyE2EWorkerReplayProxyEnv(
    process.env,
    specs,
    upstreamReplayServer.baseUrl,
    configuredE2EWorkerNetworkEnv,
  );
  writeUpstreamE2ERuntimeFile("replay", upstreamReplayServer.baseUrl);
}

async function readRequestJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveRead) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveRead());
  });
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function startUpstreamCaptureProxy(specs: readonly string[]) {
  const toolSearchFixture = specs.some((spec) => spec.includes("conversation-session-toolsearch"));
  if (!toolSearchFixture) assertUpstreamCaptureConfig();
  const toolSearchSpec = specs.find((spec) => spec.includes("conversation-session-toolsearch"));
  const toolSearchResponses = toolSearchSpec
    ? await loadToolSearchResponses(
        toolSearchSpec
          .replaceAll("\\", "/")
          .split("/")
          .at(-1)!
          .replace(/\.test\.ts$/, ""),
      )
    : undefined;
  const apiKey = toolSearchFixture ? E2E_PROVIDER_REPLAY_API_KEY : readE2EProviderApiKey();
  upstreamCaptureProxy = await startE2ENetworkCaptureProxy({
    artifactPath: UPSTREAM_CAPTURE_ARTIFACT_PATH,
    // Bugfix: beforeSession 会在启动 capture proxy 后重置 .e2e-home；
    // CA 若放在 .e2e-home 下会被删掉，agent 随后读取 ZCODE_AGENT_CA_CERT 就会 ENOENT。
    caDir: E2E_NETWORK_CAPTURE_CA_DIR,
    recordResponseChunkTimeline: true,
    responseChunkTimelineLimitBytes: UPSTREAM_CAPTURE_RESPONSE_CHUNK_TIMELINE_BYTES,
    responsePreviewLimitBytes: UPSTREAM_CAPTURE_RESPONSE_PREVIEW_BYTES,
    responseMocks: undefined,
  });
  process.env.E2E_PROVIDER_API_KEY = apiKey;
  upstreamE2EBaseUrl = e2eProviderPreset.baseUrl;

  // 修复原因：capture 模式用于更新固定 fixture，需要真实上游响应和请求抓包；
  // 默认 replay 模式不会走这里，避免固定回归受网络、余额、限流影响。
  for (const [key, value] of Object.entries(upstreamCaptureProxy.env)) {
    process.env[key] = value;
  }
  process.env.E2E_PROVIDER_CAPTURE_MODE = "capture";
  process.env.E2E_PROVIDER_CAPTURE_PATH = upstreamCaptureProxy.artifactPath;
  process.env.E2E_PROVIDER_CAPTURE_PROXY_URL = upstreamCaptureProxy.proxyUrl;
  process.env.E2E_PROVIDER_EXPECTED_HOST = e2eProviderPreset.expectedHost;
  process.env.E2E_PROVIDER_EXPECTED_PROTOCOL = e2eProviderPreset.expectedProtocol;
  process.env.E2E_PROVIDER_RUNTIME_BASE_URL = e2eProviderPreset.baseUrl;
  writeUpstreamE2ERuntimeFile("capture", e2eProviderPreset.baseUrl);
}

function writeUpstreamE2ERuntimeFile(mode: "capture" | "replay", baseUrl: string) {
  // 修复原因：WDIO hook 内设置的 env 不一定能被所有 spec 代码稳定读取；
  // 用 runtime 文件暴露本轮代理地址，避免自定义 provider case 误读旧 CLI config 端口。
  mkdirSync(E2E_NETWORK_CAPTURE_DIR, { recursive: true });
  writeFileSync(
    E2E_PROVIDER_RUNTIME_FILE,
    JSON.stringify(
      {
        artifactPath: process.env.E2E_PROVIDER_CAPTURE_PATH ?? "",
        baseUrl,
        mode,
      },
      null,
      2,
    ),
  );
}

async function stopUpstreamE2EHttp() {
  if (!upstreamCaptureProxy) {
    if (upstreamReplayServer) {
      await upstreamReplayServer.stop();
      upstreamReplayServer = null;
    }
    return;
  }
  await upstreamCaptureProxy.stop();
  upstreamCaptureProxy = null;
  if (upstreamReplayServer) {
    await upstreamReplayServer.stop();
    upstreamReplayServer = null;
  }
}

function restoreE2EProviderEndpointEnv() {
  const endpointEnv = getE2EProviderEndpointEnv(
    configuredE2ESpecs,
    e2eProviderPresetName,
    upstreamE2EHttpMode,
  );
  if (Object.keys(endpointEnv).length > 0) {
    // 修复原因：每轮 beforeSession 都会执行 mock 清理；请求安全 capture 与 live-team
    // 的生产控制面选择必须恢复，否则生产凭据会被送到测试域。
    Object.assign(process.env, endpointEnv);
    return;
  }
}

async function startDynamicWorkflowConfigE2EMock(specs: string[] = []) {
  const scenario = resolveDynamicWorkflowConfigMockScenario(specs);
  if (!scenario) {
    await stopDynamicWorkflowConfigE2EMock();
    return;
  }
  if (dynamicWorkflowConfigMockServer?.scenario !== scenario) {
    await stopDynamicWorkflowConfigE2EMock();
    dynamicWorkflowConfigMockServer = await startDynamicWorkflowConfigMockServer(scenario);
  }
  applyDynamicWorkflowConfigMockEnv(process.env, dynamicWorkflowConfigMockServer.baseUrl);
}

async function stopDynamicWorkflowConfigE2EMock() {
  if (!dynamicWorkflowConfigMockServer) {
    return;
  }
  const baseUrl = dynamicWorkflowConfigMockServer.baseUrl;
  await dynamicWorkflowConfigMockServer.stop();
  dynamicWorkflowConfigMockServer = null;
  clearDynamicWorkflowConfigMockEnv(process.env, baseUrl);
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
export async function resetE2EHome(specs: string[]) {
  await removeE2EHomeWithRetry();
  mkdirSync(E2E_HOME_DIR, { recursive: true });
  // 先拷官方插件缓存，再写各 spec 的 fixture，避免覆盖 fixture 自己写入的插件状态。
  await installOfficialPluginCacheTemplate({
    homeDir: E2E_HOME_DIR,
    templateHome: E2E_OFFICIAL_PLUGIN_CACHE_TEMPLATE_HOME,
  });
  seedE2EStartupState(specs);
  await seedRemoteOnboardingFixture({
    // 营销触达域（WP-07）已裁剪；保留远控 profile 引导夹具的既有开关语义。
    enabled: process.env.ZCODE_E2E_REMOTE_PROFILE === "1",
    specs,
    appConfigDir: E2E_APP_CONFIG_DIR,
  });
  if (workerSpecsContain(specs, PROJECT_UPGRADE_ORDER_SPEC)) {
    await seedProjectUpgradeOrderFixture(E2E_HOME_DIR, E2E_APP_SETTINGS_FILE);
  }
  if (specs.some((spec) => spec.endsWith("sidebar-rich-content-performance.test.ts"))) {
    await seedSidebarRichContentFixture({
      cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME),
    });
  }
  if (usesProviderReadinessColdStartFixture(specs) || usesGitReviewEntryFixture(specs)) {
    // SP13 必须在 Host 打开 tasks-index 前同时预置真实 task row 与可打开的
    // CLI session；测试内临时注入会绕过 Header 与 status panel 的真实 task/service 解析链路。
    await seedProviderReadinessHistoryFixture({
      cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_STORAGE_ROOT, "workspace/default"),
      history: {
        sessionId: "sess_e2e_v1_official",
        title: "E2E_V1_OFFICIAL_TASK",
        userText: "E2E_V1_PERSISTED_USER",
        assistantText: "E2E_V1_PERSISTED_ASSISTANT",
        assistantInputTokens: 0,
        assistantOutputTokens: 0,
        modelId: "synthetic-model",
        runtimeProviderId: "synthetic",
        taskProviderId: "glm",
      },
    });
    // 官方旧页目录回归：该 cwd 不加入恢复 tabs，也不先在桌面打开。
    const closedPath = resolve(E2E_STORAGE_ROOT, "workspace/closed-history");
    await mkdir(closedPath, { recursive: true });
    await seedProviderReadinessHistoryFixture({
      cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: closedPath,
      history: {
        sessionId: "sess_e2e_v1_closed",
        title: "E2E_V1_CLOSED_HISTORY",
        userText: "E2E_V1_CLOSED_USER",
        assistantText: "E2E_V1_CLOSED_REPLY",
        assistantInputTokens: 0,
        assistantOutputTokens: 0,
        modelId: "synthetic-model",
        runtimeProviderId: "synthetic",
        taskProviderId: "glm",
      },
    });
  }
  seedE2EWorkerModelStreamConfig(specs);
  await seedE2EModelConfig(specs);
  seedE2EPluginMcpSkillInstalledPlugins(specs);
  seedE2EPluginMcpSkillState(specs);
  await seedE2EWorkspacePluginState(specs);
  await seedE2EBuiltinWorkspacePluginDisable(specs);
  seedE2EBuiltInSubagentModelOverrides(specs);
  seedE2ESubagentProfiles(specs);
  // WT04 第一次打开项目就读取 Git 状态，仓库基线必须在 Electron 启动前准备好。
  if (specs.some((spec) => spec.endsWith("git-worktree-remote-view.test.ts"))) {
    const workspace = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
    const baseline = ".zcode-e2e/managed-worktree/baseline.md";
    await mkdir(dirname(resolve(workspace, baseline)), { recursive: true });
    await runGitFixtureCommand(workspace, ["init", "-q", "-b", "main"]);
    await runGitFixtureCommand(workspace, ["config", "user.email", "zcode-e2e@example.invalid"]);
    await runGitFixtureCommand(workspace, ["config", "user.name", "ZCode E2E"]);
    await writeFile(resolve(workspace, baseline), "baseline\n", "utf8");
    await runGitFixtureCommand(workspace, ["add", baseline]);
    await runGitFixtureCommand(workspace, ["commit", "-qm", "test: wt04 baseline"]);
  }
  await seedE2EGitReviewEntryWorkspace(specs);
  seedE2EGitCommitDialogWorkspace(specs);
  if (
    specs.some((spec) => /conversation-session-history-first(?:-migration)?\.test\.ts$/.test(spec))
  ) {
    await seedSessionHistoryFirstFixture({
      cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME),
      providerId: e2eProviderPreset.providerId,
      modelId: e2eProviderPreset.model,
      thoughtLevel: readE2EThoughtLevel(),
      legacyTitleHandoff: specs.some((spec) =>
        spec.endsWith("conversation-session-history-first-migration.test.ts"),
      ),
    });
  }
  if (specs.some((spec) => spec.includes(HOOKS_LIFECYCLE_SPEC))) {
    // Bug 根因：spec 的 before hook 运行时 app-server 已经读取过 workspace config；
    // 测试内再写 Hooks 只能改变设置页，无法改变本轮 agent runtime。case-local fixture
    // 必须在 beforeSession 的干净 HOME 阶段落盘，确保首个 agent 进程冷启动即加载。
    await installHooksLifecycleFixture();
  }
  if (workerSpecsContain(specs, "conversation-session-stop-tool-results.test.ts")) {
    // Stop 复现的 Hook 必须在 app-server 首次读配置前落盘；spec.before 已晚于预热。
    await installStopToolResultsFixture();
  }
  if (specs.some((spec) => spec.includes(HOOK_TRUST_SPEC))) {
    // 同上：workspace 级 hook trust fixture 必须在首个 agent 进程冷启动前落盘，
    // 否则 SessionStart 软门禁不会在首轮 turn 生效（HK05 的 pending banner 前提）。
    await installHookTrustFixture();
  }
  if (specs.some((spec) => spec.includes(HOOK_TRUST_WORKTREE_SPEC))) {
    // 同上：源仓库任务的 SessionStart 软门禁依赖冷启动前已提交的 Hook 与未提交的脚本修改。
    await installHookTrustWorktreeFixture();
  }
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

// 把插件 MCP skill lifecycle spec 需要的 installed_plugins.json 写到
// `~/.openzwork/cli/plugins/installed_plugins.json`；仅在 spec 命中且 state != not-installed
// 时执行。注意 storageRoot 在 agent 视角是 `<home>/.zcode`，而 pluginStorageRoot
// 是 `<home>/.zcode/cli/plugins`，installed_plugins.json 必须落在后者下面才会被
// bootstrap 的 `listInstalledPluginRecords(pluginStorageRoot)` 读到（见
// `apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts:347`）。
function seedE2EPluginMcpSkillInstalledPlugins(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state || state === "not-installed" || state === "workspace-root") return;
  const templateName =
    state === "installed-enabled"
      ? "installed-plugins.enabled.template.json"
      : "installed-plugins.disabled.template.json";
  const fixturePath = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill", templateName);
  const pluginRoot = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill/e2e-plugin-mcp-ping");
  // 修复原因：Windows 路径的反斜杠直接拼进 JSON 字符串会成为非法转义（如 `\U`），
  // installed_plugins.json 解析失败后插件安装记录整体丢失；必须按 JSON 字符串编码替换。
  const template = readFileSync(fixturePath, "utf-8").replaceAll(
    '"__INSTALL_PATH__"',
    JSON.stringify(pluginRoot),
  );
  // pluginStorageRoot = <home>/.zcode/cli/plugins
  const targetDir = resolve(E2E_STORAGE_ROOT, "cli/plugins");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(resolve(targetDir, "installed_plugins.json"), template, "utf-8");
}

function shouldSeedGitCommitDialogWorkspace(specs: string[] = []) {
  return specs.some((spec) => spec.includes(GIT_COMMIT_DIALOG_UI_FLOW_SPEC));
}

function seedE2EGitCommitDialogWorkspace(specs: string[] = []) {
  if (!shouldSeedGitCommitDialogWorkspace(specs)) {
    return;
  }

  const workspacePath = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
  mkdirSync(resolve(workspacePath, "src"), { recursive: true });
  writeFileSync(resolve(workspacePath, "README.md"), "Git commit dialog E2E workspace\n", "utf-8");
  runGitE2ECommand(workspacePath, ["init"]);
  runGitE2ECommand(workspacePath, ["checkout", "-B", "main"]);
  runGitE2ECommand(workspacePath, ["config", "user.name", "ZCode E2E"]);
  runGitE2ECommand(workspacePath, ["config", "user.email", "zcode-e2e@example.com"]);
  runGitE2ECommand(workspacePath, ["add", "README.md"]);
  runGitE2ECommand(workspacePath, ["commit", "-m", "chore: seed git commit dialog e2e"]);
  runGitE2ECommand(workspacePath, ["branch", "e2e-target"]);

  writeFileSync(
    resolve(workspacePath, "src/staged-file.ts"),
    "export const stagedGitCommitDialogE2E = true;\n",
    "utf-8",
  );
  writeFileSync(
    resolve(workspacePath, "src/unstaged-file.ts"),
    "export const unstagedGitCommitDialogE2E = true;\n",
    "utf-8",
  );
  runGitE2ECommand(workspacePath, ["add", "src/staged-file.ts"]);
}

function runGitE2ECommand(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    env: process.env,
    stdio: "ignore",
  });
}

function seedE2EStartupState(specs: string[] = []) {
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  const useFreshConversationWorkspace = specs.some((spec) =>
    spec.includes("conversation-session-conversation-workspace.test.ts"),
  );
  const legacyDefaultProjectPath = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
  const agentWarmupFixture = AGENT_WARMUP_FIXTURE_SPECS.some((marker) =>
    workerSpecsContain(specs, marker),
  );
  const agentWarmupScenario = SMALL_AGENT_WARMUP_SPECS.some((marker) =>
    workerSpecsContain(specs, marker),
  )
    ? SMALL_AGENT_WARMUP_SCENARIO
    : PASSIVE_AGENT_STARTUP_SCENARIO;
  // 默认工作区 + dormant workspace 并存的启动态：模型回归缺口 spec 与 Agent tab 残留 guest spec
  // 都需要在 legacy 默认工作区里跑对话，再经侧栏切到另一个已恢复的 workspace。
  const defaultPlusDormantWorkspacesFixture = [
    MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
    BROWSER_USE_AGENT_TAB_CLOSED_RESIDUAL_GUEST_SPEC,
  ].some((marker) => workerSpecsContain(specs, marker));
  const passiveWorkspacePaths = agentWarmupFixture
    ? seedPassiveAgentStartupWorkspaces(E2E_HOME_DIR, agentWarmupScenario.workspaceCount)
    : [];
  if (defaultPlusDormantWorkspacesFixture) {
    // 模型回归缺口 spec 既需要 dormant workspace 切换，也需要 legacy 默认工作区
    // 供 provider/replay helper 初始化；两者都放进同一份 lastWorkspaceSession，避免
    // 测试直接绕过用户可见的侧栏入口注入 workspace。
    mkdirSync(legacyDefaultProjectPath, { recursive: true });
  }
  if (!useFreshConversationWorkspace && !agentWarmupFixture) {
    // OW-P024：工作流总览等 E2E 以已打开的项目为前置；产品首次启动已改为 conversation，
    // 测试基线显式 seed 项目会话，避免把“老 case 的 fixture”误当成新用户默认行为。
    mkdirSync(legacyDefaultProjectPath, { recursive: true });
  }
  const now = Date.now();
  const builtInSubagentModelOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const providerReadinessColdStartFixture = usesProviderReadinessColdStartFixture(specs);
  // OpenZWork（OZ-D003 官方账号域）：bigmodel/官方 OAuth 凭据播种分支移除。
  writeFileSync(
    E2E_APP_SETTINGS_FILE,
    JSON.stringify(
      {
        providerFamilyDomain: "zai",
        providerFamilyDomainMigrated: true,
        providerFamilyDomainUpdatedAt: now,
        ...(defaultPlusDormantWorkspacesFixture
          ? {
              recentProjects: [legacyDefaultProjectPath, ...passiveWorkspacePaths],
              lastWorkspaceSession: [legacyDefaultProjectPath, ...passiveWorkspacePaths].map(
                (workspacePath) => ({
                  kind: "local" as const,
                  workspacePath,
                  workspacePurpose: "project" as const,
                }),
              ),
              lastActiveTabIndex: 0,
            }
          : agentWarmupFixture
            ? {
                recentProjects: passiveWorkspacePaths,
                lastWorkspaceSession: passiveWorkspacePaths.map((workspacePath) => ({
                  kind: "local" as const,
                  workspacePath,
                  workspacePurpose: "project" as const,
                })),
                lastActiveTabIndex: agentWarmupScenario.activeWorkspaceIndex,
              }
            : !useFreshConversationWorkspace
              ? {
                  lastWorkspaceSession: [
                    {
                      kind: "local",
                      workspacePath: legacyDefaultProjectPath,
                      workspacePurpose: "project",
                    },
                  ],
                  lastActiveTabIndex: 0,
                }
              : {}),
        ...(shouldSeedGuideInteractionBehavior(specs)
          ? {
              // steer 相关复现需要从当前 worker 的初始 settings 进入 guide 模式；
              // 运行中再改 setting.json 会被 app 启动态写回覆盖，导致实际仍跑 queue。
              zcodeInteractionBehavior: "guide",
            }
          : {}),
        // 「子智能体总在后台运行」产品缺省开启。既有用例的回放按旧形态录制（Agent 可前台、
        // tools 段带 run_in_background），这里统一关闭；开启形态由专门用例保留产品缺省。
        ...(workerSpecsContain(specs, AGENT_ALWAYS_BACKGROUND_SPEC)
          ? {}
          : { agentAlwaysBackgroundEnabled: false }),
        providerFamilyConnectionSelections: {},
        ...(upstreamCaptureProxy
          ? {
              // 修复原因：agent 子进程只信任设置页显式代理配置，不读取
              // WDIO 进程里的标准 HTTPS_PROXY；capture 模式必须预设这里才能抓到真实请求。
              httpProxy: upstreamCaptureProxy.proxyUrl,
              httpProxyCaCertPath: upstreamCaptureProxy.caCertPath,
              httpProxyNoProxy: DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY,
            }
          : {}),
      },
      null,
      2,
    ),
    "utf-8",
  );
  // OpenZWork（OZ-D003）：假 OAuth/JWT 凭据播种全部移除；仅保留 synthetic 注入分支。
  if (providerReadinessColdStartFixture) {
    writeFileSync(E2E_APP_CREDENTIALS_FILE, JSON.stringify({}, null, 2), "utf-8");
  }
  if (workerSpecsContain(specs, "credential-store-recovery.test.ts")) {
    // 容器恢复专项只能在隔离 HOME 注入损坏字节，不能复用真实用户凭据。
    writeFileSync(E2E_APP_CREDENTIALS_FILE, '{"bot:fixture":"synthetic",', "utf8");
  }
}

function isOAuthCredentialRecoverySpec(specs: string[] = []) {
  return (
    workerSpecsContain(specs, OAUTH_CREDENTIAL_RECOVERY_SPEC) ||
    workerSpecsContain(specs, "credential-store-recovery.test.ts")
  );
}

function isJwtExpiryReauthenticationSpec(specs: string[] = []) {
  return workerSpecsContain(specs, JWT_EXPIRY_REAUTHENTICATION_SPEC);
}

function isSubagentCodingPlanLoginCatalogStaleSpec(specs: string[] = []) {
  return workerSpecsContain(specs, SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_SPEC);
}

function usesProviderReadinessColdStartFixture(specs: string[] = []) {
  return (
    workerSpecsContain(specs, PROVIDER_READINESS_AGENT_STARTUP_SPEC) ||
    workerSpecsContain(specs, WINDOWS_AGENT_METRIC_PROBE_ABSENCE_SPEC)
  );
}

function usesContextWindowColdResumeFixture(specs: string[] = []) {
  return workerSpecsContain(specs, CONTEXT_WINDOW_COLD_RESUME_SPEC);
}

function usesTaskIndexRowAuthorityFixture(specs: string[] = []) {
  return workerSpecsContain(specs, TASK_INDEX_ROW_AUTHORITY_SPEC);
}

function usesGitReviewEntryFixture(specs: string[] = []) {
  return workerSpecsContain(specs, GIT_REVIEW_ENTRY_SPEC);
}

async function seedE2EGitReviewEntryWorkspace(specs: string[] = []) {
  if (!usesGitReviewEntryFixture(specs)) return;

  const workspacePath = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
  const caseRoot = resolve(workspacePath, ".zcode-e2e/conversation-session-git-review-entry");
  await mkdir(caseRoot, { recursive: true });
  await runGitFixtureCommand(workspacePath, ["init"]);
  await runGitFixtureCommand(workspacePath, ["checkout", "-B", "main"]);
  await writeFile(
    resolve(caseRoot, "status-panel-review.txt"),
    "status panel Git review e2e fixture\n",
    "utf8",
  );
}

async function runGitFixtureCommand(cwd: string, args: string[]) {
  await execFileAsync(process.env.ZCODE_GIT_BINARY?.trim() || "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function shouldSeedGuideInteractionBehavior(specs: string[] = []) {
  return specs.some(
    (arg) =>
      arg.includes("conversation-session-running-guide-steer.test.ts") ||
      arg.includes("conversation-session-background-guide-steer.test.ts"),
  );
}

// 插件 MCP skill 生命周期 spec 的 spec 名 → seed 状态映射。
// 状态 A 不写任何 plugin 记录；状态 B 装入并启用；状态 C 装入但通过
// `config.json#plugins.enabledPlugins[id] = false` 关闭。读取顺序：
// ZCODE_E2E_PLUGIN_MCP_SKILL_STATE 环境变量 > spec 文件名约定。
const PLUGIN_MCP_SKILL_SPEC_PATTERN =
  /conversation-session-plugin-mcp-skill-(not-installed|installed-enabled|installed-disabled|workspace-enabled|workspace-disabled|workspace-inherited|workspace-isolation|workspace-root|workspace-freeze)\.test\.ts/u;
const PLUGIN_MCP_SKILL_STATES = new Set([
  "not-installed",
  "installed-enabled",
  "installed-disabled",
  "workspace-enabled",
  "workspace-disabled",
  "workspace-inherited",
  "workspace-isolation",
  "workspace-root",
  "workspace-freeze",
]);

function resolvePluginMcpSkillState(
  specs: string[] = [],
):
  | "not-installed"
  | "installed-enabled"
  | "installed-disabled"
  | "workspace-enabled"
  | "workspace-disabled"
  | "workspace-inherited"
  | "workspace-isolation"
  | "workspace-root"
  | "workspace-freeze"
  | null {
  const envState = process.env.ZCODE_E2E_PLUGIN_MCP_SKILL_STATE?.trim();
  if (envState && PLUGIN_MCP_SKILL_STATES.has(envState)) {
    return envState as Exclude<ReturnType<typeof resolvePluginMcpSkillState>, null>;
  }
  for (const arg of specs) {
    // 实时 skill 目录用例与 WPL-008 同一前置：插件已安装，用户与工作区配置都启用。
    if (
      arg.includes("conversation-session-plugin-resident-freeze-cold-resume.test.ts") ||
      arg.includes("conversation-session-plugin-skill-live-catalog.test.ts")
    ) {
      return "workspace-freeze";
    }
    const match = arg.match(PLUGIN_MCP_SKILL_SPEC_PATTERN);
    if (match && match[1]) {
      return match[1] as
        | "not-installed"
        | "installed-enabled"
        | "installed-disabled"
        | "workspace-enabled"
        | "workspace-disabled"
        | "workspace-inherited"
        | "workspace-isolation"
        | "workspace-root"
        | "workspace-freeze";
    }
  }
  return null;
}

// 状态 A 不需要写任何文件；B/C 才落 fixture。
// 这一段必须在 `seedUpstreamE2EModelConfig` 之后调用，因为它要 patch
// 我们刚写好的 `~/.openzwork/cli/config.json`，把 `plugins.enabledPlugins[id]`
// 置为 false 以表达"已安装但关闭"。
function seedE2EPluginMcpSkillState(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state || state === "not-installed" || state.startsWith("workspace-")) return;
  const configPath = resolve(E2E_CLI_CONFIG_DIR, "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as { code?: string }).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const plugins = (config.plugins as Record<string, unknown> | undefined) ?? {};
  const enabledPlugins = (plugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const pluginId = "e2e-plugin-mcp-ping@e2e-fixture";
  // Bugfix: 安装型 plugin 在 candidate 构造时 defaultEnabled=false（见
  // apps/zcode-cli/packages/adapters/src/plugins/index.ts:resolveCandidates）；
  // resolveEnabled 用 `config.enabledPlugins[id] ?? defaultEnabled` 判定，
  // 所以 enabled 状态必须显式写 true，不能只 "delete 字段"。
  if (state === "installed-disabled") {
    enabledPlugins[pluginId] = false;
  } else {
    enabledPlugins[pluginId] = true;
  }
  plugins.enabledPlugins = enabledPlugins;
  config.plugins = plugins;
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// Provider Registry 不再写 CLI config；插件夹具必须显式创建自己的配置，不能依赖模型初始化副作用。
async function readOptionalE2ECliConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function seedE2EWorkspacePluginState(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state?.startsWith("workspace-")) return;

  const workspacePath = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
  const userConfigPath = resolve(E2E_CLI_CONFIG_DIR, "config.json");
  const workspaceConfigPath = resolve(workspacePath, ".zcode", "config.json");
  const pluginId = "e2e-plugin-mcp-ping@e2e-fixture";
  const pluginRoot = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill/e2e-plugin-mcp-ping");
  await mkdir(resolve(workspacePath, ".zcode"), { recursive: true });
  const userConfig = await readOptionalE2ECliConfig(userConfigPath);
  const userPlugins = (userConfig.plugins as Record<string, unknown> | undefined) ?? {};
  const userEnabledPlugins =
    (userPlugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const userOptions =
    (userPlugins.options as Record<string, Record<string, unknown>> | undefined) ?? {};
  userEnabledPlugins[pluginId] = state !== "workspace-isolation";
  userOptions[pluginId] = {
    label: "user-label",
    secret: "E2E_USER_PLUGIN_SECRET",
  };
  userPlugins.enabledPlugins = userEnabledPlugins;
  userPlugins.options = userOptions;
  userConfig.plugins = userPlugins;
  await mkdir(E2E_CLI_CONFIG_DIR, { recursive: true });
  await writeFile(userConfigPath, JSON.stringify(userConfig, null, 2), "utf-8");

  const workspaceEnabledPlugins =
    state === "workspace-inherited"
      ? {}
      : {
          [pluginId]:
            state === "workspace-enabled" ||
            state === "workspace-isolation" ||
            state === "workspace-root" ||
            state === "workspace-freeze",
        };
  const workspaceDirs = state === "workspace-root" ? [pluginRoot] : undefined;
  await writeFile(
    workspaceConfigPath,
    JSON.stringify(
      {
        plugins: {
          ...(workspaceDirs ? { dirs: workspaceDirs } : {}),
          enabledPlugins: workspaceEnabledPlugins,
          options: {
            [pluginId]: {
              label: "workspace-label",
              secret: "E2E_WORKSPACE_PLUGIN_SECRET",
            },
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  if (state === "workspace-isolation") {
    await mkdir(resolve(E2E_HOME_DIR, "WorkspaceB"), { recursive: true });
  }
}

async function seedE2EBuiltinWorkspacePluginDisable(specs: string[] = []) {
  if (
    !specs.some((spec) =>
      spec.includes("conversation-session-plugin-builtin-workspace-disable.test.ts"),
    )
  ) {
    return;
  }

  const pluginId = "skill-creator@zcode-plugins-official";
  const workspaceA = resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME);
  const workspaceB = resolve(E2E_HOME_DIR, "WorkspaceB");
  const userConfig = await readOptionalE2ECliConfig(E2E_CLI_CONFIG_FILE);
  const userPlugins = (userConfig.plugins as Record<string, unknown> | undefined) ?? {};
  const enabledPlugins = (userPlugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const options =
    (userPlugins.options as Record<string, Record<string, unknown>> | undefined) ?? {};
  enabledPlugins[pluginId] = true;
  options[pluginId] = { e2e: "preserve-user-option" };
  userPlugins.enabledPlugins = enabledPlugins;
  userPlugins.options = options;
  userConfig.plugins = userPlugins;
  await mkdir(E2E_CLI_CONFIG_DIR, { recursive: true });
  await writeFile(E2E_CLI_CONFIG_FILE, `${JSON.stringify(userConfig, null, 2)}\n`, "utf-8");

  await mkdir(resolve(workspaceA, ".zcode"), { recursive: true });
  await mkdir(workspaceB, { recursive: true });
  await writeFile(
    resolve(workspaceA, ".zcode", "config.json"),
    `${JSON.stringify(
      {
        plugins: {
          enabledPlugins: {
            [pluginId]: false,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const pluginDataDir = resolve(E2E_CLI_CONFIG_DIR, "plugins", "data", pluginId);
  await mkdir(pluginDataDir, { recursive: true });
  await writeFile(
    resolve(pluginDataDir, "state.json"),
    `${JSON.stringify({ marker: "preserve-user-data" }, null, 2)}\n`,
    "utf-8",
  );
}

async function seedE2EModelConfig(specs: string[] = []) {
  if (usesContextWindowColdResumeFixture(specs)) {
    await seedContextWindowColdResumeModelConfig();
    return;
  }
  await seedUpstreamE2EModelConfig(specs);
  await seedModelOutputTokenProviders(specs);
}

interface ModelOutputTokenProviderSeed {
  apiFormat?: "openai-chat-completions" | "openai-responses";
  id: string;
  kind?: "openai" | "openai-compatible";
  models: Array<{
    contextWindow: number;
    id: string;
    limitOutput?: number;
    maxOutputTokens?: number;
  }>;
  name: string;
  supportedFormat?: "openai" | "responses";
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

// launcher 和 worker 共用同一份文件预算规则，避免 glob 与显式文件走出两套上限。
function resolveMochaTimeout(specs: string[]): number {
  const pluginNoGitGitHubArchiveE2E = specs.some((spec) =>
    spec.includes(PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC),
  );
  const workspacePluginRemoteExplicitSyncE2E = specs.some((spec) =>
    spec.includes("conversation-session-plugin-remote-explicit-sync-workspace.test.ts"),
  );
  return (
    Math.max(
      120000,
      ...[
        {
          // 独立 SSH 用例要等真实首装；WDIO 外层不能先于用例声明的预算截断。
          matched: specs.some((spec) => spec.endsWith("settings-ui-polish-ssh.test.ts")),
          ms: 10 * 60_000,
        },
        {
          // 此用例包含真实 SSH 首装、目录复用、设置定位、16 张截图和原目录重连；
          // 探测校验与残留 daemon 恢复同样经过真实首装和故障恢复，不能在状态断言前被截断。
          // Mocha 外层须与用例的 15 分钟预算一致，不能在首装解压时被默认 120 秒截断。
          // 五工具真实资源候选同样包含串行解压及文档处理；首轮已在 LO 解压时被外层截断。
          // 其余预装候选也在用例内声明了 3～15 分钟预算，但用例内 this.timeout 无法改变外层计时，
          // 原先只放行 real-loopback，其他候选实际仍按 120 秒截断。
          matched: specs.some(
            (spec) =>
              spec.endsWith("conversation-session-remote-sidebar-menus.test.ts") ||
              spec.endsWith("conversation-session-ssh-probe-validation.test.ts") ||
              spec.endsWith("conversation-session-remote-restart-stale-daemon-ssh.test.ts") ||
              spec.endsWith("conversation-session-web-remote-project-directory.test.ts") ||
              spec.endsWith("conversation-session-web-remote-unread.test.ts") ||
              spec.endsWith("conversation-session-web-remote-unread-ssh.test.ts") ||
              spec.endsWith("conversation-session-r3-ui-pairwise.test.ts") ||
              spec.endsWith("conversation-session-remote-accessibility.test.ts") ||
              spec.endsWith("conversation-session-project-settings-return.test.ts") ||
              spec.endsWith("conversation-session-remote-settings-safeguards.test.ts") ||
              spec.endsWith(
                "conversation-session-remote-workspace-folder-unresponsive-ssh.test.ts",
              ) ||
              spec.endsWith("conversation-session-ssh-unsupported-target-errors.test.ts") ||
              spec.endsWith("conversation-session-remote-shared-root-peer-host-ssh.test.ts") ||
              spec.endsWith("conversation-session-remote-server-root-replaced-ssh.test.ts") ||
              spec.endsWith("conversation-session-web-remote-terminal.test.ts") ||
              spec.endsWith("conversation-session-web-remote-terminal-ssh.test.ts") ||
              spec.endsWith(
                "conversation-session-rpn-18-concurrent-remote-task-navigation.test.ts",
              ) ||
              // 草稿模型迁移与 Built-in 刷新节奏都要等服务端下发的 60 秒间隔到期，前者还含多次重启。
              spec.endsWith("conversation-session-draft-model-migration.test.ts") ||
              spec.endsWith("provider-builtin-refresh-cadence.test.ts") ||
              /conversation-session-preinstalled-tools-[a-z-]+\.test\.ts$/.test(spec),
          ),
          ms: 15 * 60_000,
        },
        {
          // 此回归故意阻塞文件系统线程并等待多次目录期限；须保留原 25 分钟总预算，
          // 各目录操作自身的失败期限不变，不能在进入恢复断言前被通用 120 秒截断。
          // real-loopback 在 Windows 上 Defender 逐个扫描解包文件，用例实测 14 分 11 秒，
          // 15 分钟余量不足 1 分钟；单独放宽到 25 分钟，与用例内预算一致。
          matched: specs.some(
            (spec) =>
              spec.endsWith(
                "conversation-session-remote-workspace-folder-thread-exhaustion-ssh.test.ts",
              ) ||
              spec.endsWith("conversation-session-preinstalled-tools-real-loopback.test.ts"),
          ),
          ms: 25 * 60_000,
        },
        {
          // 用例不稳定原因：RDUX15 串行走 SSH、Docker 四个入口的后台连接，用例内声明 20 分钟预算，
          // 但 this.timeout 无法覆盖外层，负载高时在 Docker 段被 120 秒截断（Error: Timeout）。
          // 远端草稿串行覆盖首装、桌面/手机恢复及本地首发，同样声明 20 分钟预算。
          // 安装环境专项也沿用原定 20 分钟，包含真实首装和受限目标检查。
          matched: specs.some(
            (spec) =>
              spec.endsWith("conversation-session-background-connection.test.ts") ||
              spec.endsWith("conversation-session-remote-draft-prewarm.test.ts") ||
              spec.endsWith("conversation-session-r3-install-environment.test.ts") ||
              spec.endsWith("conversation-session-project-device-visibility-ssh.test.ts"),
          ),
          ms: 20 * 60_000,
        },
        {
          // 走查用例串行完成真实首装、失败/取消/后台、设置页与停容器掉线恢复，并全程录屏；
          // 与用例内 30 分钟预算一致。
          // OS 服务回退与真实双版本升级同样保留各自原定的 30 分钟预算。
          matched: specs.some(
            (spec) =>
              spec.endsWith("conversation-session-remote-ui-walkthrough.test.ts") ||
              spec.endsWith("conversation-session-r3-daemon-service-fallback.test.ts") ||
              spec.endsWith("conversation-session-release-3163-upgrade.test.ts"),
          ),
          ms: 30 * 60_000,
        },
        {
          // Bug 原因：完整数据同步演示按章节录制并验证六类配置，原有 90 分钟预算只写在
          // test body；WDIO 外层仍在 120 秒截断，导致正常章节尚未完成便退出且没有最终事实。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-remote-data-sync-demo-walkthrough.test.ts"),
          ),
          ms: 90 * 60_000,
        },
        {
          // 同版本异 SHA 更新要先触发 running-task guard，再取消/确认和重连；
          // 外层 120 秒曾在 guard 等待期间截断，须沿用用例原有 35 分钟预算。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-r3-server-update.test.ts"),
          ),
          ms: 35 * 60_000,
        },
        {
          // 手机用例串行完成真实 SSH 安装、relay 配对和断网恢复；同步其原定预算，
          // 避免 WDIO 在手机离线期间按默认 120 秒截断，this.timeout 无法覆盖外层。
          // DSYNC-18 的本机六类配置验证同样声明 40 分钟；外层提前截断后异步步骤
          // 仍会继续执行，并与下一条 case 争抢输入框，须在进入 test body 前应用预算。
          matched: specs.some(
            (spec) =>
              spec.endsWith("conversation-session-r3-mobile.test.ts") ||
              spec.endsWith("conversation-session-r3-mobile-permission.test.ts") ||
              spec.endsWith("conversation-session-local-config-runtime-usage.test.ts"),
          ),
          ms: 40 * 60_000,
        },
        {
          matched:
            pluginNoGitGitHubArchiveE2E ||
            workspacePluginRemoteExplicitSyncE2E ||
            specs.some((spec) => spec.endsWith("conversation-session-subagent-cross-host.test.ts")),
          ms: 600000,
        },
        {
          // SHR14/SHR17 串行跑两个 workspace、四轮父子请求与设置保存，用例声明
          // this.timeout(240000)，但外层 Mocha 包裹先按 120 秒截断（Windows 上实测约 130 秒）。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-subagent-multi-workspace.test.ts"),
          ),
          ms: 240000,
        },
        {
          // HK20 含建 worktree、两次进设置页与 8 组布局截图，用例声明 180 秒；
          // 用例内 this.timeout 突破不了外层 120 秒，须在此登记同一预算。
          // 写字面量：e2eSpecAdmission.test.ts 只提取本函数体求值，模块常量在那里未定义。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-hook-trust-worktree.test.ts"),
          ),
          ms: 180000,
        },
        {
          matched: specs.some(
            (spec) =>
              spec.endsWith("plugin-management-ui-market.test.ts") ||
              spec.endsWith("conversation-session-virtual-project-mobile.test.ts"),
          ),
          ms: 600000,
        },
        {
          // 后台 Bash 冷恢复回归等待真实 child 结束、120s publisher grace 及 60s 清理节拍。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-background-bash-output.test.ts"),
          ),
          ms: 360000,
        },
        {
          // 长稳用例按既有轮数运行；外层不得在第一轮后按普通用例的两分钟预算退出。
          matched: specs.some((spec) =>
            spec.endsWith("conversation-session-r3-soak-reconnect.test.ts"),
          ),
          ms: 150 * 60_000,
        },
        {
          matched: specs.some((spec) => spec.endsWith("conversation-session-r3-soak-dual.test.ts")),
          ms: (() => {
            const minutes = Number(process.env.R3_SOAK2_MINUTES || "25");
            // 非法值仍由用例自身明确报错；这里只提供与原用例一致的有效预算。
            return ((Number.isFinite(minutes) && minutes > 0 ? minutes : 25) + 20) * 60_000;
          })(),
        },
      ]
        .filter((budget) => budget.matched)
        .map((budget) => budget.ms),
    ) + manualReviewHoldMs
  );
}

export const config: WebdriverIO.Config = {
  runner: "local",
  // 修复原因：waitUntil 的 timeout 无法中断内部已经发出的 WebDriver HTTP 请求；
  // 坏 ContextId 在 hook 中会按默认 120 秒和 3 次重试卡数分钟，必须在协议层设硬边界。
  connectionRetryCount: E2E_WEBDRIVER_REQUEST_LIMITS.retryCount,
  // executeAsyncScript 的浏览器内 script timeout 与 WDIO 到 Chromedriver 的 HTTP timeout
  // 是两层独立门限；公网 Archive case 两层都必须覆盖 Agent 的 180 秒下载上限。
  connectionRetryTimeout: pluginNoGitGitHubArchiveE2E
    ? 300_000
    : E2E_WEBDRIVER_REQUEST_LIMITS.timeoutMs,
  runnerEnv: {
    E2E_PROVIDER_ALTERNATE_MODEL: E2E_PROVIDER_SECONDARY_MODEL,
    E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
    E2E_PROVIDER_ALTERNATE_PROVIDER_NAME,
    E2E_PROVIDER_HTTP_MODE: upstreamE2EHttpMode,
    [REQUESTED_UPSTREAM_HTTP_MODE_ENV]: requestedUpstreamE2EHttpMode ?? "",
    E2E_PROVIDER_MODEL: resolveActiveE2EProviderEnv().model,
    E2E_PROVIDER_ID: resolveActiveE2EProviderEnv().providerId,
    E2E_PROVIDER_NAME: resolveActiveE2EProviderEnv().providerName,
    E2E_PROVIDER_PRESET: e2eProviderPresetName,
    E2E_PROVIDER_THOUGHT_LEVEL: resolveActiveE2EProviderEnv().thoughtLevel,
    ...(upstreamE2EHttpMode === "replay"
      ? { E2E_PROVIDER_API_KEY: E2E_PROVIDER_REPLAY_API_KEY }
      : {}),
    HOME: E2E_HOME_DIR,
    USERPROFILE: E2E_HOME_DIR,
    ZCODE_CREDENTIAL_SECRET:
      resolveE2ECredentialSecret(configuredE2ESpecs, process.env.ZCODE_CREDENTIAL_SECRET) ?? "",
    // PLM-LC-010 使用非 ZCODE_ 前缀验证插件 MCP 的 Claude-compatible env 展开。
    // 值只供 fixture 做 hash 比对，工具结果和截图都不得回显原值。
    E2E_PLUGIN_RUNTIME_SECRET: "e2e-plugin-runtime-secret-fixture-20260718",
    VITE_ZCODE_E2E_STORE_BRIDGE: "1",
    ZCODE_AGENT_SERVER_ARGS_JSON: "",
    ZCODE_AGENT_SERVER_COMMAND: "",
    ZCODE_DATA_BASE_DIR: E2E_HOME_DIR,
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:
      INITIAL_ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ?? E2E_DEFAULT_ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode E2E",
    ZCODE_DESKTOP_HOME_DIR: E2E_HOME_DIR,
    ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "1",
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    ZCODE_E2E_HOME_DIR: E2E_HOME_DIR,
    ZCODE_E2E_ARTIFACT_DIR: e2eReporter.artifactDir,
    ZCODE_E2E_DEFER_APP_DATA_CLEANUP: "1",
    ZCODE_E2E_RUN_ID: E2E_RUN_ID,
    ZCODE_ENV: "test",
    // 修复原因：普通 E2E 的 ZCODE_ENV=test 会把配置接口路由到测试域；
    // 请求安全 capture 与独立 live-team 显式覆盖生产控制面，其他用例保持原行为。
    ...getE2EProviderEndpointEnv(configuredE2ESpecs, e2eProviderPresetName, upstreamE2EHttpMode),
    ...(process.env.ZCODE_TELEMETRY_PARITY_CAPTURE_PATH?.trim()
      ? {
          ZCODE_TELEMETRY_PARITY_CAPTURE_PATH: process.env.ZCODE_TELEMETRY_PARITY_CAPTURE_PATH,
        }
      : {}),
    ...(process.env.ZCODE_TELEMETRY_PARITY_VARIANT?.trim()
      ? {
          ZCODE_TELEMETRY_PARITY_VARIANT: process.env.ZCODE_TELEMETRY_PARITY_VARIANT,
        }
      : {}),
  },
  framework: "mocha",
  reporters: ["spec"],
  maxInstances: e2eMaxInstances,
  maxInstancesPerCapability: e2eMaxInstances,
  ...(containerE2E
    ? {
        autoXvfb: true,
        xvfbAutoInstall: false,
        xvfbMaxRetries: 5,
        xvfbRetryDelay: 1500,
      }
    : {}),
  services: [
    [
      // Bug 根因：旧 Electron service 会吞 ContextId 失败，且 reloadSession 不会重跑
      // service.before；本地 module 保留官方 launcher，同时补严格 readiness 与 onReload。
      E2E_ELECTRON_SERVICE_MODULE_PATH,
      {
        // Bugfix: rootDir 只用于让 wdio-electron-service 读取 desktop package.json；
        // Electron 可执行文件在 pnpm hoisted / isolated 布局下位置不同，不能再让
        // appEntryPoint 模式按 rootDir 硬拼 node_modules/.bin/electron。
        rootDir: DESKTOP_DIR,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "electron",
      browserVersion: ELECTRON_VERSION,
      "wdio:electronServiceOptions": {
        appArgs: [
          ...(E2E_PACKAGED_APP_BINARY_PATH ? [] : [`--app=${E2E_APP_ENTRY_POINT}`]),
          "--no-sandbox",
          // 语音输入 E2E（docs/chat/composer-voice-input.md）：用 Chromium 假麦克风设备，
          // 不访问真实设备，也不弹出系统授权；其他用例不调用 getUserMedia，不受影响。
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          // 修复原因：环境变量不会出现在进程命令行；同时传 runId 与 HOME identity，
          // 让跨平台清理优先命中当前 run，并为 Windows shard 保留路径级兜底。
          buildE2ERunIdArg(E2E_RUN_ID),
          createWindowsE2EHomeMarkerArg(E2E_HOME_DIR),
          // 修复原因：Windows CI runner 以 LocalSystem 服务运行在无鼠标设备的 session 0，
          // Chromium 据此上报 `(hover: none)`；Tailwind v4 的 hover:/group-hover: 变体都包在
          // `@media (hover:hover)` 内，导致 fork/反馈等悬停操作栏永远不显示（本地用
          // primaryHoverType=1 可稳定复现“v4 fork 按钮没有出现”）。E2E 模拟的是带鼠标的桌面用户，
          // 这里显式声明 hover/fine pointer，让各平台 runner 的媒体特性一致。
          "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
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
    // 显式候选不能再被默认排除吞掉；默认全量使用共享的跨领域 glob。
    ...(manualReviewE2E ? [] : [MANUAL_REVIEW_SPEC_GLOB]),
    "./test/e2e/upstream-provider.test.ts",
    ...resolveEnvironmentGatedFormalSpecExcludes({
      env: process.env,
      targeted: isExplicitE2ESpecSelection(requestedE2ESpecs),
    }),
    ...requestedE2EExcludeSpecs,
  ],
  mochaOpts: {
    rootHooks: createE2ERendererBridgeRootHooks(
      async () => {
        await measureE2ELifecyclePhase(
          "before-suite",
          { specs: currentE2EWorkerSpecs },
          async () => {
            await runE2ERendererBridgePreflight(currentE2EWorkerSpecs);
            await bindPrelaunchedElectronSession(browser, prelaunchedElectronOwner);
          },
        );
      },
      () => currentE2EBeforeSessionError,
    ),
    ui: "bdd",
    // 远程队列的无目标任务可定向验证本地对照（如 MP-UI-05）。默认桌面回归不筛选。
    ...(process.env.ZCODE_E2E_MOCHA_GREP?.trim()
      ? { grep: process.env.ZCODE_E2E_MOCHA_GREP.trim() }
      : {}),
    // 修复原因：真实模型配置 + 首次会话预热可能超过 30s，保留更宽的单 case 上限，避免还没收到上游响应就被 Mocha 截断。
    // 真实 GitHub Archive smoke 会下载 Claude 官方市场和目标插件；E2E 抓包代理还会
    // 记录完整二进制响应，不能沿用只覆盖本地 fixture 的 120 秒上限。
    // WPL-011 会经过 SSH asset、marketplace 镜像、远端安装与 runtime refresh；
    // 固定 120 秒会在 UI 有机会报告具体同步结果前先截断 case。
    // Bug 根因：Mocha adapter 会在进入 test body 前按 config timeout 包裹用例，
    // 因此用例内的 this.timeout 无法为人工保留阶段追加预算。显式 hold 只扩展
    // manual-review 运行，不改变普通 E2E 的 120 秒上限。
    // 修复原因：旧写法是嵌套三元，按出现顺序取第一个命中；同一分片同时包含多个长预算 spec 时，
    // 排在前面的较小预算会截断后面的较长用例（例如 240s 截断 background-bash 的 360s）。
    // 改为对所有命中的预算取最大值，新增分支与顺序无关。
    timeout: resolveMochaTimeout(configuredE2ESpecs),
  },
  async onPrepare() {
    try {
      e2eReporter.prepare(configuredE2ESpecs);
      await measureE2ELifecyclePhase("prepare", { specs: configuredE2ESpecs }, async () => {
        await cleanupE2EElectronProcesses("onPrepare");
        await cleanupE2EDirectory("onPrepare", E2E_CHROMIUM_USER_DATA_ROOT_DIR, true);
        const buildAndStage = async () =>
          withE2EDesktopBuildLock({}, async () => {
            prepareDesktopAppBuild();
            if (!E2E_PACKAGED_APP_BINARY_PATH) await stageDesktopE2EAppOutput();
          });
        // 子步骤计时写入 lifecycle-events.ndjson 与 summary.md，用来定位准备阶段的耗时来源。
        await measureE2ELifecyclePhase(
          "prepare:desktop-build",
          { specs: configuredE2ESpecs },
          async () => {
            // 旧覆盖报告只有路径，不能证明源码版本；复用构建不得追认当前工作树。
            if (process.env.ZCODE_E2E_SOURCE_EVIDENCE === "1") {
              await withE2ESourceEvidence({
                freshBuild:
                  !E2E_PACKAGED_APP_BINARY_PATH && !shouldReuseDesktopE2EBuild(process.env),
                captureSources: () => captureWorkspaceSources(REPO_ROOT),
                build: buildAndStage,
                appOutputDir: E2E_APP_OUTPUT_DIR,
                artifactDir: e2eReporter.artifactDir,
              });
            } else await buildAndStage();
          },
        );
        // agent 必须先于 remote release 构建：remote release 的各 target 复用本轮这一个 bundle。
        const agentBundleBuiltThisRun = await measureE2ELifecyclePhase(
          "prepare:agent-build",
          { specs: configuredE2ESpecs },
          () => prepareZCodeAgentServer(),
        );
        if (!E2E_PACKAGED_APP_BINARY_PATH)
          await prepareSshRemoteReleaseForRun(configuredE2ESpecs, agentBundleBuiltThisRun);
        // 正式包使用随包 CLI，模板 seed 源不同，不预热；缺模板时各 HOME 照常冷 seed。
        if (!E2E_PACKAGED_APP_BINARY_PATH) {
          await measureE2ELifecyclePhase(
            "prepare:plugin-cache",
            { specs: configuredE2ESpecs },
            async () => {
              if (E2E_SHARED_PLUGIN_CACHE_KEY) {
                // 同一个 CLI 只 seed 一次；模板建好后只读，各 HOME 照旧从模板拷入
                await ensureSharedSnapshot({
                  cacheRoot: resolve(E2E_SHARED_STAGE_DIR, "official-plugin-cache"),
                  key: E2E_SHARED_PLUGIN_CACHE_KEY,
                  build: (templateHome) =>
                    prepareOfficialPluginCacheTemplate({
                      cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
                      templateHome,
                    }),
                });
                return;
              }
              await prepareOfficialPluginCacheTemplate({
                cliEntryPoint: ZCODE_CLI_ENTRYPOINT,
                templateHome: E2E_OFFICIAL_PLUGIN_CACHE_TEMPLATE_HOME,
              });
            },
          );
        }
      });
    } catch (error) {
      console.error("[e2e] fatal onPrepare failure", error);
      process.exit(1);
    }
  },
  async beforeSession(_config, capabilities, specs, cid) {
    // glob 在 launcher 中不能命中文件预算；必须在 Mocha 初始化前按 worker 实际文件补齐。
    // 保留显式更大或关闭计时器的配置，不能在用例内才修正已经启动的外层计时器。
    _config.mochaOpts = {
      ..._config.mochaOpts,
      timeout:
        _config.mochaOpts?.timeout === 0
          ? 0
          : Math.max(_config.mochaOpts?.timeout ?? 0, resolveMochaTimeout(specs)),
    };
    console.log(`[e2e] worker ${cid} Mocha timeout: ${_config.mochaOpts.timeout}ms`);
    // 同理：公网 Archive case 的 WebDriver HTTP 上限（见 connectionRetryTimeout）按 worker 实际文件放宽，
    // glob 全量运行时不能对全部 spec 放宽这个硬边界。
    if (specs.some((spec) => spec.includes(PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC))) {
      _config.connectionRetryTimeout = Math.max(_config.connectionRetryTimeout ?? 0, 300_000);
    }
    // Bugfix: 现有 e2e 会读写 ~/.openzwork/v2；如果多个 spec 复用真实 HOME，
    // 上一个 spec 的凭据、最近项目和 localStorage 会串到下一个 spec，
    // 既污染开发者本机数据，也让“首次启动”类断言变得随机。
    // 这里为 e2e 单独准备隔离 HOME，并在每个 session 启动前重置，保证每个 spec 都从干净环境开始。
    // onPrepare 设置的 process.env 不会可靠传进 WDIO worker；Electron 启动前在
    // worker 再清除自定义 Agent 覆盖，确保数据库准备仍走 bundled resolver。
    currentE2EWorkerSessionSpecs = specs;
    // 修复依据（OpenZWork）：恢复上游在 beforeSession 内的 per-worker provider 模式决策
    // （applyUpstreamE2EHttpModeForWorker），详见其定义处注释。
    applyUpstreamE2EHttpModeForWorker(specs);
    currentE2EBeforeSessionError = null;
    currentE2EChromiumUserDataDir = resolveE2EWorkerChromiumProfileDir(
      E2E_CHROMIUM_USER_DATA_ROOT_DIR,
      cid,
    );
    const chromeCapabilities = capabilities as {
      "goog:chromeOptions"?: { args?: string[] };
    };
    const chromeOptions = chromeCapabilities["goog:chromeOptions"] ?? {};
    // 修复原因：所有 worker 复用并反复删除同一个 profile 时，长批次中 Chromium
    // 会留下失效文档，CDP target 仍显示 file://，运行时却漂到 chrome-error://。
    // 在 session 创建前按 cid 注入独立 profile，确保 worker 生命周期互不污染。
    chromeOptions.args = replaceChromeUserDataDirArg(
      chromeOptions.args ?? [],
      currentE2EChromiumUserDataDir,
    );
    if (
      process.platform === "win32" &&
      specs.some((spec) =>
        spec.replaceAll("\\", "/").endsWith("/settings/general/settings-ui-polish.test.ts"),
      )
    ) {
      // Windows 服务会话可能没有鼠标；WebDriver 仍能注入鼠标事件，但 CSS 不会启用 hover。
      // 只给本 spec 的 Electron 声明桌面鼠标能力，保留真实输入与产品样式断言。
      chromeOptions.args.push(
        "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2",
      );
    }
    const storageDiagnostics =
      process.env.ZCODE_E2E_STORAGE_WORKER_DIAGNOSTICS === "1" &&
      specs.some((spec) =>
        spec.endsWith("conversation-session-r3-desktop-settings-authority.test.ts"),
      );
    const credentialOwnerProbe = specs.some((spec) =>
      /system-credential-owner(?:-mcp)?\.test\.ts$/.test(spec),
    );
    if (
      !E2E_PACKAGED_APP_BINARY_PATH &&
      (credentialOwnerProbe ||
        storageDiagnostics ||
        specs.some((spec) =>
          /conversation-session-subagent-(context-boundaries|multi-workspace|cross-host)\.test\.ts/.test(
            spec,
          ),
        ))
    ) {
      // ChromeDriver 会清空 NODE_OPTIONS；测试启动文件在正式 Main 导入前设置代理预加载。
      // 文件放在原 Main 旁边，保留 app 路径；正式 Host/CLI resolver 与存储准备均不替换。
      const entry = resolve(E2E_APP_OUTPUT_DIR, "main/subagent-e2e.mjs");
      const proxy = resolve(
        REPO_ROOT,
        credentialOwnerProbe
          ? "packages/desktop/test/e2e/helpers/credential-owner-probe.mjs"
          : storageDiagnostics
            ? "packages/desktop/test/e2e/helpers/storage-worker-diagnostics.mjs"
            : "packages/desktop/test/e2e/helpers/subagent-config-proxy.mjs",
      );
      // Bug 根因：Windows 上 `--import="C:\..."` 会被 ESM loader 当作协议 `c:` 拒绝
      // （ERR_UNSUPPORTED_ESM_URL_SCHEME）；Host utility process 继承 NODE_OPTIONS 后启动即
      // exit 1，用例卡在等待工作区。预加载统一传 file:// URL，macOS/Linux 行为不变。
      const preload = `--import=${JSON.stringify(pathToFileURL(proxy).href)}`;
      const diagnostics = credentialOwnerProbe
        ? `process.env.ZCODE_E2E_CREDENTIAL_OWNER_LOG = ${JSON.stringify(resolve(E2E_HOME_DIR, "credential-owner.ndjson"))};\nawait import(${JSON.stringify(pathToFileURL(proxy).href)});\n`
        : storageDiagnostics
          ? `process.env.ZCODE_E2E_STORAGE_WORKER_DIAGNOSTICS_DIR = ${JSON.stringify(resolve(e2eReporter.artifactDir, "storage-workers"))};\n`
          : "";
      await writeFile(
        entry,
        `${diagnostics}process.env.NODE_OPTIONS = ${JSON.stringify(preload)};\nawait import(${JSON.stringify(pathToFileURL(E2E_APP_ENTRY_POINT).href)});\n`,
      );
      chromeOptions.args = chromeOptions.args.map((arg) =>
        arg.startsWith("--app=") ? `--app=${entry}` : arg,
      );
    }
    chromeCapabilities["goog:chromeOptions"] = chromeOptions;
    try {
      await measureE2ELifecyclePhase("before-session", { cid, specs }, async () => {
        await cleanupE2EElectronProcesses("beforeSession-start", { requireExit: true });
        if (specs.some((spec) => spec.endsWith("conversation-session-r3-subagent.test.ts"))) {
          process.env.ZCODE_DYNAMIC_WORKFLOW_MODE = "alwaysOn";
        }
        const fixtureCredentialSecret = resolveE2ECredentialSecret(
          specs,
          process.env.ZCODE_CREDENTIAL_SECRET,
        );
        if (fixtureCredentialSecret) process.env.ZCODE_CREDENTIAL_SECRET = fixtureCredentialSecret;
        else delete process.env.ZCODE_CREDENTIAL_SECRET;
        // 真实公网 smoke 必须证明 Agent 没有偷偷回退开发机 Git；不存在的绝对路径会让任意 Git
        // 调用稳定得到 ENOENT。
        if (specs.some((spec) => spec.includes(PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC))) {
          process.env.ZCODE_GIT_BINARY = resolve(E2E_HOME_DIR, "missing-bin", "git");
        }
        configureZCodeAgentServerEnv();
        e2eReporter.beforeSession(cid, specs);
        // OpenZWork（T15 修复 T12 回归）：runE2EBeforeSessionSetup 的裁剪域 mock 确已退役，
        // 但 startUpstreamHttp 是 replay 模式的公共注入点（E2E_PROVIDER_CAPTURE_MODE 等 env
        // 须在 Electron 启动前进入 Main→Host 环境链），插件/UI 用例直接断言该 env 为 "replay"；
        // resetHome 是 worker session 的 HOME 重建 + 官方插件缓存模板 + 启动状态播种的前置事务
        // （上游 e2e-before-session.ts 内顺序：startUpstreamHttp → … → resetHome）。
        // 这里按上游原位恢复这两个调用；conversation 系用例自建的 case-local replay server
        // 在 spec 内覆盖同一组 env，行为不变。
        await startUpstreamE2EHttp(specs);
        await resetE2EHome(specs);
        // 上游 v3.18.2：原生钥匙串专项判定升级为 isNativeKeychainCredentialSpec（新增
        // system-credential-data-root 同属该类——会把隔离 HOME 的 Keychains 链到系统库，
        // 仅显式点名执行时准备，正式 glob 不带入 pending spec）。
        // 内置清单已有真实资源；普通用例显式使用空资源，避免无关测试启动时下载大包。
        delete process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG;
        delete process.env.ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL;
        delete process.env.ZCODE_E2E_PREINSTALLED_TOOLS_EXIT_BEFORE_INIT;
        // PT-30/31：仅该用例让预装进程在初始化前退出，其余用例的进程正常启动。
        if (specs.some((spec) => spec.endsWith("preinstalled-tools-worker-start-failure.test.ts")))
          process.env.ZCODE_E2E_PREINSTALLED_TOOLS_EXIT_BEFORE_INIT = "1";
        process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG =
          await writeEmptyPreinstalledToolsCatalog(
            resolve(e2eReporter.artifactDir, "preinstall-fixture", cid),
          );
        // 根因：预装资源夹具原先在本 try 之外启动；WDIO 会吞掉 beforeSession 的 rejection，
        // 夹具缺输入或启动失败时用例仍在残缺环境里继续。放进同一失败通道，由 root hook 拦截。
        if (
          specs.some((spec) =>
            /conversation-session-preinstalled-tools-(?:tracer|controls|agent-switch|remote-context|faults|proxy|delete|release-isolation|clear-data|startup|real-loopback|rewrite|upgrade|python-resource)\.test\.ts$/.test(
              spec,
            ),
          )
        ) {
          preinstalledToolsFixture = await (
            specs.some((spec) => spec.endsWith("preinstalled-tools-python-resource.test.ts"))
              ? (directory: string) => {
                  const artifact = process.env.ZCODE_E2E_PYTHON_ARTIFACT;
                  if (!artifact)
                    throw new Error("ZCODE_E2E_PYTHON_ARTIFACT must name the real Python artifact");
                  return startPreinstalledToolsRealFixture(directory, artifact);
                }
              : specs.some((spec) => spec.endsWith("preinstalled-tools-rewrite.test.ts"))
                ? startPreinstalledToolsRewriteFixture
                : specs.some((spec) => spec.endsWith("preinstalled-tools-real-loopback.test.ts"))
                  ? async (directory: string) => {
                      const inputs = process.env.ZCODE_E2E_PREINSTALL_ARTIFACTS;
                      const upgrade = process.env.ZCODE_E2E_PREINSTALL_UPGRADE_ARTIFACT;
                      if (!inputs || !upgrade)
                        throw new Error(
                          "Real loopback requires five artifacts and an upgrade artifact",
                        );
                      const paths = JSON.parse(await readFile(inputs, "utf8")) as string[];
                      return startPreinstalledToolsRealFixture(directory, paths, upgrade);
                    }
                  : specs.some((spec) => spec.endsWith("preinstalled-tools-faults.test.ts"))
                    ? startPreinstalledToolsFaultFixture
                    : specs.some((spec) => spec.endsWith("preinstalled-tools-proxy.test.ts"))
                      ? (directory: string) =>
                          startPreinstalledToolsFaultFixture(directory, { proxy: true })
                      : (directory: string) =>
                          startPreinstalledToolsFixture(
                            directory,
                            specs.some((spec) =>
                              /preinstalled-tools-(?:tracer|upgrade|agent-switch)\.test\.ts$/.test(
                                spec,
                              ),
                            )
                              ? ["qpdf", "libreoffice"]
                              : ["libreoffice"],
                          )
          )(resolve(e2eReporter.artifactDir, "preinstall-fixture"));
          process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG = preinstalledToolsFixture.catalogPath;
          process.env.ZCODE_E2E_PREINSTALL_FIXTURE_URL = preinstalledToolsFixture.url;
          // 与 catalog 变量同一时机写入；App 启动时读取基址，同一用例内不变。
          process.env.ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL = preinstalledToolsFixture.cdnBaseUrl;
        }
        if (process.platform === "darwin" && specs.some(isNativeKeychainCredentialSpec)) {
          // Main 首次访问发生在界面就绪前；原生专项必须先准备隔离 HOME 的系统库入口。
          await mkdir(resolve(E2E_HOME_DIR, "Library"), { recursive: true });
          await symlink(
            resolve(userInfo().homedir, "Library/Keychains"),
            resolve(E2E_HOME_DIR, "Library/Keychains"),
            "dir",
          );
        }
        // Client Scenes 是布局 case 的远端目录依赖；必须在 resetHome 完成、Electron
        // 启动前覆盖 endpoint，确保 Main → Host 首次 import 时拿到 case-local fixture。
        stopWebRemoteControlAuthGateFixture = await prepareWebRemoteControlAuthGateFixture({
          specs,
          credentialsFile: E2E_APP_CREDENTIALS_FILE,
          settingsFile: E2E_APP_SETTINGS_FILE,
          workspacePath: resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME),
        });
        stopMcpFailureGuidanceFixture = await prepareMcpFailureGuidanceFixture({
          specs,
          credentialsFile: resolve(E2E_APP_CONFIG_DIR, "credentials.json"),
          settingsFile: E2E_APP_SETTINGS_FILE,
          workspacePath: resolve(E2E_HOME_DIR, E2E_AGENT_WORKSPACE_NAME),
        });
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
        // resetHome 之后、Electron 启动之前安装，Main -> Host -> Agent 才会同时继承
        // case-owned PATH；其他 spec 由 helper 保持 no-op。
        await installBashPrefixPermissionPnpmShim({
          environment: process.env,
          homeDir: E2E_HOME_DIR,
          specs,
        });
        // 根因：WDIO 先探测再释放端口，随后 ChromeDriver 绑定时曾被占用；驱动自己分配并持有端口。
        // 每个 worker 独占一份，Electron 冷重启继续连接这份驱动，不增加启动重试。
        try {
          e2eChromedriverServer ??= await startE2EChromedriverServer({
            executablePath: resolveE2EChromedriverExecutable({
              explicitPath: process.env.CHROMEDRIVER_PATH,
              electronVersion: ELECTRON_VERSION,
              cacheDir: containerE2E ? E2E_BROWSER_DRIVER_CACHE_DIR : tmpdir(),
            }),
            logPath: resolve(e2eReporter.artifactDir, `chromedriver-${cid}.log`),
          });
          Object.assign(_config, {
            hostname: e2eChromedriverServer.hostname,
            port: e2eChromedriverServer.port,
          });
          if (
            specs.some((spec) =>
              spec.endsWith("conversation-session-preinstalled-tools-real-loopback.test.ts"),
            )
          ) {
            // 本机driver启动上下文会改变资源首次加载；独立App先启动，driver只连接。
            // 不移除安全属性、不预热资源；下载屏障仍由用例在连接后放行。
            prelaunchedElectronOwner = new PrelaunchedElectronOwner({
              binary: ELECTRON_APP_BINARY_PATH,
              args: chromeOptions.args ?? [],
              cwd: DESKTOP_DIR,
              environment: process.env,
              profileDirectory: currentE2EChromiumUserDataDir!,
              logDirectory: resolve(e2eReporter.artifactDir, "direct-app"),
            });
            const app = await prelaunchedElectronOwner.start();
            Object.assign(chromeOptions, { debuggerAddress: app.debuggerAddress });
          }
        } catch (error) {
          // WDIO 会吞 beforeSession 异常后继续启动；这里直接结束 worker，禁止回退到第二份驱动。
          console.error("[e2e] ChromeDriver or owned App startup failed", error);
          await disposeOwnedElectron();
          await cleanupE2EElectronProcesses("direct-app-startup-failed", { requireExit: true });
          await e2eChromedriverServer?.stop();
          process.exit(1);
        }
      });
    } catch (error) {
      // Bug 根因：WDIO executeHooksWithArgs 会吞掉 beforeSession rejection；保存原始
      // 失败并交给 Mocha root hook 抛出，确保产品 test body 不在残缺环境里继续跑。
      await disposeOwnedElectron();
      currentE2EBeforeSessionError =
        error ?? new Error("beforeSession setup rejected without an error value");
    }
  },
  async before(_capabilities, specs) {
    // Bug 根因：WDIO 将项目与 wdio-electron-service 的 before hooks 放进 Promise.all；
    // 这里发 renderer/CDP 命令会与 service 的 ContextId、Puppeteer 和窗口初始化竞态。
    // before 只保存 worker 归属，browser 命令统一延后到 Mocha root hook 时序屏障。
    currentE2EWorkerSpecs = specs;
  },
  async beforeTest(test) {
    resetDraftRegenerationResend();
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
  async afterSession() {
    await preinstalledToolsFixture?.stop();
    preinstalledToolsFixture = undefined;
    delete process.env.ZCODE_E2E_PREINSTALLED_TOOLS_CATALOG;
    delete process.env.ZCODE_PREINSTALLED_TOOLS_CDN_BASE_URL;
    delete process.env.ZCODE_E2E_PREINSTALL_FIXTURE_URL;
    delete process.env.ZCODE_E2E_PREINSTALLED_TOOLS_EXIT_BEFORE_INIT;
    await measureE2ELifecyclePhase(
      "after-session",
      { specs: currentE2EWorkerSessionSpecs },
      async () => {
        try {
          await disposeOwnedElectron();
          await cleanupE2EElectronProcesses("afterSession", {
            requireExit: true,
            waitForGracefulExit: true,
          });
          if (currentE2EChromiumUserDataDir) {
            await cleanupE2EDirectory("afterSession", currentE2EChromiumUserDataDir, true);
          }
          // Electron/Host/CLI 都已退出，V8 JSON 此时完整封口；趁下一 worker 启动前
          // 就地归一化，避免全量 manual-review 把重复 source map 累积到磁盘上限。
          e2eReporter.compactNodeCoverage();
        } finally {
          await e2eChromedriverServer?.stop();
          e2eChromedriverServer = undefined;
          await stopDynamicWorkflowConfigE2EMock();
          currentE2EElectronAppPid = null;
          await stopWebRemoteControlAuthGateFixture?.();
          stopWebRemoteControlAuthGateFixture = null;
          await stopMcpFailureGuidanceFixture?.();
          stopMcpFailureGuidanceFixture = null;
          const close = closeBotEntryRelay;
          closeBotEntryRelay = undefined;
          await close?.();
          currentE2EBeforeSessionError = null;
          e2eFailureArtifacts = null;
          currentE2EWorkerSessionSpecs = [];
          currentE2EChromiumUserDataDir = null;
        }
      },
    );
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
  async afterTest(test, _context, result) {
    const status = resolveWdioTestStatus(result);
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
            status,
            errorCategory:
              result.passed || isSkippedWdioStatus(status)
                ? undefined
                : classifyError(
                    result.error instanceof Error
                      ? result.error.message
                      : String(result.error ?? ""),
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
  async onComplete(exitCode) {
    e2eRunnerFinalizationGuard.disarm();
    try {
      await measureE2ELifecyclePhase("complete", { specs: configuredE2ESpecs }, async () => {
        try {
          await stopUpstreamE2EHttp();
          await stopDynamicWorkflowConfigE2EMock();
          await stopWebRemoteControlAuthGateFixture?.();
          stopWebRemoteControlAuthGateFixture = null;
          await stopMcpFailureGuidanceFixture?.();
          stopMcpFailureGuidanceFixture = null;
        } finally {
          await cleanupE2EElectronProcesses("onComplete");
          // 修复原因：逐 worker 删除同一 app data 会重复支付 SQLite 锁重试；下一
          // beforeSession 已负责重置，最后一个 worker 的 HOME 在全部进程退出后统一删除。
          // 失败保留诊断现场：批次 runner（run.mjs）注入 ZCODE_E2E_KEEP_HOME_ON_FAIL=1 时，
          // 失败 run 保留 HOME（setting.json/credentials/db 是失败定性的关键证据，
          // r3-rerun §49 曾因 home 被删只能从 run.log 反推 settings）。PASS 行为不变。
          if (exitCode !== 0 && process.env.ZCODE_E2E_KEEP_HOME_ON_FAIL === "1") {
            console.warn(`[e2e] keeping failure home for diagnosis: ${E2E_HOME_DIR}`);
          } else {
            await cleanupE2EDirectory("onComplete-home", E2E_HOME_DIR, true);
          }
          await cleanupE2EDirectory("onComplete", E2E_RUN_CACHE_DIR);
        }
      });
    } finally {
      e2eReporter.writeSummary(exitCode);
      armE2ERunnerExitWatchdog(exitCode);
    }
  },
};
