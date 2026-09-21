import type { ZCodeProvider } from "@zcode/shared";

type SkillSourceType = "glm" | "unknown";

function resolveSkillSourceType(skillPath: string): SkillSourceType {
  const normalized = skillPath.replaceAll("\\", "/").toLowerCase();
  // 项目级根保留 .zcode（D-03），用户级根为 .openzwork，两者都属于原生来源。
  if (normalized.includes("/.zcode/skills/") || normalized.includes("/.openzwork/skills/")) {
    return "glm";
  }
  if (
    normalized.includes("/.zcode/cli/plugins/cache/") ||
    normalized.includes("/.openzwork/cli/plugins/cache/")
  ) {
    return "glm";
  }
  return "unknown";
}

const SKILL_ID_PROVIDER_RE = /^glm:/;

function isZcodeSkill(skill: { id?: string; path: string; scope?: string }): boolean {
  return (
    // plugin skill 的真实路径在 CLI plugin cache 下，不在 `.zcode/skills`。
    // 服务层已用 scope 标记来源，前端过滤时要放行，否则 `/` 和 `$` 面板会漏掉插件技能。
    skill.scope === "plugin" ||
    (typeof skill.id === "string" && SKILL_ID_PROVIDER_RE.test(skill.id)) ||
    resolveSkillSourceType(skill.path) === "glm"
  );
}

export function filterSkillsForProvider<T extends { path: string; id?: string; scope?: string }>(
  skills: T[],
  _legacyProvider: ZCodeProvider,
): T[] {
  return skills.filter(isZcodeSkill);
}
