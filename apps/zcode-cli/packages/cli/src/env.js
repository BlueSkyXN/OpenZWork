import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { ZCODE_RUNTIME_ENV_KEY, buildZCodeToolEnvPassthroughEnv, normalizeZCodeRuntimeEnv, sanitizeZCodeRuntimeEnv, sanitizeZCodeRuntimeEnvInPlace, } from "@zcode/shared/runtime-env";
export function prepareCliRuntimeEnv(env = process.env, argv = process.argv) {
    const prepared = {
        ...sanitizeZCodeRuntimeEnv(env),
        ...buildZCodeToolEnvPassthroughEnv(env),
    };
    applyCliRuntimeEnvDefaults(prepared, argv);
    return prepared;
}
export function applyCliRuntimeEnvSanitization(env, argv = process.argv) {
    const toolEnvPassthrough = buildZCodeToolEnvPassthroughEnv(env);
    sanitizeZCodeRuntimeEnvInPlace(env);
    Object.assign(env, toolEnvPassthrough);
    applyCliRuntimeEnvDefaults(env, argv);
}
const findDotenv = (startDir) => {
    let current = resolve(startDir);
    const root = parse(current).root;
    while (true) {
        const candidate = resolve(current, ".env");
        // 用户可能把 .env 当作目录使用（如 ~/.env/modelscope）。
        // existsSync 只检查存在性，不区分文件/目录；必须显式检查 isFile避免 loadDotenv 报错。
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
        }
        if (current === root) {
            return undefined;
        }
        const parent = dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
};
export const loadCliDotenv = (options = {}) => {
    const env = options.env ?? process.env;
    const dotenvPath = findDotenv(options.cwd ?? process.cwd());
    if (!dotenvPath) {
        return {
            keys: [],
            loaded: false,
        };
    }
    // The build used to inline .env values into dist. Loading at the CLI boundary
    // keeps secrets runtime-scoped and lets users rotate .env without rebuilding.
    const result = loadDotenv({
        override: false,
        path: dotenvPath,
        processEnv: env,
        quiet: true,
    });
    if (result.error) {
        return {
            error: result.error,
            keys: [],
            loaded: false,
            path: dotenvPath,
        };
    }
    return {
        keys: Object.keys(result.parsed ?? {}),
        loaded: true,
        path: dotenvPath,
    };
};
export function shouldLoadCliDotenvForProtocolServer(env) {
    return resolveCliRuntimeEnv(env, process.argv) === "development";
}
function applyCliRuntimeEnvDefaults(env, argv) {
    env[ZCODE_RUNTIME_ENV_KEY] = resolveCliRuntimeEnv(env, argv);
    applyBetaStorageDefault(env, argv);
}
function resolveCliRuntimeEnv(env, argv) {
    const explicit = normalizeZCodeRuntimeEnv(env[ZCODE_RUNTIME_ENV_KEY]);
    if (explicit) {
        return explicit;
    }
    // CLI 运行时不再读取 NODE_ENV。源码 tsx 入口仍表示本地开发形态，
    // 但该判定来自入口路径，不来自用户 shell 里的 NODE_ENV。
    const entrypoint = (argv[1] ?? "").replace(/\\/g, "/");
    return entrypoint.endsWith(".ts") && entrypoint.includes("packages/cli/src")
        ? "development"
        : "production";
}
function applyBetaStorageDefault(env, argv) {
    if (env.ZCODE_STORAGE_DIR?.trim())
        return;
    const explicitBeta = env.ZCODE_BETA === "1" || env.ZCODE_ENV === "beta";
    const invokedAsBeta = argv.some((arg) => /(^|[/\\])zcode-beta(?:$|\.)/u.test(arg));
    if (!explicitBeta && !invokedAsBeta)
        return;
    env.ZCODE_STORAGE_DIR = join(homedir(), ".openzwork-beta");
}
