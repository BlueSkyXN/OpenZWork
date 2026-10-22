import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "tsup";
import { getBuildMetadata } from "./scripts/build-metadata.mjs";
import { resolveDesktopProductFlavor } from "./scripts/desktop-product-identity.mjs";
const { copyGenUiRuntimeAssets } = await import(
  pathToFileURL(resolve(import.meta.dirname, "scripts/gen-ui-runtime-assets.mjs")).href
);
// tsup 会先打包配置文件；动态加载构建工具，避免其 import.meta.dirname 被重定位到 desktop。
const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);
const buildMetadata = getBuildMetadata();

// 手动加载 .env 文件，tsup 不像 Vite 会自动读取 .env.*；这些文件只提供链接常量。
function loadEnvFiles(): Record<string, string> {
  const vars: Record<string, string> = {};
  const files = ["../../.env"];
  if (process.env.NODE_ENV === "production") {
    files.push("../../.env.production");
  } else {
    files.push("../../.env.development", "../../.env.development.local");
  }
  for (const file of files) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        const match = line.match(/^(\w+)=(.*)$/);
        if (match) vars[match[1]] = match[2];
      }
    }
  }
  // 真实环境变量优先级最高
  if (process.env.ZCODE_ENV) vars.ZCODE_ENV = process.env.ZCODE_ENV;
  if (process.env.ZCODE_BASE_URL) vars.ZCODE_BASE_URL = process.env.ZCODE_BASE_URL;
  if (process.env.VITE_ZCODE_BASE_URL) vars.VITE_ZCODE_BASE_URL = process.env.VITE_ZCODE_BASE_URL;
  // OAuth origin/client_id 由 host runtime 读取；这里保留覆盖入口，方便开发构建时观察统一 env 来源。
  if (process.env.ZAI_OAUTH_CLIENT_ID) vars.ZAI_OAUTH_CLIENT_ID = process.env.ZAI_OAUTH_CLIENT_ID;
  if (process.env.ZAI_OAUTH_ORIGIN) vars.ZAI_OAUTH_ORIGIN = process.env.ZAI_OAUTH_ORIGIN;
  if (process.env.ZAI_BUSINESS_BASE_URL) {
    vars.ZAI_BUSINESS_BASE_URL = process.env.ZAI_BUSINESS_BASE_URL;
  }
  if (process.env.ZAI_BUSINESS_LOGIN_URL) {
    vars.ZAI_BUSINESS_LOGIN_URL = process.env.ZAI_BUSINESS_LOGIN_URL;
  }
  if (process.env.CDN_DOMAIN) vars.CDN_DOMAIN = process.env.CDN_DOMAIN;
  if (process.env.OSS_PATH_PREFIX) vars.OSS_PATH_PREFIX = process.env.OSS_PATH_PREFIX;
  if (process.env.VITE_ZAI_OAUTH_CLIENT_ID) {
    vars.VITE_ZAI_OAUTH_CLIENT_ID = process.env.VITE_ZAI_OAUTH_CLIENT_ID;
  }
  if (process.env.VITE_ZAI_OAUTH_ORIGIN) {
    vars.VITE_ZAI_OAUTH_ORIGIN = process.env.VITE_ZAI_OAUTH_ORIGIN;
  }
  return vars;
}

const env = loadEnvFiles();
const { environment: zcodeEnv } = await loadBuiltinProviderConfig();
// 安装包身份与后端环境分轴：ZCODE_PREVIEW_IDENTITY=1 让生产后端的构建仍以 ZCode Preview 身份打包运行。
const zcodeProductFlavor = resolveDesktopProductFlavor({ ...process.env, ZCODE_ENV: zcodeEnv });
console.log(`[tsup] ZCODE_ENV=${zcodeEnv} ZCODE_PRODUCT_FLAVOR=${zcodeProductFlavor}`);

function createSharedDefines() {
  return {
    __ZCODE_VERSION__: JSON.stringify(buildMetadata.appVersion),
    __ZCODE_MIN_COMPATIBLE_VERSION__: JSON.stringify(buildMetadata.minCompatibleVersion),
    __ZCODE_COMMIT__: JSON.stringify(buildMetadata.buildCommitId),
    __ZCODE_BUILD_TIME__: JSON.stringify(buildMetadata.buildTime),
    __ZCODE_ENV__: JSON.stringify(zcodeEnv),
    __ZCODE_PRODUCT_FLAVOR__: JSON.stringify(zcodeProductFlavor),
    // 客户端只有一个 CDN 配置，与发布端 OSS 目标列表分离。
    __ZCODE_CDN_BASE_URL__: JSON.stringify(env.ZCODE_CDN_BASE_URL?.trim() || ""),
  };
}

// 修复原因：清理遥测注入时连带删掉了通用构建函数，配置模块在打包前就抛 ReferenceError。
export function resolveDesktopTsupBundleSecurityOptions(
  runtimeEnv: Record<string, string | undefined> = process.env,
) {
  const isProduction = runtimeEnv.NODE_ENV === "production";
  const isE2ECoverageBuild = runtimeEnv.ZCODE_E2E_COVERAGE === "1";
  return {
    keepNames: isProduction && !isE2ECoverageBuild,
    minify: isProduction && !isE2ECoverageBuild,
    sourcemap: isE2ECoverageBuild || !isProduction,
  };
}

export function applyDesktopTsupEsbuildSecurityOptions(options: { legalComments?: string }) {
  options.legalComments = "none";
}

const desktopTsupBundleSecurityOptions = resolveDesktopTsupBundleSecurityOptions();

const desktopNodeRuntimeExternals = [
  "electron",
  "node-pty",
  "ssh2",
  "undici",
  "@larksuiteoapi/node-sdk",
  "yaml",
  // node-forge 内部用动态 require("crypto")，内联进 ESM main/host bundle 后 Electron 会报
  // Dynamic require of "crypto" is not supported。和 undici 同样保留为运行时外部依赖。
  "node-forge",
  // ZIP 解包器内部依赖 CommonJS require("fs")，不能内联到 ESM main/host 产物。
  "yauzl",
];

function createDevReadyMarkerHook(target: "main" | "host" | "preload"): string {
  // CLI 级 --onSuccess 在多 config watch 模式下会被每个子构建分别触发。
  // 之前 preload 先成功时就提前写入 ready 标记，Electron 仍会在 main/host 未完成时启动。
  // 这里改成每个 config 自己在成功后写独立 marker，让 dev 启动脚本能精确等待全部构建完成。
  return `node scripts/write-dev-ready-marker.mjs ${target}`;
}

export default defineConfig([
  {
    name: "main",
    entry: {
      "main/index": "src/main/index.ts",
      "main/browserWebmRecorder": "src/main/browserView/electronBrowserWebmRecorder.ts",
      "main/zcodeDataSizeWorker": "src/main/zcodeDataSizeWorker.ts",
      // 资源管理器「存储」tab 的扫描 Worker：main 持有 StorageService，遍历放独立线程，供 new Worker(new URL()) 解析。
      "main/storageScanWorker": "src/main/storageScanWorker.ts",
    },
    outDir: "out",
    format: "esm",
    platform: "node",
    // node:sqlite 只有带前缀的内置入口；tsup 去掉 node: 会错误加载第三方 sqlite 包。
    removeNodeProtocol: false,
    target: "node22",
    // undici 如果被 main ESM bundle 直接内联，运行时会落到它内部的 CommonJS require("assert")，
    // Electron 加载 main 产物时会报 Dynamic require of "assert" is not supported。
    // desktop 保持 undici 为外部依赖，remote 单文件 bundle 再单独内联。
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@zcode/server",
      "@zcode/shared",
      "@zcode/rpc",
      "@zcode/services",
      "@zcode/client",
      // Provider Refactor 的 workspace 包导出 TypeScript 源码；Electron 生产运行时没有
      // TS loader，必须随 Desktop bundle 内联，不能留下指向 src/index.ts 的裸包引用。
      "@zcode/provider",
      "@zcode/provider-node",
    ],
    define: createSharedDefines(),
    // 修复原因：main/host 同时 watch 且共享 out 根目录时，默认 chunk 命名会互相覆盖，
    // 可能让 main 的 import 指向被 host 刚重写的 chunk，触发“缺少命名导出”的偶发启动报错。
    // 这里按目标分目录输出 chunk，确保并发构建下产物隔离。
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "main/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("main"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "preload",
    entry: {
      "preload/embeddedBrowserJavaScriptDialog": "src/preload/embeddedBrowserJavaScriptDialog.ts",
      "preload/browserVideoRecorder": "src/preload/browserVideoRecorder.ts",
      "preload/index": "src/preload/index.ts",
      "preload/resourceManager": "src/preload/resourceManager.ts",
      "preload/pluginSandbox": "src/preload/pluginSandbox/index.ts",
    },
    outDir: "out",
    format: "cjs",
    platform: "node",
    // node:sqlite 只有带前缀的内置入口；tsup 去掉 node: 会错误加载第三方 sqlite 包。
    removeNodeProtocol: false,
    target: "node22",
    external: ["electron"],
    noExternal: ["@zcode/shared"],
    outExtension: () => ({ js: ".cjs" }),
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
    },
    onSuccess: createDevReadyMarkerHook("preload"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    // 插件 iframe 内的 window.zcode / window.openai 别名脚本（官方 ext-apps `App` 上的薄封装）：IIFE、浏览器平台，
    // 由 zcode-sandbox:// protocol handler 同源服务。
    name: "plugin-sandbox-alias",
    loader: { ".css": "text" },
    entry: {
      "plugin-sandbox-alias": "src/renderer/src/plugin-sandbox/alias.ts",
      "gen-ui": "src/renderer/src/plugin-sandbox/genUi.ts",
    },
    // 不能放 out/renderer：vite renderer 构建 emptyOutDir 会把先落盘的别名脚本清掉。
    outDir: "out/plugin-sandbox",
    onSuccess: () => copyGenUiRuntimeAssets(resolve("out/plugin-sandbox")),
    format: "iife",
    platform: "browser",
    target: "es2022",
    // 沙箱页面没有 node_modules：SDK（ext-apps / client / core / zod）必须全部打进 IIFE。
    noExternal: [/.*/],
    outExtension: () => ({ js: ".js" }),
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
    },
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "host",
    entry: {
      "host/index": "src/host/index.ts",
      "host/tasksStorageWorker": "src/host/database-startup/tasksStorageWorker.ts",
    },
    outDir: "out",
    format: "esm",
    platform: "node",
    // node:sqlite 只有带前缀的内置入口；tsup 去掉 node: 会错误加载第三方 sqlite 包。
    removeNodeProtocol: false,
    target: "node22",
    // host 与 main 共用同一套 services 图，继续内联 undici 会在 Electron ESM runtime 里触发同样的 dynamic require 崩溃。
    // 这里同样保留为外部依赖，避免 desktop 开发态和打包态 host 进程启动失败。
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@zcode/server",
      "@zcode/shared",
      "@zcode/rpc",
      "@zcode/services",
      "@zcode/client",
      "@zcode/provider",
      "@zcode/provider-node",
    ],
    define: createSharedDefines(),
    // 与 main 保持一致的 chunk 隔离策略，避免 host/main 产物相互覆盖。
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "host/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("host"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "scheduler",
    entry: { "scheduler/index": "src/scheduler/index.ts" },
    outDir: "out",
    format: "esm",
    platform: "node",
    // node:sqlite 只有带前缀的内置入口；tsup 去掉 node: 会错误加载第三方 sqlite 包。
    removeNodeProtocol: false,
    target: "node22",
    // 与 host 同构：常驻 cron scheduler 进程复用 @zcode/services（tasks-index + cron），
    // 同样保留 undici 等为外部依赖，避免 Electron ESM runtime 的 dynamic require 崩溃。
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@zcode/server",
      "@zcode/shared",
      "@zcode/rpc",
      "@zcode/services",
      "@zcode/client",
      "@zcode/provider",
      "@zcode/provider-node",
    ],
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "scheduler/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("scheduler"),
    ...desktopTsupBundleSecurityOptions,
  },
]);
