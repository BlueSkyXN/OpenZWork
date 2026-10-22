// 同步修复：管理模型仍是保留能力，独立于已取消的购买入口。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("model provider settings navigation", () => {
  it("opens no-model Set action directly to model provider settings", () => {
    const composerToolbarSource = readSource("packages/ui/src/v4/composer/V4ComposerToolbar.tsx");

    expect(composerToolbarSource).toContain('setPendingSettingsSectionIntent("modelProvider")');
    expect(composerToolbarSource).toContain("handleOpenModelProviderSettings");
    expect(composerToolbarSource).toContain("onManageModels={handleOpenModelProviderSettings}");
    expect(composerToolbarSource).not.toContain("onManageModels={openSettingsTab}");
  });
});
