import { resolveHelpAppConfig, type Locale } from "@zcode/shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  localConfig?: unknown;
}

// 官方 /api/v1/client/configs 远端拉取已随官方服务移除：帮助配置只读构建期打包默认值。
export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  return resolveHelpAppConfig(options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
