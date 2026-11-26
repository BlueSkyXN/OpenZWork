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

// 合成修复：上游侧本有此常量（line 62），合并时其定义段被裁掉但下方 listing 引用保留；
// 内置插件 listing 属我方保留域（plugins/skills），恢复常量而非删条目。
const ZAI_AUTHOR = { name: "Z.ai", url: "https://z.ai" } as const;
export const OFFICIAL_BROWSER_USE_PLUGIN_ID = `${OFFICIAL_BROWSER_USE_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;
export const OFFICIAL_VISUALIZE_PLUGIN_ID = `visualize@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;
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
  /**
   * 卸载（抑制）后的可恢复条目没有运行时信息，商店只能靠这里判断是否归入「UI 插件」。
   * 插件包 manifest 声明 ui.surfaces 时必须同时声明 "ui"，由 bootstrap 测试校验一致。
   */
  componentTypes?: readonly string[];
  // 内容型 plugin (无 MCP server / 无系统依赖) 可以设为 true,
  // 这样用户首次 `/skill <name>` 就能用,不必先 `zcode plugins enable`。
  defaultEnabled?: boolean;
  listing?: OfficialPluginListingSeed;
  /**
   * 由宿主为该官方插件提供、但不属于 plugin manifest 的 MCP server。
   * 仅用于产品归属和设置页状态展示；运行时仍保留宿主 identity。
   */
  hostMcpServerNames?: readonly string[];
  /**
   * 构建产物内嵌每次构建不同、但不改版本号的值时，指向构建脚本写出的身份文件。
   * seed 把文件内容记入 marker，内容变化按版本变化处理。
   */
  buildIdentityPath?: string;
  name: string;
  /** filesystem/SEA seed 缺少任一项时拒绝生成残缺的官方插件缓存。 */
  requiredSeedPaths?: readonly string[];
  rootCandidates: readonly string[];
  /** Extra top-level paths intentionally staged as plugin runtime assets. */
  runtimeTopLevelPaths?: readonly string[];
  version: string;
}

const OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS = ["dist/mcp/server.js"] as const;

/** 文档插件（documents / pdf / presentations / spreadsheets）查看面板的构建产物。 */
export const OFFICIAL_OFFICE_INVOCATION_PATHS = [
  "scripts/zcode_libreoffice.py",
  "scripts/libreoffice-profile/user/registrymodifications.xcu",
  "scripts/libreoffice-profile/user/basic/script.xlc",
  "scripts/libreoffice-profile/user/basic/dialog.xlc",
  "scripts/libreoffice-profile/user/basic/Standard/script.xlb",
  "scripts/libreoffice-profile/user/basic/Standard/dialog.xlb",
  "scripts/libreoffice-profile/user/basic/Standard/ZCode.xba",
] as const;

export const OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS = [
  "dist/server.mjs",
  "dist/ui/assets.json",
  "dist/ui/panel.html",
] as const;

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

// design 是纯内容型插件（技能 + 设计资源 + SessionStart hook，无 MCP），技能正文按需读取 references/
// 与 scripts/；hook 只注入一句指针，正文缺失时 hook 静默退出，会话里就再也触发不到技能。
// 所以这里钉住入口、11 份规则文件、7 个随包脚本和 hook，seed 缺任一项都拒绝生成残缺缓存。
export const OFFICIAL_DESIGN_REQUIRED_SEED_PATHS = [
  "skills/design/SKILL.md",
  "skills/design/references/app.md",
  "skills/design/references/catalog.md",
  "skills/design/references/check.md",
  "skills/design/references/create.md",
  "skills/design/references/deck.md",
  "skills/design/references/design-system.md",
  "skills/design/references/image.md",
  "skills/design/references/interact.md",
  "skills/design/references/motion.md",
  "skills/design/references/page.md",
  "skills/design/references/redesign.md",
  "skills/design/scripts/adapt-canvas.mjs",
  "skills/design/scripts/audit-page.js",
  "skills/design/scripts/audit.mjs",
  "skills/design/scripts/design-lint.mjs",
  "skills/design/scripts/design-tokens.mjs",
  "skills/design/scripts/import-design-system.mjs",
  "skills/design/scripts/probe.js",
  "hooks/hooks.json",
  "hooks/run-hook.cmd",
  "hooks/design-rules",
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
    // seed 版本与 package/manifest/SEA 的 0.7.1 一致，避免继续复用旧宿主缓存。
    version: "0.7.1",
  },
  // Settings 已保留这些本地内容插件；CLI 必须同步注册，才能完成发现、抑制和恢复。
  {
    defaultEnabled: true,
    listing: {
      author: { name: "Z.ai" },
      category: "productivity",
      displayName: "Visualize",
      displayName_i18n: { "zh-CN": "交互视图" },
      description_i18n: { "zh-CN": "在对话中创建交互图表、解释和设计预览。" },
    },
    name: "visualize",
    requiredSeedPaths: [
      "skills/visualize/SKILL.md",
      "skills/visualize/references/api.md",
      "skills/visualize/references/styles.md",
      "skills/visualize/tweak.md",
      "skills/visualize/LICENSE.md",
      "skills/visualize/scripts/render.py",
      "skills/visualize/assets/visualize.css",
      "skills/visualize/assets/visualize.html",
      "skills/visualize/assets/calendar.js",
      "skills/visualize/assets/runtime-manifest.json",
      "skills/visualize/scripts/vendor.py",
      "skills/visualize/assets/vendor/manifest.json",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
      "skills/visualize/assets/vendor/lucide-1.17.0.js",
      "skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
      "skills/visualize/widgets/calendar.md",
      "skills/visualize/examples/calendar.html",
      "skills/visualize/assets/standalone-host-bridge.js",
      "skills/visualize/assets/standalone-shell.js",
    ],
    rootCandidates: [
      "packages/visualize-plugin",
      "../visualize-plugin",
      "../../visualize-plugin",
      "../../../visualize-plugin",
    ],
    version: "0.1.2",
  },
  // OpenZWork：node-repl-host seed 注册沿用上方我方条目（版本 0.7.1，随 node-repl-host 净化线维护），
  // android-emulator 沿用下方无官方 CDN 图标条目，此处不重复注册。
  {
    // manifest 只声明 browser-use skill；宿主 node_repl MCP 独立注入，package 另外携带其 server/client
    // runtime 资产。默认启用仅控制「何时/如何用内置浏览器」的 skill 与 browser bridge。
    defaultEnabled: true,
    hostMcpServerNames: ["node_repl"],
    listing: {
      author: ZAI_AUTHOR,
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
    version: "0.5.2",
  },
  ...(
    [
      // 版本按插件各自升，换新缓存目录：pdf 0.2.1 起面板带中日韩字体回退；0.2.1（pdf 0.2.2）起
      // server 由工作区内各 session 共享，旧缓存的 server 不区分 session，不能沿用。
      // 0.2.10（pdf 0.2.11）起不再提供 visual-judge 子代理，换新缓存目录让老用户也不再加载旧 agents/。
      ["documents", "docx", "Documents", "Word文档", "0.2.11-openzwork.1"],
      ["pdf", "pdf", "PDF", "PDF", "0.2.12-openzwork.1"],
      ["presentations", "pptx", "Presentations", "演示文档", "0.2.11-openzwork.1"],
      ["spreadsheets", "xlsx", "Spreadsheets", "电子表格", "0.2.11-openzwork.2"],
    ] as const
  ).map(
    ([name, skill, displayName, chineseName, version]): OfficialPluginDefinition => ({
      componentTypes: ["ui"],
      defaultEnabled: true,
      // OpenZWork（T09）：恢复上游默认启用（内容型查看面板，runtime 资产由 workspace
      // build 产出并列入 requiredSeedPaths；曾临时改为默认关闭，与 shared 默认名单的
      // 机械对照和上游行为冲突）。
      listing: {
        author: ZAI_AUTHOR,
        category: "productivity",
        displayName,
        displayName_i18n: { "zh-CN": chineseName },
        description_i18n: { "zh-CN": `创建、编辑与审阅${chineseName}（${skill.toUpperCase()}）。` },
      },
      name,
      // 0.2.0 起文档插件同时提供查看面板：MCP server 与面板资源由 office-runtime 构建进 dist/，
      // 缺任一项都会 seed 出能看到面板入口却无法启动的残缺插件。
      requiredSeedPaths: [
        `skills/${skill}/SKILL.md`,
        `skills/${skill}-viewer/SKILL.md`,
        ...OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS,
        ...OFFICIAL_OFFICE_INVOCATION_PATHS,
      ],
      rootCandidates: [
        `packages/${name}-plugin`,
        `../${name}-plugin`,
        `../../${name}-plugin`,
        `../../../${name}-plugin`,
      ],
      version,
    }),
  ),
  // OpenZWork(OZ-D009): 上游 image-search（zcode_official JWT 鉴权的官方搜图 MCP）不注册，插件包已删除。
  {

    defaultEnabled: true,
    name: "plugin-creator",
    version: "0.1.1",
    listing: {
      author: { name: "Z.ai" },
      category: "utilities",
      displayName: "Plugin Creator",
      // 创建器使用客户端自带图标，不再借用 skill-creator 的远端图片。
      displayName_i18n: { "zh-CN": "插件创建器" },
      description_i18n: {
        "zh-CN": "开发、校验 ZCode 插件，完成本地 dev 市场安装、试用与更新。",
      },
    },
    rootCandidates: [
      "packages/plugin-creator-plugin",
      "../plugin-creator-plugin",
      "../../plugin-creator-plugin",
      "../../../plugin-creator-plugin",
    ],
    requiredSeedPaths: [
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ],
  },
  {
    defaultEnabled: true,
    listing: {
      author: { name: "Z.ai" },
      category: "utilities",
      displayName: "Skill Creator",
      displayName_i18n: { "zh-CN": "技能创建器" },
      description_i18n: { "zh-CN": "创建、编辑和验证可复用的 ZCode 技能。" },
    },
    name: "skill-creator",
    requiredSeedPaths: ["skills/skill-creator/SKILL.md"],
    rootCandidates: [
      "packages/skill-creator-plugin",
      "../skill-creator-plugin",
      "../../skill-creator-plugin",
      "../../../skill-creator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // 纯内容型插件（只有 commands + skills，无 MCP / 无系统依赖），默认启用，
    // 让用户/agent 开箱即用地拿到 ZCode 配置指南、自诊断技能与 dynamic workflow 编写指南。
    defaultEnabled: true,
    listing: {
      author: { name: "Z.ai" },
      category: "utilities",
      displayName: "ZCode Guide",
      displayName_i18n: { "zh-CN": "ZCode 使用指南" },
      description_i18n: {
        "zh-CN": "提供 ZCode 配置指南与插件、技能、MCP、命令和钩子诊断。",
      },
      examplePrompts: [
        "How do I configure MCP servers in ZCode?",
        "Diagnose my current ZCode setup",
      ],
      examplePrompts_i18n: {
        "zh-CN": ["ZCode 里怎么配置 MCP 服务器？", "帮我诊断当前的 ZCode 配置"],
      },
    },
    name: "zcode-guide",
    requiredSeedPaths: ["skills/zcode-configuration-guide/SKILL.md"],
    rootCandidates: [
      "packages/zcode-guide-plugin",
      "../zcode-guide-plugin",
      "../../zcode-guide-plugin",
      "../../../zcode-guide-plugin",
    ],
    version: "0.3.0",
  },
  {
    // 设计工作流（HTML 设计稿、交互原型、HTML 演示稿）。纯内容型，默认关闭；用户可启用、可停用、不可卸载。
    // 版本与 package.json / 两份 plugin.json / sea-official-plugin-assets.mjs 同步 bump。
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Design",
      // 英文名与描述回退到 manifest（displayName / description）；这里只放 zh-CN 覆盖。
      displayName_i18n: { "zh-CN": "设计" },
      description_i18n: {
        "zh-CN": "做网页设计稿、原型和演示稿；桌面端本地工作区可在内置浏览器里点选修改。",
      },
      examplePrompts: ["Design a landing page for a budgeting app", "Build an 8-page HTML deck"],
      examplePrompts_i18n: {
        "zh-CN": ["给记账 App 设计一个落地页", "做一份 8 页的 HTML 演示稿"],
      },
    },
    name: "design",
    requiredSeedPaths: OFFICIAL_DESIGN_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/design-plugin",
      "../design-plugin",
      "../../design-plugin",
      "../../../design-plugin",
    ],
    version: "0.8.0",
  },
  {
    // OpenZWork（T09）：模拟器/恢复类内置插件按上游注册（包在树内，非裁剪域）；
    // 图标行按 fork 策略省略（不指向官方 assets CDN，UI 用默认图标降级）。
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "Android Emulator",
      displayName_i18n: { "zh-CN": "Android 模拟器" },
      description_i18n: {
        "zh-CN": "提供 Android 开发工作流与模拟器自动化能力。",
      },
    },
    name: "android-emulator",
    rootCandidates: [
      "packages/android-emulator-plugin",
      "../android-emulator-plugin",
      "../../android-emulator-plugin",
      "../../../android-emulator-plugin",
    ],
    version: "0.1.3",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "iOS Simulator",
      displayName_i18n: { "zh-CN": "iOS 模拟器" },
      description_i18n: {
        "zh-CN": "提供 iOS 开发工作流与模拟器自动化能力。",
      },
    },
    name: "ios-simulator",
    rootCandidates: [
      "packages/ios-simulator-plugin",
      "../ios-simulator-plugin",
      "../../ios-simulator-plugin",
      "../../../ios-simulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Restore Legacy Sessions",
      displayName_i18n: { "zh-CN": "恢复旧版会话" },
      description_i18n: {
        "zh-CN": "将旧版会话恢复为 ZCode 任务与会话记录。",
      },
    },
    name: "restore-legacy-sessions",
    rootCandidates: [
      "packages/restore-legacy-sessions-plugin",
      "../restore-legacy-sessions-plugin",
      "../../restore-legacy-sessions-plugin",
      "../../../restore-legacy-sessions-plugin",
    ],
    version: "0.1.0",
  },
  // OpenZWork 净化（T09 吸收）：design 纯内容型插件按上游原样注册（默认关闭，见上方块）；
  // 上游在此另有 computer-use（@zcode/zcode-cua 官方 CUA 域）与
  // zcode-site（zcode_official JWT 端点域）两个 seed 注册；两者包目录已随本次合并删除，
  // 官方 CDN 图标与 zcode_official 鉴权的内置插件不注册，保持删除。

];

// 在 official plugin 定义里标了 defaultEnabled: true 的, 拼成 `<name>@<marketplace>` 形式,
// 透传给 adapter 让它在用户没显式配置时默认开启 (内容型 plugin 才适用)。
// 注意: 任何解析 plugin 的入口 (CLI 子命令 resolveZCodePlugins、应用启动 resolveStartupPlugins)
// 都必须把这个集合传给 discoverNodePlugins, 否则 defaultEnabled 不生效。
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set(
  OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
    (definition) => `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
  ),
);

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
