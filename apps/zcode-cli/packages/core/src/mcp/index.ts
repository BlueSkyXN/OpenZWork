// MCP tool bridge - projects MCP descriptors into core tool entries

import {
  modelMessageContentToText,
  ZCODE_MCP_ERROR_PRESENTATION_MESSAGE_ONLY,
  ZCODE_MCP_ERROR_PRESENTATION_META_KEY,
  type JsonSchema,
  type McpPort,
  type McpToolCallResult,
  type McpToolDescriptor,
  type ModelMessageContent,
  type ModelMessageContentBlock,
  type ModelToolSideEffectScope,
  type RiskLevel,
} from "@zcode/contracts";
import type { ToolRegistry } from "../tool/registry.js";
import type { ToolEntry } from "../tool/types.js";
import { createToolRuleNameSet } from "../tool/tool-visibility.js";
import {
  asDataUrl,
  base64PayloadFromMcpImageData,
  normalizeMcpToolResultForModel,
} from "./image-normalization.js";
import { toMcpToolName } from "./name.js";

export { toMcpToolName } from "./name.js";

export {
  HOST_NODE_REPL_IMAGE_MAX_DIMENSION,
  MCP_IMAGE_INLINE_BASE64_BYTES,
  MCP_IMAGE_INLINE_RAW_BYTES,
} from "./image-normalization.js";

const MCP_TOOL_TIMEOUT_MS = 30_000;

export interface RegisterMcpToolsOptions {
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
}

export function registerMcpTools(
  registry: ToolRegistry,
  mcpPort: McpPort,
  descriptors: readonly McpToolDescriptor[],
  options: RegisterMcpToolsOptions = {},
): string[] {
  const allowed = options.allowedTools ? new Set(options.allowedTools) : undefined;
  const disallowed = createToolRuleNameSet(options.disallowedTools);
  const registered: string[] = [];

  for (const descriptor of descriptors) {
    const name = toMcpToolName(descriptor);
    if (allowed && !allowed.has(name)) continue;
    if (disallowed?.has(name)) continue;
    registry.register(createMcpToolEntry(name, descriptor, mcpPort));
    registered.push(name);
  }

  return registered;
}

function createMcpToolEntry(
  name: string,
  descriptor: McpToolDescriptor,
  mcpPort: McpPort,
): ToolEntry {
  const readOnly = descriptor.annotations?.readOnlyHint === true;
  const destructive = descriptor.annotations?.destructiveHint === true;
  const isHostNodeReplExecution =
    descriptor.serverName === "node_repl" && descriptor.toolName === "js";
  // 宿主 node_repl 的 js 能执行本机 Node 代码，不能沿用普通未知 MCP 的 medium/network
  // 默认值；否则权限 UI 会把文件/进程级能力错误描述成普通网络调用。
  const sideEffectScope: ModelToolSideEffectScope = isHostNodeReplExecution ? "system" : "network";
  const riskLevel: RiskLevel = isHostNodeReplExecution
    ? "high"
    : destructive
      ? "high"
      : readOnly
        ? "low"
        : "medium";
  const needsApproval = true;
  const timeoutMs = descriptor.timeoutMs ?? MCP_TOOL_TIMEOUT_MS;
  const resultBudget = isHostNodeReplExecution
    ? {
        maxInlineBytes: 1_000_000,
        maxModelBytes: 64 * 1024,
        strategy: "artifact" as const,
        preview: { direction: "tail" as const, maxBytes: 64 * 1024 },
        artifact: { enabled: true, retention: "session" as const },
      }
    : {
        maxInlineBytes: 100_000,
        maxModelBytes: 50_000,
        strategy: "truncate" as const,
        preview: { direction: "head" as const },
      };

  return {
    capability: `MCP tool exposed by ${descriptor.serverName}: ${descriptor.toolName}`,
    inputSchema: normalizeInputSchema(descriptor.inputSchema),
    outputSchema: McpToolOutputJsonSchema,
    metadata: {
      concurrentSafe: readOnly || descriptor.annotations?.idempotentHint === true,
      destructive,
      // 必须把 MCP tool 的 description 透传到 metadata，让 registry 把它带进模型输入，
      // 否则模型侧只看到 name + inputSchema，调用 MCP 工具时缺乏判断依据。
      description: descriptor.description,
      name,
      mcpPresentation: {
        serverName: descriptor.serverName,
        toolName: descriptor.toolName,
        ...(descriptor.description ? { description: descriptor.description } : {}),
      },
      needsApproval,
      readOnly,
      riskLevel,
      sideEffectScope,
      timeoutMs,
    },
    permission: {
      permission: "mcp",
      reason: `MCP tool ${descriptor.serverName}/${descriptor.toolName} executes through an external server`,
      riskLevel,
      sideEffectScope,
      needsApproval,
      patternSources: ["toolName", "input", "network"],
      denyPriority: "beforeAsk",
    },
    resultBudget,
    timeout: {
      defaultMs: timeoutMs,
      allowCallOverride: false,
    },
    cancellation: {
      supported: true,
      cleanup: "bestEffort",
      userVisibleMessage: `MCP tool ${name} was cancelled`,
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
    handler: async (input, context) => {
      const result = await mcpPort.callTool(
        {
          serverName: descriptor.serverName,
          toolName: descriptor.toolName,
          arguments: toRecordInput(input),
          trace: {
            traceId: context.traceId,
            spanId: context.spanId,
            parentSpanId: context.parentSpanId,
            sessionId: context.sessionId,
            turnId: context.turnId,
          },
          runtimeScope: context.runtimeScope ?? "main",
          workspacePath: context.workingDirectory,
          ...(context.remoteSessionId ? { remoteSessionId: context.remoteSessionId } : {}),
          ...(context.workspaceIdentity?.trim()
            ? {
                workspaceIdentity: context.workspaceIdentity.trim(),
                workspaceKey: context.workspaceIdentity.trim(),
              }
            : { workspaceKey: context.workingDirectory }),
          ...(context.turnId ? { turnId: context.turnId } : {}),
          clientMode: context.clientMode ?? "desktop-continuous",
          deliveryKind: context.deliveryKind ?? "desktop-continuous",
        },
        {
          signal: context.abortSignal,
          timeoutMs,
        },
      );
      // MCP server 会返回大 base64 图片；resultBudget 只看到图片占位文本，
      // 必须在 handler 阶段保存副本并替换模型可见内容，避免 provider 请求体被打爆。
      return normalizeMcpToolResultForModel({
        compressOversizedImages: isHostNodeReplExecution,
        context,
        descriptor,
        result,
        toolName: name,
      });
    },
    formatModelContent: (output) => formatMcpToolResult(output),
  };
}

export const McpToolOutputJsonSchema = {
  type: "object",
  required: ["content"],
  properties: {
    content: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    structuredContent: {},
    isError: {
      type: "boolean",
    },
    _meta: {
      type: "object",
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} satisfies JsonSchema;

function normalizeInputSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || typeof schema !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }

  return {
    ...schema,
    type: "object",
    properties:
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? schema.properties
        : {},
  };
}

function hasInformativeStructuredContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function formatMcpToolResult(output: unknown): ModelMessageContent {
  if (!isMcpToolCallResult(output)) {
    return stringify(output);
  }

  const blocks = output.content.flatMap(formatContentBlock);
  // 生产 adapter 会保留 structuredContent 的空键；undefined、null、空对象和
  // 空数组都没有模型信息，不能追加伪造的 "Structured content" 块。有内容的错误详情
  // 仍需保留，权限引导依赖这条结构化通道。
  if (hasInformativeStructuredContent(output.structuredContent)) {
    blocks.push({
      type: "text",
      text: `Structured content:\n${stringify(output.structuredContent)}`,
    });
  }

  const content = blocks.length > 0 ? collapseModelBlocks(blocks) : stringify(output);
  if (!output.isError) return content;
  // 展示策略由 MCP result 显式声明；通用 bridge 不应识别具体 server，
  // 也不应通过解析错误字符串来猜测哪些内容属于堆栈。
  const errorPresentation = output._meta?.[ZCODE_MCP_ERROR_PRESENTATION_META_KEY];
  return typeof errorPresentation === "string" &&
    errorPresentation === ZCODE_MCP_ERROR_PRESENTATION_MESSAGE_ONLY
    ? content
    : `MCP tool returned an error:\n${modelMessageContentToText(content)}`;
}

function formatContentBlock(block: Record<string, unknown>): ModelMessageContentBlock[] {
  if (block.type === "text" && typeof block.text === "string") {
    return block.text.length > 0 ? [{ type: "text", text: block.text }] : [];
  }
  if (block.type === "image") {
    const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
    if (typeof block.data === "string" && typeof block.mimeType === "string") {
      return [
        {
          type: "image",
          mediaType: block.mimeType,
          dataUrl: asDataUrl(block.data, block.mimeType),
          source: {
            id: "mcp-image",
            kind: "inline",
            mimeType: block.mimeType,
            placeholder: "MCP image",
            sizeBytes: estimateBase64Bytes(block.data),
          },
        },
      ];
    }
    return [{ type: "text", text: `[MCP image content omitted: ${mimeType}]` }];
  }
  if (block.type === "audio") {
    const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
    return [{ type: "text", text: `[MCP audio content omitted: ${mimeType}]` }];
  }
  if (block.type === "resource") {
    return [{ type: "text", text: `MCP resource content:\n${stringify(block.resource ?? block)}` }];
  }
  return [{ type: "text", text: stringify(block) }];
}

function collapseModelBlocks(blocks: ModelMessageContentBlock[]): ModelMessageContent {
  if (blocks.every((block) => block.type === "text")) {
    return blocks.map((block) => (block.type === "text" ? block.text : "")).join("\n\n");
  }
  return blocks;
}

function estimateBase64Bytes(value: string): number | undefined {
  const data = base64PayloadFromMcpImageData(value);
  if (data.length === 0) return undefined;
  return Math.floor((data.replace(/=+$/, "").length * 3) / 4);
}

function isMcpToolCallResult(value: unknown): value is McpToolCallResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as McpToolCallResult).content)
  );
}

function toRecordInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
