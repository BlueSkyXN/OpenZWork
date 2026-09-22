import { ZCODE_VERSION, type ZCodeEnv } from "@zcode/shared";

declare const __ZCODE_CDN_BASE_URL__: string | undefined;

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

/**
 * 缺配置语义：无覆盖、无 env、无构建注入时返回空数组（能力未配置）。
 * 远端连接链必须对空列表显式报错，不再回退任何官方 CDN 域。
 */
export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl =
    process.env.ZCODE_CDN_BASE_URL?.trim() ||
    (typeof __ZCODE_CDN_BASE_URL__ === "undefined" ? "" : __ZCODE_CDN_BASE_URL__);
  if (!baseUrl) {
    return [];
  }
  return [
    `${normalizeBaseUrl(baseUrl)}/zcode/electron/releases/${options.version ?? ZCODE_VERSION}`,
  ];
}
