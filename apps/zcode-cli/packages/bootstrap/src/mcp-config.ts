import type {
  McpConfigurationSnapshot,
  McpPort,
  McpServerConfig,
  McpServerStatus,
} from "@zcode/contracts";


export async function listMcpServerStatuses(
  mcpPort: McpPort | undefined,
  servers: Record<string, McpServerConfig>,
  untrustedServerNames: ReadonlySet<string> = new Set(),
): Promise<Record<string, McpServerStatus>> {
  const liveStatuses = mcpPort ? await mcpPort.status() : {};
  const updatedAt = new Date().toISOString();
  const statuses: Record<string, McpServerStatus> = {};

  for (const [name, config] of Object.entries(servers)) {
    const configuredStatus = getConfiguredServerStatus(name, config, untrustedServerNames);
    statuses[name] = liveStatuses[name] ?? {
      status: configuredStatus,
      transport: config.type,
      toolCount: 0,
      updatedAt,
    };
  }

  for (const [name, status] of Object.entries(liveStatuses)) {
    if (!(name in statuses)) statuses[name] = status;
  }

  return statuses;
}

export function omitMcpServers(
  servers: Record<string, McpServerConfig>,
  omittedNames: ReadonlySet<string>,
): Record<string, McpServerConfig> {

  return Object.fromEntries(
    Object.entries(servers).filter(([name]) => !omittedNames.has(name)),
  );

}

function getConfiguredServerStatus(
  name: string,
  config: McpServerConfig,
  untrustedServerNames: ReadonlySet<string>,
): McpServerStatus["status"] {
  if (config.enabled === false) return "disabled";
  return untrustedServerNames.has(name) ? "untrusted" : "disconnected";
}

function getConfiguredServerError(
  name: string,
  config: McpServerConfig,
  untrustedServerNames: ReadonlySet<string>,
): string | undefined {
  if (config.enabled === false || !untrustedServerNames.has(name)) return undefined;
  return "Project MCP server requires explicit connection before use.";
}

/** 用户覆盖插件，宿主身份最后合并；首次加载和热更新共用。 */
export function resolveEffectiveMcpConfiguration(input: {
  enabled: boolean;
  servers: Record<string, McpServerConfig>;
  pluginServers?: Record<string, McpServerConfig>;
  explicit?: Partial<McpConfigurationSnapshot>;
  builtInServers?: Record<string, McpServerConfig>;
}): { configuredServers: Record<string, McpServerConfig>; mcp: McpConfigurationSnapshot } {
  const configured = {
    ...input.pluginServers,
    ...(input.explicit?.servers ?? input.servers),
    ...input.builtInServers,
  };
  return {
    configuredServers: configured,
    mcp: {
      enabled: input.explicit?.enabled ?? input.enabled,
      servers: configured,
    },
  };
}
