import type {
  SystemPromptCatalog,
  SystemPromptSettings,
  SystemPromptPreviewParams,
  SystemPromptPreviewResult,
} from "@zcode/shared";
export interface SystemPromptEditorProps {
  catalog: SystemPromptCatalog;
  settings: SystemPromptSettings | null;
  preview?: (params: SystemPromptPreviewParams) => Promise<SystemPromptPreviewResult>;
  onSave(
    settings: SystemPromptSettings,
    expected: SystemPromptSettings | null,
  ): Promise<SystemPromptSettings>;
}
