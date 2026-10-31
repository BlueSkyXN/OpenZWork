export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "zcode-plugins-official";

/**
 * Claude Code 官方市场（GitHub git 源）。它不是 ZCode 的强依赖：GitHub 不可达时刷新必然失败，
 * 该失败不应作为错误提示打扰用户，UI 侧按此 id 静默处理其刷新失败（任何原因）。
 */
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@zcode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 启用」，宿主自己不参与那个判断。
  // Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@zcode-plugins-official",
  // OpenZWork：官方内容型插件默认启用名单保留（本地 seed 目录可用，无 CDN 依赖）；
  // computer-use 仍默认关闭（CUA 域不复活）。
  "skill-creator@zcode-plugins-official",
  "plugin-creator@zcode-plugins-official",
  "zcode-guide@zcode-plugins-official",
  // visualize（交互视图）随 UI 插件合入时 CLI 定义已标 defaultEnabled，但这里漏加，
  // Settings 会把它当成默认关闭，与 CLI 实际启用状态不一致。
  "visualize@zcode-plugins-official",
  // OpenZWork 净化：上游 zcode-site（zcode_official JWT 端点域）默认启用项不引入；
  // computer-use（CUA 域）维持默认关闭。
  // 该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，
  // bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者。
]);

// OpenZWork：官方市场的远端 CDN source 不随上游恢复（WP-08 官方产品域扫描零残留）；
// 本地 bundled seed 分片仍会在 Agent storage 内合并出官方市场目录；用户可自行添加第三方市场。
export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [];

// 商店「公开」分段只有一个 ZCode 官方市场 id，内置与第三方市场不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
