import { Plus } from "lucide-react";
import type {
  SystemPromptCatalog,
  SystemPromptSectionId,
  SystemPromptSettings,
} from "@zcode/shared";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PromptChapterNavigation({
  catalog,
  draft,
  selected,
  disabled,
  onSelect,
}: {
  catalog: SystemPromptCatalog;
  draft: SystemPromptSettings;
  selected: SystemPromptSectionId | "custom";
  disabled: boolean;
  onSelect: (id: SystemPromptSectionId | "custom") => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.${key}` });
  const groups = [
    { label: "editor.ruleChapters", sections: catalog.sections.filter((item) => !item.generated) },
    {
      label: "editor.generatedChapters",
      sections: catalog.sections.filter((item) => item.generated),
    },
  ];
  return (
    <>
      <div className="border-b border-border p-3 md:hidden">
        <Select
          value={selected}
          disabled={disabled}
          onValueChange={(value) => onSelect(value as typeof selected)}
        >
          <SelectTrigger
            aria-label={t("chapters")}
            data-testid="system-prompt-chapter-select"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{t(group.label)}</SelectLabel>
                {group.sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {t(`chapter.${section.id}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            <SelectItem value="custom">{t("customChapters")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <nav
        aria-label={t("chapters")}
        data-testid="system-prompt-chapter-list"
        className="hidden max-h-128 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background p-2 md:flex md:self-start"
      >
        {groups.map((group) => (
          <div key={group.label} className="shrink-0 space-y-0.5">
            <p className="px-2 py-2 text-ui-sm font-medium text-foreground-subtle">
              {t(group.label)}
            </p>
            {group.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                disabled={disabled}
                data-testid={`system-prompt-chapter-${section.id}`}
                aria-current={selected === section.id ? "true" : undefined}
                onClick={() => onSelect(section.id)}
                className={`flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-ui-base hover:bg-hover ${selected === section.id ? "bg-selected font-medium" : ""}`}
              >
                <span className="min-w-0 flex-1 break-words">{t(`chapter.${section.id}`)}</span>
                {draft.sections[section.id] && draft.sections[section.id]?.mode !== "default" ? (
                  <span className="shrink-0 text-ui-xs text-foreground-subtle">
                    {t("modified")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          data-testid="system-prompt-chapter-custom"
          aria-current={selected === "custom" ? "true" : undefined}
          onClick={() => onSelect("custom")}
          className={`mt-1 flex min-h-8 shrink-0 items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-ui-base hover:bg-hover ${selected === "custom" ? "bg-selected font-medium" : ""}`}
        >
          <Plus className="size-4" />
          {t("customChapters")}
        </button>
      </nav>
    </>
  );
}
