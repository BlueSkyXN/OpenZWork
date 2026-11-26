import designIconUrl from "@/assets/plugin-icons/design.png";
import documentsIconUrl from "@/assets/plugin-icons/documents.png";
import pdfIconUrl from "@/assets/plugin-icons/pdf.png";
import presentationsIconUrl from "@/assets/plugin-icons/presentations.png";
import spreadsheetsIconUrl from "@/assets/plugin-icons/spreadsheets.png";
import visualizeIconUrl from "@/assets/plugin-icons/visualize.png";
import { buildMaterialFileIconSrc } from "@/lib/fileDisplay.js";
import { isTrustedImageUrl } from "@/lib/trustedImageUrl.js";

const OFFICIAL_PLUGIN_ICON_BY_ID: Readonly<Record<string, string>> = {
  "design@zcode-plugins-official": designIconUrl,
  "documents@zcode-plugins-official": documentsIconUrl,
  // OpenZWork(OZ-D009): image-search 已删除，不打包其图标。
  "pdf@zcode-plugins-official": pdfIconUrl,
  "presentations@zcode-plugins-official": presentationsIconUrl,
  "spreadsheets@zcode-plugins-official": spreadsheetsIconUrl,
  "visualize@zcode-plugins-official": visualizeIconUrl,
};

// OpenZWork(OZ-C014)：旧 Claude 图标索引只有相对文件名。按完整插件身份选择随包品牌图标。
const CLAUDE_PLUGIN_ICON_BY_ID = new Map<string, string>(
  [
    "appwrite", "azure", "buildkite", "expo", "figma", "firebase", "gitlab", "playwright",
    "prisma", "semgrep", "sentry", "supabase", "terraform", "unity", "vercel",
  ].map((name) => [`${name}@claude-plugins-official`, buildMaterialFileIconSrc(name)] as const),
);
const TRUSTED_BUNDLED_PLUGIN_ICONS = new Set([
  ...Object.values(OFFICIAL_PLUGIN_ICON_BY_ID),
  ...CLAUDE_PLUGIN_ICON_BY_ID.values(),
]);

/** 按完整身份解析客户端自有图标，避免商店、候选和消息各自维护不同例外。 */
export function resolvePluginIconSource(
  pluginId: string | undefined,
  icon?: string,
): string | undefined {
  if (pluginId) {
    const bundledIcon = OFFICIAL_PLUGIN_ICON_BY_ID[pluginId];
    if (bundledIcon) return bundledIcon;
  }
  if (isTrustedImageUrl(icon)) return icon;
  return pluginId ? CLAUDE_PLUGIN_ICON_BY_ID.get(pluginId) : undefined;
}

/** Session 投影已完成身份匹配；仅放行固定打包资源，不放宽任意本地 URL。 */
export function isTrustedPluginIconSource(icon: string | undefined): icon is string {
  return Boolean(icon && TRUSTED_BUNDLED_PLUGIN_ICONS.has(icon)) || isTrustedImageUrl(icon);
}
