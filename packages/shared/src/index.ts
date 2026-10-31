// Modified for the private fork, 2026-09-21: remove product/telemetry wiring in this file.
// OpenZWork 净化：不导出 cloudContent（云内容营销嵌入域已删）。
// networkCapture 净化口径修订：desktop 网络诊断面板（main handler/UI）已删，
// 但 zcode-cli 协议观测链（bootstrap server/transport + 协议方法表 processNetworkCapture）
// 与 adapters MCP fetch 的 withoutNetworkCapture 是保留面，恢复类型与 schema 导出。
export * from "./system-prompt/contract.js";

export * from "./networkCapture.js";
export type {
  FileBinaryPreview,
  FileEntry,
  FileMediaPreview,
  FileStat,
  FileTextSlice,
  FileWatchEvent,
  WorkspaceFileEntry,
  SystemInfo,
  AppSettings,
  IntegratedTerminalShellDialect,
  IntegratedTerminalShellOption,
  IntegratedTerminalShellSelection,
  Locale,
  LocalePreference,
  ZCodeInteractionBehavior,
  TabId,
  TabState,
  ResourceUsageCategory,
  ResourceUsageBaseGroupKey,
  ResourceUsageProcess,
  HostResourceUsageProcess,
  ResourceUsageSnapshot,
  RemoteTargetSnapshot,
  RemoteWorkspaceSessionEntry,
  PersistedWorkspaceSessionEntry,
} from "./protocol.js";
export type { WorkspacePurpose } from "./workspacePurpose.js";
export { DEFAULT_LOCALE } from "./protocol.js";
export { ZCODE_VERSION, ZCODE_COMMIT, ZCODE_BUILD_TIME } from "./version.js";
export type { HelloMessage, HelloAckMessage } from "./handshake.js";
export type { ZCodeEnv, ZCodeProductFlavor } from "./env.js";
export type { RemoteAssetInstallMode } from "./remoteAssetInstallMode.js";
export type {
  RemoteResourcePackageId,
  RemoteResourcePackageSelection,
} from "./remoteResourcePackages.js";
export type {
  DockerConnectOptions,
  RemoteTarget,
  ServerConnectOptions,
  SSHConnectOptions,
  WSLConnectOptions,
} from "./remoteTarget.js";
export { stripRemoteTargetSecrets } from "./remoteTarget.js";
export { buildSshRemoteHostKey } from "./remoteSshHostKey.js";
export { buildRemoteEnvironmentKey } from "./remoteEnvironmentKey.js";
export type {
  ShortcutChannel,
  ShortcutCommandEntry,
  ShortcutCommandId,
  ParsedShortcutBinding,
} from "./shortcutCommands.js";
export {
  SHORTCUT_COMMANDS,
  getDefaultShortcutBindings,
  isValidShortcutBinding,
  normalizeShortcutKey,
  parseShortcutBinding,
  serializeShortcutBinding,
} from "./shortcutCommands.js";
export {
  ZCODE_ENV,
  ZCODE_PRODUCT_FLAVOR,
  ZCODE_APP_VERSION_ENV,
  ZCODE_BUILD_COMMIT_ID_ENV,
  RUNTIME_ZCODE_DEBUG,
  normalizeZCodeEnv,
  normalizeZCodeProductFlavor,
} from "./env.js";
export * from "./errors.js";
export type { SessionCreateSource } from "./sessionCreateSource.js";
export * from "./productIdentity.js";
export {
  USER_INSTRUCTIONS_MAX_BYTES,
  USER_INSTRUCTIONS_TOO_LARGE_ERROR_CODE,
} from "./userInstructions.js";
export * from "./validation.js";
export * from "./api.js";
export * from "./zcode-protocol/index.js";
// re-home：旧协议承重面的幸存文件（消费者继续走 barrel，零感知）
export * from "./zcode-protocol-legacy-types.js";
export * from "./zcode-task-types-core.js";
export * from "./task-realtime-core.js";
export * from "./remote-workspace-identity.js";
export * from "./zcode-api-retry-status.js";
export * from "./zcode-network-debug-status.js";
export * from "./zcode-session-visible-content.js";
export * from "./conversation-message-projection-policy.js";
export * from "./conversation-preview-artifacts.js";
export * from "./zcode-session-task-status.js";
export * from "./zcode-session-content-profile.js";
export * from "./zcode-tool-projection-memory.js";
export * from "./zcode-slash-command-help.js";
export * from "./zcodeEndpoint.js";
export * from "./zcode-agent-policy.js";
export * from "./zcode-media-policy.js";
export * from "./media-preview.js";
export * from "./plugin-display-name.js";
export * from "./zcode-agent-runtime.js";
export * from "./runtimeEnv.js";
export * from "./dynamic-workflow-feature.js";
export * from "./markdown-artifact-images.js";
export * from "./serviceAuthority.js";
export * from "./server-remote.js";
export * from "./source-server/index.js";

export interface ICredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export * from "./test-ids-workflow.js";
export * from "./channels.js";
export * from "./storage.js";
export * from "./oauth.js";
export * from "./desktopMenu.js";
export * from "./e2e-test-bridge.js";
export * from "./remoteAppConfig.js";
export * from "./helpAppConfig.js";
export * from "./remoteAssetInstallMode.js";
export * from "./remoteResourcePackages.js";
export {
  BROWSER_SCREENSHOT_SURFACE_PREPARE_TIMEOUT_MS,
  BROWSER_VIEW_RESTORE_BOOTSTRAP_URL,
  LOCAL_MEDIA_PREVIEW_SCHEME,
  DesktopCommandIds,
  buildLocalMediaPreviewUrl,
  createOpenInEditorRemoteTarget,
  unwrapRemoteWorkspaceBindResult,
} from "./platform.js";
export type { LaunchMarks } from "./launchMarks.js";
export { LAUNCH_MARKS_QUERY_KEY, parseLaunchMarks, serializeLaunchMarks } from "./launchMarks.js";
export type {
  BrowserViewSurfaceScaleMode,
  CancelPendingRemoteConnectionRequest,
  BindRemoteWorkspaceSessionContextRequest,
  BindRemoteWorkspaceSessionContextIpcResult,
  BindRemoteWorkspaceSessionContextResult,
  BrowserTabResidencyState,
  BrowserViewCloseTabNotification,
  BrowserViewCloseTabRequest,
  BrowserViewOperationPayload,
  BrowserViewResidencyReportPayload,
  BrowserViewResidencyTransitionPayload,
  BrowserViewRestoredTabShell,
  BrowserViewRestoreTabsRequest,
  BrowserViewScreenshotSurfacePreparePayload,
  BrowserViewScreenshotSurfaceReadyPayload,
  BrowserViewScreenshotSurfaceReleasePayload,
  BrowserViewViewportChangedPayload,
  ChromeBrowserDataImportError,
  ChromeBrowserDataImportOptions,
  ChromeBrowserDataImportResult,
  ConnectRemoteRequest,
  FileApplicationInfo,
  FileApplicationTarget,
  CreateTempTextAttachmentRequest,
  CreateTempTextAttachmentResult,
  MaterializeWorkflowArtifactFileRequest,
  MaterializeWorkflowArtifactFileResult,
  SaveFileRequest,
  SaveFileResult,
  PrintPageToPdfResult,
  DesktopCloseToTrayCapability,
  DesktopCommandId,
  DesktopWindowChromeState,
  DesktopTitleBarTheme,
  DockerContainerInfo,
  EditorInfo,
  ApplicationIconInfo,
  ApplicationIconLocator,
  ApplicationIconRequest,
  BrowserGuestAttachRejectReason,
  BrowserGuestAttachResult,
  EmbeddedBrowserDataClearResult,
  EmbeddedBrowserOpenUrlRequest,
  EmbeddedBrowserPermissionDeviceOption,
  EmbeddedBrowserPermissionPromptEvent,
  EmbeddedBrowserPermissionResolution,
  EmbeddedBrowserPermissionResolveRequest,
  EmbeddedBrowserPermissionScreenOption,
  EmbeddedBrowserSitePermissionResetRequest,
  EmbeddedBrowserSitePermissionUpdateRequest,
  EmbeddedBrowserSitePermissionsSnapshot,
  IPlatformService,
  OpenInEditorRemoteTarget,
  OpenInEditorOptions,
  RemoteConnectionRuntimeLog,
  RemoteSessionClosedEvent,
  RemoteSessionReconnectedEvent,
  RemoteServiceSession,
  SSHConfigAliasOption,
  TaskNotificationPayload,
  DesktopZoomState,
  WindowControlsOverlayMetrics,
  WindowControlsOverlayReadyPayload,
  WSLDistro,
  ZCodeStdioTapDevState,
} from "./platform.js";
export type { ZCodeTaskCreateResult } from "./zcode-task-types.js";
export * from "./zcode-task-types.js";
export * from "./automation-types.js";
export * from "./background-task-control-merge.js";
export * from "./background-task-controls.js";
export * from "./background-task-notifications.js";
export * from "./background-bash-jobs.js";
export * from "./zcode-agent-model-state.js";
export * from "./task-realtime.js";
export { formatTimestamp, formatLogPrefix } from "./log-format.js";
export * from "./model-provider-types.js";
export * from "./provider-provisioning.js";
export * from "./custom-model-value.js";
export * from "./model-selection-types.js";
export * from "./model-selection-key.js";
export * from "./model-selection.js";
export * from "./legacy-model-provider-identity.js";
export * from "./official-glm-model-id.js";
export * from "./skills-types.js";
export * from "./skill-sync.js";
export * from "./mcp-sync.js";
export * from "./plugin-sync.js";
export * from "./remote-sync.js";
export * from "./plugin-types.js";
export * from "./subagents-types.js";
export * from "./settings-source.js";
export * from "./settings-errors.js";
export * from "./app-runtime-preferences.js";
export * from "./command-types.js";
export * from "./plugin-marketplaces.js";
export * from "./lineChangeStat.js";
export * from "./process-names.js";
export * from "./mcp.js";
export * from "./runtime-tool-runtime.js";
export * from "./git.js";
export * from "./bots.js";
export * from "./assistant-message-parts.js";
export * from "./zcodePersistedMessageMerge.js";
export * from "./assistant-presentation.js";
export * from "./tool-call-summary.js";
export * from "./tool-identity.js";
export * from "./streaming-tool-input-preview.js";
export * from "./tool-plan-adapter.js";
export * from "./permission-request-preview.js";
export * from "./web-remote-control.js";
export * from "#src/web-remote-relay/index.js";

export * from "./web-remote-control-rpc-transport.js";
export * from "./settings-sync.js";
export * from "./uuid.js";
export * from "./usage-stats.js";
export * from "./intranetProbe.js";
export * from "./intranetDefaults.js";
export * from "./hooks.js";
export * from "./memory.js";
export * from "./output-style.js";
export * from "./workspaceSessionRestore.js";
export * from "./skill-scan-policy.js";
export * from "./browser-use/index.js";

export {
  parseSubagentMarkdownSelection,
  formatSubagentMarkdownModel,
} from "./subagent-markdown-selection.js";
export * from "./memoryDiagnostics.js";
export * from "./database-startup.js";
export * from "./execution-state.js";

export { bashOutputDisplaySchema } from "./bash-output-display.js";

export * from "./subagent-runtime-config.js";

export * from "./subagent-profile.js";
export { parseAgentProfileFromMarkdown } from "./subagent-profile-parser.js";

export * from "./local-ttft/contract.js";
export * from "./pluginStoreOrder.js";
export * from "./pluginStoreOrdering.js";
export * from "./session-debug.js";
export { redactFeedbackText } from "./feedbackPrivacy.js";
export { API_KEY_USAGE_SCENE, type ApiKeyCreationUsageScene } from "./api-key-usage-scene.js";

export * from "./conversationSelection.js";
export * from "./attachment-source.js";

export * from "./channel-mention.js";

// OpenZWork 净化口径：请求安全域（上游 v3.17.1 开源同款空壳发行策略）保留 no-op 实现，
// 目录沿用 fork 侧净化命名 request-verification，不回收上游目录字面量。
export {
  requestSecuritySensitiveHeaders,
  isRequestSecurityFailure,
} from "./request-verification/policy.js";
export * from "./request-verification/verification-policy.js";

export { sha256Bytes, hmacSha256Bytes } from "./web-remote-relay/index.js";
export { compareSemverVersions } from "./semverCompare.js";
// OpenZWork 净化保留：远端会话事件链（用户自建远端 server）保留最小事件形态，定义已随 WP-05
// 禁列收口迁入 conversation-telemetry/eventShapes.ts；ARMS/产品上报面不导出。
export type {
  TelemetryEventPayload,
  PlanIdentitySnapshot,
} from "./conversation-telemetry/eventShapes.js";
export {
  normalizeTelemetryUiMode,
  sanitizeTelemetryEventDetail,
  sanitizeTelemetrySkillName,
} from "./conversation-telemetry/eventShapes.js";
