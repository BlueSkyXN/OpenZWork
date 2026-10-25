import type {
  SystemPromptCatalog,
  SystemPromptSectionId,
  SystemPromptSettings,
} from "@zcode/shared";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SystemPromptContextSwitches({
  catalog,
  settings,
  disabled,
  onChange,
}: {
  catalog: SystemPromptCatalog;
  settings: SystemPromptSettings;
  disabled: boolean;
  onChange: (id: SystemPromptSectionId, enabled: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: "settings.systemPrompt." + key });
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-ui-base font-medium">{t("dynamicContext")}</h3>
      {catalog.sections
        .filter((section) => section.generated)
        .map((section) => (
          <div key={section.id} className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <label htmlFor={"prompt-context-" + section.id} className="text-ui-base">
                {t("chapter." + section.id)}
              </label>
              <p className="text-ui-sm text-foreground-subtle">{t("generated." + section.id)}</p>
            </div>
            <Switch
              id={"prompt-context-" + section.id}
              data-testid={"system-prompt-context-" + section.id}
              disabled={disabled}
              checked={settings.sections[section.id]?.mode !== "disabled"}
              onCheckedChange={(enabled) => onChange(section.id, enabled)}
            />
          </div>
        ))}
    </div>
  );
}
