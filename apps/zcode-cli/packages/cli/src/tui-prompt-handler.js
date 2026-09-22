// Modified for the private fork, 2026-09-21: remove product/telemetry wiring in this file.
import { getDefaultConfigPath, updateUiLocaleInFileConfig } from "@zcode/adapters/config";
import { DEFAULT_LOCALE } from "@zcode/i18n";
import { createCommandCenter, parseSlashCommand } from "./command-center.js";
import { resolveDisplayLocale } from "./locale.js";
import { createCliHeadlessBrowserRuntime } from "./headless-browser.js";
// 复用防御式 runtime 读取：subscribeEvents 不在 app 的静态类型面上，
// 两处各写一份「怎么把它读出来」就会在方法改名时只修好一处。
import { readRuntimeEventSubscriber } from "./runtime-event-subscriber.js";
import { createTuiSessionEventRelay } from "./tui-session-event-relay.js";
import { attachTuiAppQueries, readTuiSessionMetadata } from "./tui-prompt-handler-queries.js";
import { createTuiProcessRuntimeState, prepareTuiAppRuntime, } from "./tui-prompt-handler-runtime.js";
import { DEFAULT_CLI_CLEANUP_TIMEOUT_MS, runCliCleanupWithTimeout } from "./shutdown.js";
import { listCustomCommandsForTui, listSessionsForTui, listSkillsForTui, loadCustomCommandForTui, } from "./tui-command-data.js";
import { currentCliMode, readTuiMode, TUI_TITLE_GENERATION_CONFIG, } from "./tui-command-state.js";
import { withTuiMetadata } from "./tui-submit-metadata.js";
export function createTuiSubmitPrompt(deps, modeState, version, resumeRequest = { continueSession: false }, uiLocale, uiDetectedLocale, startupLocale = DEFAULT_LOCALE, toolDisallowlist, forceMcs = false, browserUse, browserExecutable) {
    let app;
    let activeUiLocale = uiLocale;
    // 进程级句柄（telemetry / Provider Registry / endpoint 路由）跨 App 替换复用，见 runtime 文件。
    const processRuntime = createTuiProcessRuntimeState();
    let closeHandlerPromise;
    const closePromises = new WeakMap();
    const browserRuntimes = new WeakMap();
    let activeRequestPermission;
    const cleanupTimeoutMs = Math.max(1, Math.trunc(deps.shutdownCleanupTimeoutMs ?? DEFAULT_CLI_CLEANUP_TIMEOUT_MS));
    const permissionBroker = {
        requestPermission: async (request, requestOptions) => {
            const requestPermission = activeRequestPermission;
            if (!requestPermission) {
                return {
                    decision: "deny",
                    reason: `No interactive approval handler configured for ${request.toolName}`,
                    resolvedAt: new Date(),
                };
            }
            return await requestPermission(request, requestOptions);
        },
    };
    const closeApp = async (targetApp = app) => {
        if (!targetApp)
            return;
        const closeKey = targetApp;
        let closePromise = closePromises.get(closeKey);
        if (!closePromise) {
            closePromise = (async () => {
                await runCliCleanupWithTimeout(async () => targetApp.close?.(), cleanupTimeoutMs);
                // App/session 关闭悬空或失败时仍需释放 CLI 自己启动的 Chromium。
                await runCliCleanupWithTimeout(async () => browserRuntimes.get(closeKey)?.close(), cleanupTimeoutMs);
            })();
            closePromises.set(closeKey, closePromise);
        }
        await closePromise;
    };
    // ── 跨回合常驻的会话事件订阅──
    // per-turn 的 onEvent 在回合结束即死，收不到出回合事件（dwf 进度、后台通知驱动的回合）。
    const sessionEventRelay = createTuiSessionEventRelay({
        currentRuntime: () => app?.runtime,
        readSubscriber: readRuntimeEventSubscriber,
    });
    const replaceApp = async (factory) => {
        const previousApp = app;
        const nextApp = await factory();
        app = nextApp;
        if (previousApp && previousApp !== nextApp) {
            await closeApp(previousApp);
        }
        // 常驻订阅要跟着换 app 重挂：这里是 /new、/resume、/fork 共同的唯一收口，
        // 漏挂的后果是换 session 后 TUI 再也收不到出回合事件（dwf 进度、通知驱动回合）。
        sessionEventRelay.reattach();
        modeState.current = readTuiMode(app, currentCliMode(modeState));
        return app;
    };
    const createApp = async (request) => {
        if (closeHandlerPromise)
            throw new Error("TUI prompt handler is closed");
        const { appEnv, configuredDefaultModelSelection, createAppFactory, providerRegistryRuntime, sessionId, workingDirectory, } = await prepareTuiAppRuntime(deps, version, request, processRuntime);
        const browserRuntime = createCliHeadlessBrowserRuntime({ browserExecutable, browserUse }, deps);
        let createdApp;
        try {
            createdApp = await createAppFactory({
                browserControlPort: browserRuntime?.browserControlPort,
                env: appEnv,
                projectConfigPath: deps.projectConfigPath,
                providerRegistry: providerRegistryRuntime.runtime.registryService,
                configuredDefaultModelSelection,
                resume: sessionId !== undefined,
                runtimeConfig: {
                    ...(modeState.override ? { mode: modeState.override } : {}),
                    ...(toolDisallowlist ? { toolDisallowlist } : {}),
                    ...(forceMcs ? { midConversationSystem: { mode: "force" } } : {}),
                    modelStreaming: "on",
                    titleGeneration: TUI_TITLE_GENERATION_CONFIG,
                    workingDirectory,
                },
                permissionBroker,
                sessionId,
                skipUserConfig: deps.skipUserConfig,
                uiDetectedLocale,
                uiLocale: activeUiLocale,
                userConfigPath: deps.userConfigPath,
                version,
            });
        }
        catch (error) {
            await runCliCleanupWithTimeout(async () => browserRuntime?.close(), cleanupTimeoutMs);
            throw error;
        }
        if (browserRuntime)
            browserRuntimes.set(createdApp, browserRuntime);
        // 初始化在等待旧身份导入时 TUI 可能已关闭；迟到 App 不能重新成为当前会话。
        if (closeHandlerPromise) {
            await closeApp(createdApp);
            throw new Error("TUI prompt handler is closed");
        }
        modeState.current = readTuiMode(createdApp, currentCliMode(modeState));
        return createdApp;
    };
    const getApp = async () => {
        app ??= await createApp(resumeRequest);
        modeState.current = readTuiMode(app, currentCliMode(modeState));
        return app;
    };
    const resumeApp = async (sessionId) => {
        return await replaceApp(async () => await createApp(sessionId
            ? {
                continueSession: false,
                resumeSessionId: sessionId,
            }
            : {
                continueSession: true,
            }));
    };
    const newApp = async () => {
        return await replaceApp(async () => await createApp({
            continueSession: false,
        }));
    };
    const setCliMode = async (nextMode) => {
        modeState.override = nextMode;
        if (app) {
            const modeCapableApp = app;
            if (modeCapableApp.setMode) {
                const result = await modeCapableApp.setMode(nextMode);
                modeState.current = readTuiMode(modeCapableApp, result.mode);
                return modeState.current;
            }
            modeCapableApp.runtime.updateConfig({ mode: nextMode });
        }
        modeState.current = app ? readTuiMode(app, nextMode) : nextMode;
        return modeState.current;
    };
    const commandCenter = createCommandCenter({
        forkApp: async (targetCheckpointId) => {
            const activeApp = await getApp();
            const result = await activeApp.forkFromCheckpoint?.({ targetCheckpointId });
            if (!result) {
                throw new Error("Forking is not available in this client.");
            }
            await replaceApp(async () => await createApp({
                continueSession: false,
                resumeSessionId: result.forkedSessionId,
            }));
            return {
                copiedMessageCount: result.copiedMessageCount,
                forkedSessionId: result.forkedSessionId,
                response: `${result.response}\nSwitched to forked session ${result.forkedSessionId}.`,
                restoredFileCount: result.restoredFileCount ?? result.restoredFiles?.length ?? 0,
            };
        },
        getApp,
        getMode: () => currentCliMode(modeState),
        getLocale: () => app?.getLocale?.() ?? resolveDisplayLocale(activeUiLocale, uiDetectedLocale) ?? startupLocale,
        hasSelectableModels: async () => {
            // Registry 已按 provider/账号可用性过滤；这里只判断是否存在可用模型。
            const app = await getApp();
            return ((await app.listModels?.()) ?? []).some((model) => !model.disabledReason);
        },
        listCustomCommands: () => listCustomCommandsForTui(deps),
        listSessions: () => listSessionsForTui(deps),
        listSkills: () => listSkillsForTui(deps),
        loadCustomCommand: (name) => loadCustomCommandForTui(deps, name),
        newApp,
        recordInputHistory: async (input, kind) => {
            await app?.recordInputHistory?.(input, kind);
        },
        resumeApp,
        saveDefaultModelSelection: async (selection) => {
            const runtime = await processRuntime.providerRegistryRuntimePromise;
            if (!runtime?.modelSelectionConfigRepository) {
                throw new Error("Default model configuration storage is unavailable.");
            }
            await runtime.modelSelectionConfigRepository.saveConfiguredDefault(selection);
        },
        setLocale: async (locale) => {
            if (app?.setLocale) {
                const result = await app.setLocale(locale);
                activeUiLocale = locale;
                return result;
            }
            activeUiLocale = locale;
            const persisted = await updateUiLocaleInFileConfig(deps.userConfigPath ?? getDefaultConfigPath(), locale);
            return {
                configPath: persisted.path,
                locale: resolveDisplayLocale(locale, uiDetectedLocale) ?? "en-US",
                requestedLocale: locale,
            };
        },
        setMode: setCliMode,
    });
    const submitPrompt = async (input, options) => {
        const previousRequestPermission = activeRequestPermission;
        activeRequestPermission = options.requestPermission;
        try {
            const result = await commandCenter(input, options);
            return app ? { ...result, ...(await readTuiSessionMetadata(await getApp())) } : result;
        }
        finally {
            activeRequestPermission = previousRequestPermission;
        }
    };
    submitPrompt.setMode = async (nextMode) => ({ mode: await setCliMode(nextMode) });
    submitPrompt.sendInput = async (input, options) => {
        const previousRequestPermission = activeRequestPermission;
        // busy-turn or resumed input can start a new turn through sendInput,
        // bypassing submitPrompt's scoped approval handler and leaving approvals invisible.
        activeRequestPermission = options?.requestPermission;
        try {
            // Model/effort changes configure subsequent requests, including during an active turn.
            const command = parseSlashCommand(typeof input === "string" ? input : input.text);
            if (command?.type === "known" && (command.name === "model" || command.name === "effort")) {
                return {
                    kind: "command_result",
                    result: await submitPrompt(input, {
                        ...options,
                        abortSignal: options?.abortSignal ?? new AbortController().signal,
                    }),
                };
            }
            const activeApp = await getApp();
            if (activeApp.sendInput) {
                const result = await activeApp.sendInput(input, options);
                if (result.kind !== "started_turn")
                    return result;
                return withTuiMetadata(result.result, activeApp, currentCliMode(modeState));
            }
            return withTuiMetadata(await activeApp.submitPrompt(input, options), activeApp, currentCliMode(modeState));
        }
        finally {
            activeRequestPermission = previousRequestPermission;
        }
    };
    attachTuiAppQueries(submitPrompt, getApp);
    submitPrompt.subscribeSessionEvents = (sink) => {
        const unsubscribe = sessionEventRelay.addSink(sink);
        // app 还没建好时首次实挂会落空；建好后再挂一次（reattach 幂等，不会重复扇出）。
        void getApp().then(() => sessionEventRelay.reattach(), () => undefined);
        return unsubscribe;
    };
    // 主会话 id：给 TUI 做会话闸门用（actor/子会话事件保留子 sessionId 投进同一个 sink 集）。
    // 每次现读而不是缓存：replaceApp 换 app 就换会话，缓存下来的 id 会把整条转写判成外来。
    submitPrompt.getMainSessionId = () => {
        const runtime = app?.runtime;
        const sessionId = runtime?.getSessionId?.();
        return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
    };
    submitPrompt.close = async () => {
        closeHandlerPromise ??= (async () => {
            await closeApp();
            const providerRegistryRuntime = await processRuntime.providerRegistryRuntimePromise;
            providerRegistryRuntime?.dispose();
        })();
        await closeHandlerPromise;
    };
    return submitPrompt;
}
