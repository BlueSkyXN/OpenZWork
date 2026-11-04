import { useEffect, useState } from "react";
import {
  createDefaultSystemPromptSettings,
  DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
  type SystemPromptPreviewParams,
  type SystemPromptPreviewResult,
  type SystemPromptSectionId,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PromptGeneratedDetails({
  id,
  enabled,
  preview,
}: {
  id: SystemPromptSectionId;
  enabled: boolean;
  preview?: (params: SystemPromptPreviewParams) => Promise<SystemPromptPreviewResult>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ id: string; text?: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!open || !preview) return;
    let current = true;
    void preview({
      settings: createDefaultSystemPromptSettings(),
      scenario: DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
    }).then(
      (result) => {
        const sources =
          id === "system_context"
            ? ["system_context", "session_context"]
            : id === "env_info"
              ? ["env_info", "model"]
              : [id];
        if (current)
          setState({
            id,
            text: result.after.blocks
              .filter((block) => sources.includes(block.source))
              .map((block) => block.content)
              .join("\n\n"),
          });
      },
      () => {
        if (current) setState({ id, error: true });
      },
    );
    return () => {
      current = false;
    };
  }, [id, open, preview]);
  return (
    <details
      data-testid={`system-prompt-generated-${id}`}
      className="rounded-lg border border-border p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-ui-sm font-medium">{t("expandExample")}</summary>
      <p className="my-2 text-ui-sm text-foreground-subtle">
        {t(enabled ? "exampleSource" : "disabledExample")}
      </p>
      {!preview || (state?.id === id && state.error) ? (
        <p role="alert">{t("previewError")}</p>
      ) : state?.id !== id ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm">
          {state.text || t("emptyContext")}
        </pre>
      )}
    </details>
  );
}
