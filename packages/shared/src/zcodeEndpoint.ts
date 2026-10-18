import type { ZCodeEnv } from "./env.js";

// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。
declare const __ZCODE_ENDPOINT_ENV__: Record<string, string | undefined> | undefined;
export function pickProductEndpointEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const keys = ["ZCODE_BASE_URL", "ZCODE_ENDPOINT_ORIGIN"];
  return Object.fromEntries(
    keys.flatMap((key) => (env[key]?.trim() ? [[key, env[key]!.trim()]] : [])),
  );
}
export function readProductEndpointEnv(): Record<string, string | undefined> {
  return {
    ...(typeof __ZCODE_ENDPOINT_ENV__ === "undefined" ? {} : __ZCODE_ENDPOINT_ENV__),
    ...pickProductEndpointEnv(typeof process === "undefined" ? {} : process.env),
  };
}
// OpenZWork 净化（WP-08）：不恢复任何官方产品域默认常量、ZAI OAuth client id 与默认 relay WS 地址；
// relay 地址由调用方显式配置推导，v3/v4 版本门槛与 URL 拼装随官方端点推导链一并不引入。
export interface ZCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  remoteUrl: string;
  webRemoteCallbackUrl: string;
  webShareCallbackUrl: string;
  relayWsUrl: string;
  zcodePlanOpenAiBaseUrl: string;
  zcodePlanAnthropicBaseUrl: string;
  zcodePlanBillingCurrentUrl: string;
  zcodePlanBillingBalanceUrl: string;
}

export interface RuntimeZCodeEndpointEnv {
  [key: string]: string | undefined;
  ZCODE_ENV?: string;
  ZCODE_BASE_URL?: string;
  ZCODE_ENDPOINT_ORIGIN?: string;
  ZCODE_TEST_BASE_URL?: string;
  ZCODE_PRODUCTION_BASE_URL?: string;
}

// OpenZWork 净化：不恢复 BigModel / ZAI 官方 provider 的 runtime env 接口与 RuntimeProductEndpointConfig。

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeZCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("ZCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ZCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

/**
 * 缺配置语义：没有用户覆盖也没有 env 注入时返回 undefined（能力未配置），
 * 不 throw、不回退任何官方默认域；显式传入非法值仍 throw（配置错误 ≠ 缺配置）。
 * 调用方必须对 undefined 做显式降级。
 */
export function resolveZCodeEndpointOrigin(options?: {
  env?: ZCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string | undefined {
  const origin = options?.overrideOrigin?.trim() || options?.envBaseOrigin?.trim();
  return origin ? normalizeZCodeEndpointOrigin(origin) : undefined;
}

export function resolveRuntimeZCodeEnv(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
): ZCodeEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeZCodeEndpointOrigin(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
  options?: { overrideOrigin?: string | null },
): string | undefined {
  const zcodeEnv = resolveRuntimeZCodeEnv(env);
  const scopedBaseOrigin =
    zcodeEnv === "production"
      ? readRuntimeEnvValue(env, "ZCODE_PRODUCTION_BASE_URL")
      : readRuntimeEnvValue(env, "ZCODE_TEST_BASE_URL");

  return resolveZCodeEndpointOrigin({
    env: zcodeEnv,
    envBaseOrigin:
      readRuntimeEnvValue(env, "ZCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "ZCODE_ENDPOINT_ORIGIN") ??
      scopedBaseOrigin,
    overrideOrigin: options?.overrideOrigin,
  });
}
// OpenZWork 净化（WP-08）：不恢复 buildRuntimeZCodeEndpointUrls / resolveWebRemoteControlRelayWsUrl /
// resolveBigModelApiOrigin / resolveZai* / buildZCodeEndpointUrls / rewriteZCodeEndpointUrl 等官方端点
// 推导链——它们全部以已删除的官方默认域常量为回退。远端 relay 等保留能力经由调用方显式配置的
// endpoint origin 推导，缺配置即未启用（undefined 语义，见上）。
