export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "zcode-plugins-official";

// OpenZWork(OZ-C014): 添加来源失败时经协议 error.data.code 返回给界面。
export const ZCODE_PLUGIN_MARKETPLACE_RESERVED_ID_ERROR_CODE = "ZCODE_PLUGIN_MARKETPLACE_RESERVED_ID";

/**
 * Claude Code 官方市场（GitHub git 源）。它不是 ZCode 的强依赖：GitHub 不可达时刷新必然失败，
 * 该失败不应作为错误提示打扰用户，UI 侧按此 id 静默处理其刷新失败（任何原因）。
 */
export const CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "claude-plugins-official";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@zcode-plugins-official",
  // OpenZWork（T09）：文档族四件套随上游拆分补入（与 official-plugin-definitions 的
  // defaultEnabled 机械对照）；上游的 image-search（OZ-D009）与 zcode-site 不引入。
  "documents@zcode-plugins-official",
  "pdf@zcode-plugins-official",
  "presentations@zcode-plugins-official",
  "spreadsheets@zcode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 启用」，宿主自己不参与那个判断。
  // Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@zcode-plugins-official",
  // OpenZWork：官方内容型插件默认启用名单保留（本地 seed 目录可用，无 CDN 依赖）；
  // 原生 computer-use 不纳入产品支持；CUA 兼容入口只保留空实现。
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
// Claude 官方目录（anthropics/claude-plugins-official）保留注册（2026-11-14 T15 修复）：它是
// GitHub 公开仓库 shorthand 而非官方产品域，不在 WP-08 净化面（门禁只拦官方域字面量）；
// Git 不可用时的 GitHub Archive 刷新通道与 no-git 用例都依赖该默认条目存在。
export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    id: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "anthropics/claude-plugins-official",
    name: CLAUDE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description:
      "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
    // 只内置官方 catalog 来源，不把远端 manifest 快照打包进仓库；首次刷新前数量未知。
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个 ZCode 官方市场 id，内置与第三方市场不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
