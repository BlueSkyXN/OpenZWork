import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@zcode/contracts";

// 内置插件的商店信息 seed（原样写入官方 marketplace.json 的条目 raw，键名与 CDN 目录
// schema 一致：displayName_i18n / examplePrompts_i18n 等），解析复用 adapter 的
// parseEntryStoreListing。icon 不再指向官方 assets CDN；UI 使用默认图标降级。
export interface OfficialPluginListingSeed {
  displayName?: string;
  displayName_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  category?: string;
  author?: { name: string; url?: string };
  icon?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  heroImage?: string;
  examplePrompts?: string[];
  examplePrompts_i18n?: Record<string, string[]>;
}

const OFFICIAL_BROWSER_USE_PLUGIN_NAME = "browser-use";
export const OFFICIAL_BROWSER_USE_PLUGIN_ID = `${OFFICIAL_BROWSER_USE_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;
/**
 * node_repl 宿主。它不是面向用户的插件：没有 skill、没有 listing、不进市场，唯一职责是
 * 携带 `dist/mcp/server.js` 这个 Browser Use 运行时产物。
 *
 * 为什么它需要成为一个 seed 单元：宿主产物过去长在 browser-use 包里，于是
 * resolveBuiltInNodeReplMcpServers 只能在 browser-use 的 rootPath 下找它 —— browser-use
 * 包缺失时便拿不到宿主。做成独立 seed 单元后，插件只贡献自己的领域资产。
 */
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME = "node-repl-host";
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_ID = `${OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;

export interface OfficialPluginDefinition {
  // 内容型 plugin (无 MCP server / 无系统依赖) 可以设为 true,
  // 这样用户首次 `/skill <name>` 就能用,不必先 `zcode plugins enable`。
  defaultEnabled?: boolean;
  listing?: OfficialPluginListingSeed;
  /**
   * 由宿主为该官方插件提供、但不属于 plugin manifest 的 MCP server。
   * 仅用于产品归属和设置页状态展示；运行时仍保留宿主 identity。
   */
  hostMcpServerNames?: readonly string[];
  name: string;
  /** filesystem/SEA seed 缺少任一项时拒绝生成残缺的官方插件缓存。 */
  requiredSeedPaths?: readonly string[];
  rootCandidates: readonly string[];
  /** Extra top-level paths intentionally staged as plugin runtime assets. */
  runtimeTopLevelPaths?: readonly string[];
  version: string;
}

const OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS = ["dist/mcp/server.js"] as const;

export const OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS = [
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已注册 recording lookup；若不强制校验正文，会 seed 出无法读取录屏指南的残缺插件。
  "docs/recording.md",
  "docs/workflow.md",
  "scripts/browser-client.mjs",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
] as const;

export const OFFICIAL_PLUGIN_DEFINITIONS: readonly OfficialPluginDefinition[] = [
  {
    // 无 listing：宿主不进市场、不对用户露出。它必须始终可用，因为 node_repl 的注册门禁
    // 是「Browser Use 启用」，宿主自己不参与那个判断。
    //
    // 这里的 defaultEnabled 不违反「仅限内容型插件」那条约定：
    // 约定要防的是「首启即注入整套工具集并拉起 Helper」，而 seed 宿主两件都不做——工具是否
    // 进模型工具池由能力插件的启停决定。
    defaultEnabled: true,
    name: OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/node-repl-host",
      "../node-repl-host",
      "../../node-repl-host",
      "../../../node-repl-host",
    ],
    version: "0.6.0",
  },
  {
    // manifest 只声明 browser-use skill；宿主 node_repl MCP 独立注入，package 另外携带其 server/client
    // runtime 资产。默认启用仅控制「何时/如何用内置浏览器」的 skill 与 browser bridge。
    defaultEnabled: true,
    hostMcpServerNames: ["node_repl"],
    listing: {
      category: "productivity",
      displayName: "Browser Use",
      displayName_i18n: { "zh-CN": "浏览器操作" },
      description_i18n: {
        "zh-CN": "操作 ZCode 内置浏览器，检查网页并验证交互。",
      },
    },
    name: OFFICIAL_BROWSER_USE_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/browser-use-plugin",
      "../browser-use-plugin",
      "../../browser-use-plugin",
      "../../../browser-use-plugin",
    ],
    // 插件 package/manifest 升版时遗漏官方 seed 版本，会继续加载旧缓存目录。
    // package、manifest、definition 三处版本应保持一致，避免发布内容和安装版本再次分叉。
    version: "0.5.1",
  },
];

// 在 official plugin 定义里标了 defaultEnabled: true 的, 拼成 `<name>@<marketplace>` 形式,
// 透传给 adapter 让它在用户没显式配置时默认开启 (内容型 plugin 才适用)。
// 注意: 任何解析 plugin 的入口 (CLI 子命令 resolveZCodePlugins、应用启动 resolveStartupPlugins)
// 都必须把这个集合传给 discoverNodePluginsSync, 否则 defaultEnabled 不生效。
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set(
  OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
    (definition) => `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
  ),
);

export function resolveOfficialPluginHostMcpServerNames(pluginId: string): string[] {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.hostMcpServerNames ? [...definition.hostMcpServerNames] : [];
}

/**
 * 官方插件由 host CLI 注入的 MCP（如 browser-use 的 `node_repl`）server name 不带 `plugin:` 前缀，
 * 资源管理器归属插件时需要反查所属官方插件名。
 */
export function resolveOfficialPluginNameByHostMcpServerName(
  serverName: string,
): string | undefined {
  return OFFICIAL_PLUGIN_DEFINITIONS.find((definition) =>
    definition.hostMcpServerNames?.includes(serverName),
  )?.name;
}
