import {
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  systemPromptObservationResultSchema,
  systemPromptPreviewDocumentSchema,
  systemPromptPreviewParamsSchema,
  type SystemPromptObservationParams,
  type SystemPromptObservationResult,
  type SystemPromptPreviewBlock,
  type SystemPromptPreviewDocument,
  type SystemPromptPreviewParams,
  type SystemPromptPreviewResult,
  type SystemPromptSettings,
} from "@zcode/shared";
import { modelMessageContentToText } from "@zcode/contracts";
import { ContextBuilder } from "../builder.js";
import type { ContextBuildResult, ContextBuilderConfig } from "../types.js";

function promptDocumentFromBuild(
  result: ContextBuildResult,
  settings?: SystemPromptSettings,
): SystemPromptPreviewDocument {
  const counts = new Map<string, number>();
  return systemPromptPreviewDocumentSchema.parse({
    blocks: result.sections.map((section) => {
      const index = counts.get(section.source) ?? 0;
      counts.set(section.source, index + 1);
      return {
        id: `${section.source}:${section.source === "user_prompt_section" ? (settings?.customSections[index]?.id ?? index) : index}`,
        source: section.source,
        title: section.name,
        target: section.injectionTarget,
        content: section.content,
      };
    }),
  });
}

export function buildSystemPromptPreview(
  raw: SystemPromptPreviewParams,
): SystemPromptPreviewResult {
  const { settings, baseline, scenario } = systemPromptPreviewParamsSchema.parse(raw);
  const config: ContextBuilderConfig = {
    workingDirectory: "/example/project",
    envInfo: {
      cwd: "/example/project",
      platform: "linux",
      shell: "bash",
      osVersion: "Example OS",
      nodeVersion: "24",
      isGitRepository: scenario.git,
      ...(scenario.git
        ? {
            gitBranch: "example-branch",
            gitMainBranch: "main",
            gitUser: "Example User",
            gitStatus: "clean" as const,
            recentCommits: ["abc1234 Example commit"],
          }
        : {}),
    },
    presentationSurface: scenario.surface === "desktop" ? "zcode_desktop" : "terminal",
    ...(scenario.visualization && scenario.surface === "desktop"
      ? { genUiOutputDirectory: "/example/views" }
      : {}),
    currentDate: "2030-01-01",
    userInstructions: {
      filePath: "/example/project/AGENTS.md",
      fileName: "AGENTS.md",
      content: "Example project instructions: run focused checks before delivery.",
      bytesRead: 80,
      sizeBytes: 80,
      truncated: false,
    },
    ...(scenario.memory
      ? {
          memoryRoot: "/example/memory",
          memoryIndexContent: "# Example memory index\n- project.md: project conventions",
        }
      : {}),
    ...(scenario.outputStyle
      ? { outputStyle: { name: "Example", prompt: "Use short paragraphs." } }
      : {}),
    guidanceToolNames: scenario.skills ? ["Skill"] : [],
    skills: {
      skills: scenario.skills
        ? [
            {
              name: "example-review",
              description: "Review an example change and report evidence.",
              path: "/example/skills/example-review/SKILL.md",
              directory: "/example/skills/example-review",
              rootPath: "/example/skills",
              scope: "project",
              source: "agents",
              safeToAutoLoad: false,
              frontmatterKeys: ["name", "description"],
            },
          ]
        : [],
      diagnostics: [],
      totalDiscovered: scenario.skills ? 1 : 0,
    },
  };
  const build = (value: SystemPromptSettings) =>
    promptDocumentFromBuild(
      new ContextBuilder({ ...config, systemPromptSettings: value }).build(),
      value,
    );
  return { after: build(settings), ...(baseline ? { before: build(baseline) } : {}) };
}

const CONTEXT_SWITCH_SOURCES: Record<string, string> = {
  environment: "env_info",
  model: "env_info",
  output_style_instructions: "env_info",
  session_context: "system_context",
  git_system_context: "system_context",
  skills_listing: "skills",
  context_prefix: "request_user_context",
  date: "current_date",
};
export const SYSTEM_PROMPT_OBSERVED_SOURCES: ReadonlySet<string> = new Set(
  Object.keys(CONTEXT_SWITCH_SOURCES),
);

type Observation = {
  snapshot: Extract<SystemPromptObservationResult, { status: "available" }>;
  builder: ContextBuilder | null;
  settings: SystemPromptSettings | undefined;
};

/** 每个 runtime 独占最近请求投影；读取不触发 context 初始化、IO 或模型调用。 */
export class SystemPromptObservation {
  private observation: Observation | undefined;
  private unavailable: "no_request" | "incomplete" = "no_request";

  capture(input: {
    sessionId: string;
    requestId: string;
    capturedAt: string;
    model: string;
    blocks: SystemPromptPreviewBlock[];
    complete: boolean;
    builder: ContextBuilder | null;
    settings?: SystemPromptSettings;
  }): void {
    this.observation = undefined;
    this.unavailable = "incomplete";
    if (!input.complete) return;
    const parsed = systemPromptObservationResultSchema.safeParse({
      status: "available",
      snapshotId: input.requestId,
      sessionId: input.sessionId,
      capturedAt: input.capturedAt,
      model: input.model,
      boundary: "application-request",
      actual: { blocks: input.blocks },
    });
    if (!parsed.success || parsed.data.status !== "available") return;
    this.observation = {
      snapshot: parsed.data,
      builder: input.builder,
      settings: input.settings ? structuredClone(input.settings) : undefined,
    };
  }

  read(
    input: Pick<SystemPromptObservationParams, "snapshotId" | "settings">,
  ): SystemPromptObservationResult {
    const saved = this.observation;
    if (!saved) return { status: "unavailable", reason: this.unavailable };
    if (input.snapshotId && input.snapshotId !== saved.snapshot.snapshotId)
      return { status: "unavailable", reason: "expired" };
    const result = structuredClone(saved.snapshot);
    if (!input.settings) return result;
    if (!saved.builder) return { ...result, comparisonUnavailable: "context_unavailable" };
    const comparison = this.compare(saved, input.settings);
    if (!comparison) return { ...result, comparisonUnavailable: "context_unavailable" };
    const parsed = systemPromptPreviewDocumentSchema.safeParse(comparison);
    return parsed.success
      ? { ...result, comparison: parsed.data }
      : { ...result, comparisonUnavailable: "incomplete" };
  }

  private compare(
    saved: Observation,
    settings: SystemPromptSettings,
  ): SystemPromptPreviewDocument | null {
    const builder = saved.builder!;
    const baseline = builder.build();
    const next = builder.copyForPromptPreview(settings).build();
    const actual = saved.snapshot.actual.blocks;
    const systemTexts = baseline.systemMessages.map((message) =>
      modelMessageContentToText(message.content),
    );
    const ownedIndices: number[] = [];
    for (const content of systemTexts) {
      const index = actual.findIndex(
        (block, i) =>
          !ownedIndices.includes(i) &&
          block.source === "system" &&
          block.target === "system" &&
          block.content === content,
      );
      if (index < 0) return null;
      ownedIndices.push(index);
    }
    // 缺席的动态事实不能用当前磁盘内容补造；重新启用时需回到草稿示例或新的真实请求。
    const disabled = (value: SystemPromptSettings | undefined, id: string) =>
      value?.sections[id as keyof SystemPromptSettings["sections"]]?.mode === "disabled";
    const changed = GENERATED_SYSTEM_PROMPT_SECTIONS.filter(
      (id) => disabled(saved.settings, id) !== disabled(settings, id),
    );
    if (changed.some((id) => disabled(saved.settings, id))) return null;
    if (changed.length && actual.some((block) => block.source === "runtime_context")) return null;
    const output: SystemPromptPreviewBlock[] = [];
    const replacement = next.systemMessages.map((message, index) => ({
      id: actual[ownedIndices[index] ?? -1]?.id ?? `system:new:${index}`,
      source: "system",
      title: `System ${index + 1}`,
      target: "system" as const,
      content: modelMessageContentToText(message.content),
    }));
    let inserted = false;
    for (const [index, block] of actual.entries()) {
      if (ownedIndices.includes(index)) {
        if (!inserted) output.push(...replacement);
        inserted = true;
        continue;
      }
      const sources = block.source.split("+");
      const removed = sources.filter((source) =>
        changed.includes(CONTEXT_SWITCH_SOURCES[source] as (typeof changed)[number]),
      );
      if (removed.length && removed.length !== sources.length) return null;
      if (!removed.length) output.push(block);
    }
    if (!inserted) output.unshift(...replacement);
    return { blocks: output };
  }
}
