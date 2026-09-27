// 远端 ZCode Agent 以「独立 node + 编译产物 zcode.cjs」的形态运行，而不是各平台内嵌 node 的原生二进制。
// 远端部署时本来就有一份独立 node（用于跑 zcode-server.cjs），agent 复用它执行 zcode.cjs 即可。
//
// 部署布局：把 zcode.cjs 放到 agents/<provider>/zcode.cjs，再写一个同名 wrapper —— 就是 resolver
// 期望找到的可执行入口（如 agents/glm/zcode-agent）—— 由它用远端 node 执行 zcode.cjs。
// 这样 provider runtime resolver 不需要区分原生/JS，照旧找 zcode-agent 这个可执行文件即可。
// 开发态与生产态共用同一份 wrapper 语义。

import { REMOTE_BASE_HOME_EXPR } from "./deployShared.js";

export const REMOTE_AGENT_BUNDLE_NAME = "zcode.cjs";

export function buildRemoteAgentBundleWrapper(runtimeResourceDir: string): string {
  return [
    "#!/bin/sh",
    "set -eu",
    // WP-03 用户级数据根隔离：兜底值必须落 OpenZWork 命名空间（与 deployShared.REMOTE_BASE 同源），
    // 旧兜底硬编码官方旧根，会在 connect 未注入 ZCODE_SERVER_RUNTIME_ROOT 时退回官方目录。
    `runtime_root="\${ZCODE_SERVER_RUNTIME_ROOT:-${REMOTE_BASE_HOME_EXPR}}"`,
    `exec "$runtime_root/node" "${REMOTE_BASE_HOME_EXPR}/agents/${runtimeResourceDir}/${REMOTE_AGENT_BUNDLE_NAME}" "$@"`,
    "",
  ].join("\n");
}

export function isRemoteAgentBundleWrapperCurrent(
  content: string,
  runtimeResourceDir: string,
): boolean {
  return content.replace(/\r\n/g, "\n") === buildRemoteAgentBundleWrapper(runtimeResourceDir);
}
