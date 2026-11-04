import { useMemo, useState } from "react";
import {
  mergeSystemPromptProfile,
  type SystemPromptCatalog,
  type SystemPromptSectionId,
  type SystemPromptSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { PromptChanges } from "./PromptDiff.js";
import { promptEditorError } from "./PromptProfileToolbar.js";

const TEMPLATES = [
  { id: "concise", section: "communication" },
  { id: "explain", section: "communication" },
  { id: "verify", section: "execution" },
] as const;

export function PromptChapterTemplates({
  sectionId,
  draft,
  catalog,
  disabled,
  onApply,
}: {
  sectionId: SystemPromptSectionId;
  draft: SystemPromptSettings;
  catalog: SystemPromptCatalog;
  disabled: boolean;
  onApply: (settings: SystemPromptSettings) => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [selected, setSelected] = useState<string | null>(null);
  const candidate = useMemo(() => {
    if (!selected) return { value: undefined, error: "" };
    try {
      return {
        value: mergeSystemPromptProfile(
          draft,
          {
            schema: "openzwork.system-prompt-profile",
            schemaVersion: 1,
            id: selected,
            name: selected,
            settings: {
              ...draft,
              sections: {
                [sectionId]: {
                  mode: "append",
                  content: intl.formatMessage({
                    id: `settings.systemPrompt.editor.template.${selected}.body`,
                  }),
                },
              },
              customSections: [],
            },
          },
          catalog,
        ),
        error: "",
      };
    } catch (error) {
      return { value: undefined, error: promptEditorError(error) };
    }
  }, [catalog, draft, intl, sectionId, selected]);
  const choices = TEMPLATES.filter((item) => item.section === sectionId);
  if (!choices.length) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-sm text-foreground-subtle">{t("chapterTemplates")}</span>
        {choices.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid={`system-prompt-template-${item.id}`}
            onClick={() => setSelected(item.id)}
          >
            {t(`template.${item.id}.name`)}
          </Button>
        ))}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("chapterTemplates")}</DialogTitle>
            <DialogDescription>{t("applyHint")}</DialogDescription>
          </DialogHeader>
          {candidate.error ? (
            <p role="alert" className="text-destructive">
              {candidate.error}
            </p>
          ) : candidate.value ? (
            <PromptChanges before={draft} after={candidate.value} catalog={catalog} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={disabled || !candidate.value}
              onClick={() => {
                if (candidate.value) {
                  onApply(candidate.value);
                  setSelected(null);
                }
              }}
            >
              {t("apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
