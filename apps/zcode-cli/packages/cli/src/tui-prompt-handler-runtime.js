// Modified for the private fork, 2026-09-21: remove product/telemetry wiring in this file.
// tui-prompt-handler.ts 顶到 oxlint max-lines 上限（400 行），把 createApp 里
// 「读 dotenv → 定位要恢复的会话 → 装 bootstrap 模块 → 起 Provider Registry
// 常驻运行时 → 读默认模型选择」这段进程级准备拆到本文件；
// 公开面仍从 tui-prompt-handler.ts 导出。
import { loadBootstrapModule } from "./bootstrap-loader.js";
import { loadCliDotenv } from "./env.js";
import { resolveResumeSession } from "./resume.js";
export const createTuiProcessRuntimeState = () => ({
    providerRegistryRuntimePromise: undefined,
});
// 返回值类型交给推断：原地 createApp 里这几个都是推断出来的局部变量，手写接口反而会把
// 品牌类型（SessionId）和 createZCodeApp 的联合签名收窄错。
export async function prepareTuiAppRuntime(deps, version, request, state) {
    const env = deps.env ?? process.env;
    const workingDirectory = (deps.cwd ?? process.cwd)();
    const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
        cwd: workingDirectory,
        env,
    });
    if (dotenvResult.error) {
        throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
            cause: dotenvResult.error,
        });
    }
    const sessionId = await resolveResumeSession(request, workingDirectory, env, deps);
    const bootstrapModule = deps.createZCodeApp ? undefined : await loadBootstrapModule();
    const createAppFactory = deps.createZCodeApp ?? bootstrapModule?.createZCodeApp;
    if (!createAppFactory)
        throw new Error("ZCode app factory is unavailable.");
    const appEnv = env;
    const startProviderRegistryRuntime = deps.startProcessProviderRegistryRuntime ??
        bootstrapModule?.startProcessProviderRegistryRuntime;
    if (!startProviderRegistryRuntime) {
        throw new Error("Provider Registry runtime is unavailable.");
    }
    state.providerRegistryRuntimePromise ??= startProviderRegistryRuntime(appEnv, deps.skipUserConfig
        ? {}
        : {
            standalone: {
                ...(deps.userConfigPath ? { legacyCliUserConfigFilePath: deps.userConfigPath } : {}),
            },
        });
    const providerRegistryRuntime = await state.providerRegistryRuntimePromise;
    const configuredDefaultModelSelection = providerRegistryRuntime?.modelSelectionConfigRepository
        ? await providerRegistryRuntime.modelSelectionConfigRepository.read()
        : providerRegistryRuntime?.configuredDefaultModelSelection;
    return {
        appEnv,
        configuredDefaultModelSelection,
        createAppFactory,
        providerRegistryRuntime,
        sessionId,
        workingDirectory,
    };
}
