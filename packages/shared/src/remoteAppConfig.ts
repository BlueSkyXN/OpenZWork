import type { Locale } from "./protocol.js";
import { toZhOrEnLocale } from "./locale.js";

interface RemoteAppConfigLike {
  community_urls?: unknown;
}

type LocaleUrlMap = Partial<Record<Locale, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function sanitizeUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function getCommunityUrlsFromConfig(config: unknown): LocaleUrlMap {
  if (!isRecord(config)) {
    return {};
  }

  const rawCommunityUrls = (config as RemoteAppConfigLike).community_urls;
  if (!isRecord(rawCommunityUrls)) {
    return {};
  }

  return {
    "zh-CN": sanitizeUrl(rawCommunityUrls["zh-CN"]),
    "en-US": sanitizeUrl(rawCommunityUrls["en-US"]),
  };
}

export function getCommunityUrlFromConfig(config: unknown, locale: Locale): string | undefined {
  const communityUrls = getCommunityUrlsFromConfig(config);
  // 社群只配置中英两套；非中文界面语言走英文渠道。
  return communityUrls[toZhOrEnLocale(locale)];
}

export function getCommunityUrlFromConfigs(
  remoteConfig: unknown,
  localConfig: unknown,
  locale: Locale,
): string | undefined {
  const remoteUrls = getCommunityUrlsFromConfig(remoteConfig);
  const localUrls = getCommunityUrlsFromConfig(localConfig);

  // 社群渠道具有语言边界。只允许远端覆盖同语言的内置入口，
  // 对应语言缺失时保持隐藏，避免中文和英文用户被导向错误渠道。
  // 社群只配置中英两套；ja-JP/ru-RU/ko-KR 等非中文界面语言走英文渠道。
  const urlLocale = toZhOrEnLocale(locale);
  return remoteUrls[urlLocale] ?? localUrls[urlLocale];
}
