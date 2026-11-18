// ============================================================
// Request User Context Section Builder
// ============================================================

import { join } from "node:path";

import { formatProjectMemoryIndexContent } from "../../memory/index-content.js";
import type {
  ContextSection,
  InstructionFile,
  ResolvedUserInstructionSource,
  ResolvedUserInstructions,
} from "../types.js";
import { estimateTokens } from "../utils.js";
import {
  createInstructionFile,
  INSTRUCTIONS_PREAMBLE,
  INSTRUCTION_TYPE_AUTO_MEMORY,
  INSTRUCTION_TYPE_PROJECT,
  INSTRUCTION_TYPE_USER,
  renderInstructionFile,
} from "./instruction-files.js";

export function buildRequestUserContextSection(input: {
  userInstructions?: ResolvedUserInstructions;
  memoryIndexContent?: string;
  memoryRoot?: string;
}): ContextSection | null {
  const instructionFiles = buildInstructionFiles(input);
  if (instructionFiles.length === 0) {
    return null;
  }
  // OpenZWork：完整块保留 fork 聚合格式（# agentsMd 标题 + scope 标签的 Contents 行）；
  // instructionFiles 记录仍用上游类型枚举，增量公告走上游 renderInstructionDelta，
  // 去重比较（path+hash+type）在两侧同源，保持一致。
  const content = renderForkInstructionAnnouncement(input, instructionFiles);

  return {
    name: "Request User Context",
    source: "request_user_context",
    injectionTarget: "meta_user",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
    instructionFiles,
  };
}

/** 指令文件在前、Memory 索引在后；正文为空的文件不出现。 */
function buildInstructionFiles(input: {
  userInstructions?: ResolvedUserInstructions;
  memoryIndexContent?: string;
  memoryRoot?: string;
}): InstructionFile[] {
  const files = input.userInstructions
    ? normalizedInstructionSources(input.userInstructions).flatMap((source) => {
        const file = buildInstructionSourceFile(source);
        return file ? [file] : [];
      })
    : [];
  const memoryIndexFile = buildProjectMemoryIndexFile(input.memoryRoot, input.memoryIndexContent);
  if (memoryIndexFile) files.push(memoryIndexFile);
  return files;
}

function buildProjectMemoryIndexFile(
  memoryRoot: string | undefined,
  indexContent: string | undefined,
): InstructionFile | null {
  if (!memoryRoot || indexContent === undefined) return null;
  const formatted = formatProjectMemoryIndexContent(indexContent);
  if (!formatted) return null;

  return createInstructionFile(
    join(memoryRoot, "MEMORY.md"),
    INSTRUCTION_TYPE_AUTO_MEMORY,
    formatted,
  );
}

/** fork 完整块正文：scope 标签区分 user/workspace，Memory 索引沿用上游写法。 */
function renderForkInstructionAnnouncement(
  input: {
    userInstructions?: ResolvedUserInstructions;
    memoryIndexContent?: string;
    memoryRoot?: string;
  },
  files: readonly InstructionFile[],
): string {
  const blocks =
    input.userInstructions
      ? normalizedInstructionSources(input.userInstructions).flatMap((source) => {
          const block = renderForkSourceBlock(source);
          return block ? [block] : [];
        })
      : [];
  const memoryFile = files.find((file) => file.type === INSTRUCTION_TYPE_AUTO_MEMORY);
  if (memoryFile) blocks.push(renderInstructionFile(memoryFile));
  return [INSTRUCTIONS_PREAMBLE, "", "# agentsMd", "", blocks.join("\n\n")].join("\n");
}

function renderForkSourceBlock(source: ResolvedUserInstructionSource): string | null {
  const body = source.truncated
    ? `${source.content}\n\n[File truncated: ${source.fileName}]`
    : source.content;
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return null;
  }
  return [
    `Contents of ${source.filePath} (${formatInstructionSourceScope(source.scope)}):`,
    "",
    trimmedBody,
  ].join("\n");
}

function formatInstructionSourceScope(scope: ResolvedUserInstructionSource["scope"]): string {
  return scope === "user" ? "user default instructions" : "workspace instructions";
}

export function normalizedInstructionSources(
  instructions: ResolvedUserInstructions,
): ResolvedUserInstructionSource[] {
  if (instructions.sources && instructions.sources.length > 0) {
    return instructions.sources;
  }

  return [
    {
      scope: "workspace",
      filePath: instructions.filePath,
      fileName: instructions.fileName,
      content: instructions.content,
      bytesRead: instructions.bytesRead,
      sizeBytes: instructions.sizeBytes,
      truncated: instructions.truncated,
    },
  ];
}

function buildInstructionSourceFile(source: ResolvedUserInstructionSource): InstructionFile | null {
  const body = source.truncated
    ? `${source.content}\n\n[File truncated: ${source.fileName}]`
    : source.content;
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return null;
  }

  return createInstructionFile(
    source.filePath,
    source.scope === "user" ? INSTRUCTION_TYPE_USER : INSTRUCTION_TYPE_PROJECT,
    trimmedBody,
  );
}
