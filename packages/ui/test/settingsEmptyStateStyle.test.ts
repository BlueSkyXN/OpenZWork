import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("settings empty state style", () => {
  it.each([
    "packages/ui/src/settings/PluginStoreListView.tsx",
    "packages/ui/src/settings/McpServerList.tsx",
  ])("uses a dashed transparent empty state in %s", (path) => {
    const source = readSource(path);

    expect(source).toContain("border-dashed");
  });

  it.each([
    "packages/ui/src/settings/CommandsSection.tsx",
    "packages/ui/src/settings/HooksList.tsx",
    "packages/ui/src/settings/SubagentsSection.tsx",
  ])("uses the shared dashed Plugin empty state in %s", (path) => {
    const source = readSource(path);
    expect(source).toContain("<PluginInstallEmptyState");
  });

  it("uses the shared dashed Plugin empty state for Skills", () => {
    const source = readSource("packages/ui/src/settings/SkillsSection.tsx");
    expect(source).toContain("<PluginInstallEmptyState");
  });

  it("keeps the automations empty state aligned with the Figma card surface", () => {
    const source = readSource(
      "packages/ui/src/settings/AutomationsSection.tsx",
    );

    expect(source).toContain("border-card-border bg-background");
    expect(source).not.toContain(
      'data-automations-empty-state\n                  className="flex h-[226px] w-full items-center justify-center rounded-2xl border border-dashed',
    );
  });

  it("keeps the local usage empty state in the shared panel", () => {
    const source = readSource(
      "packages/ui/src/settings/usage-stats/AppUsageSection.tsx",
    );

    expect(source).toContain('id: "settings.usage.emptyTitle"');
    expect(source).toContain('id: "settings.usage.emptyDescription"');
  });
});
