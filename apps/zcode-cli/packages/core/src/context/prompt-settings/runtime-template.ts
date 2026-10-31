import type { SystemPromptRuntimeTemplate } from "@zcode/shared";
import type { ContextBuilderConfig } from "../types.js";
import { buildDesktopContextSection, buildDesktopRuntimeContent } from "../sections/desktop.js";
import {
  buildMemorySection,
  buildMemoryLocation,
  buildMemoryIndexGuidance,
} from "../sections/memory.js";
import { buildRolePrompt } from "../sections/identity.js";
import { buildSessionGuidanceSection } from "../dynamic-sections.js";
import { ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH } from "../../memory/project-memory-retrieval-branch.js";

type RuntimePromptContext = Pick<
  ContextBuilderConfig,
  | "presentationSurface"
  | "genUiOutputDirectory"
  | "memoryRoot"
  | "outputStyle"
  | "guidanceToolNames"
  | "skills"
>;

/** 目录情景和实际会话共用能力判断；UI 不解释能力或读取真实路径。 */
export function getRuntimePromptTemplate(
  id: string,
  context: RuntimePromptContext,
): SystemPromptRuntimeTemplate | undefined {
  const template: SystemPromptRuntimeTemplate = {
    available: true,
    defaultContent: "",
    runtimeBefore: "",
    runtimeAfter: "",
    variables: {
      ...(context.memoryRoot ? { memoryRoot: context.memoryRoot } : {}),
      ...(context.genUiOutputDirectory
        ? { genUiOutputDirectory: JSON.stringify(context.genUiOutputDirectory) }
        : {}),
    },
  };
  switch (id) {
    case "desktop_context":
      return {
        ...template,
        available: context.presentationSurface === "zcode_desktop",
        defaultContent: buildDesktopContextSection(context.genUiOutputDirectory).content,
        runtimeBefore: buildDesktopRuntimeContent(context.genUiOutputDirectory),
      };
    case "memory":
      return {
        ...template,
        available: Boolean(context.memoryRoot),
        defaultContent:
          buildMemorySection(context.memoryRoot, ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH)?.content ??
          "",
        runtimeBefore: context.memoryRoot
          ? "# Memory\n\n" + buildMemoryLocation(context.memoryRoot)
          : "",
        runtimeAfter: buildMemoryIndexGuidance(ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH),
      };
    case "session_guidance": {
      const guidance = buildSessionGuidanceSection(
        context.guidanceToolNames ?? [],
        (context.skills?.skills.length ?? 0) > 0,
      );
      return { ...template, available: guidance !== null, defaultContent: guidance?.content ?? "" };
    }
    case "output_style": {
      // OpenZWork 净化：上游经 buildOutputStyleSection（output_style section source）预览
      // 该段；我方未合入上游 prompt-settings 的 output_style 分段注入体系，输出样式正文仍由
      // buildIdentitySection 拼进 role 段，这里只保留空预览占位。
      const style = context.outputStyle?.prompt.trim()
        ? `# Output Style: ${context.outputStyle.name}\n${context.outputStyle.prompt.trim()}`
        : "";
      return { ...template, defaultContent: style, runtimeAfter: style };
    }
    case "role":
      return {
        ...template,
        defaultContent: buildRolePrompt(
          context.outputStyle?.prompt.trim() ? context.outputStyle : undefined,
        ),
      };
    default:
      return undefined;
  }
}

export function getPromptPreviewScenarios(id: string) {
  const scenario = (
    scenarioId: import("@zcode/shared").SystemPromptCatalog["sections"][number]["scenarios"][number]["id"],
    context: RuntimePromptContext,
  ) => ({
    id: scenarioId,
    template: getRuntimePromptTemplate(id, context)!,
  });
  switch (id) {
    case "desktop_context":
      return [
        scenario("gen_ui_available", {
          presentationSurface: "zcode_desktop",
          genUiOutputDirectory: "/example/views",
        }),
        scenario("gen_ui_unavailable", { presentationSurface: "zcode_desktop" }),
        scenario("terminal", { presentationSurface: "terminal" }),
      ];
    case "memory":
      return [
        scenario("memory_enabled", { memoryRoot: "/example/memory" }),
        scenario("memory_disabled", {}),
      ];
    case "session_guidance":
      // 只需 hasSkills；合成目录不携带用户技能或文件内容。
      return [
        {
          id: "skills_available" as const,
          template: {
            ...getRuntimePromptTemplate(id, {})!,
            available: true,
            defaultContent: buildSessionGuidanceSection(["Skill"], true)!.content,
          },
        },
        scenario("skills_unavailable", {}),
      ];
    case "role":
    case "output_style":
      return [
        scenario("style_none", {}),
        scenario("style_active", {
          outputStyle: { name: "Example", prompt: "Use short paragraphs." },
        }),
      ];
    default:
      return [];
  }
}
