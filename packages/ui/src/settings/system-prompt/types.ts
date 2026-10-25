import type { SystemPromptCatalog, SystemPromptSettings } from "@zcode/shared";
export interface SystemPromptEditorProps {
  catalog: SystemPromptCatalog;
  settings: SystemPromptSettings | null;
  onSave(
    settings: SystemPromptSettings,
    expected: SystemPromptSettings | null,
  ): Promise<SystemPromptSettings>;
}
