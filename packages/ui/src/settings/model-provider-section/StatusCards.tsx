// Modified for the private fork, 2026-09-21: Coding Plan status panel machinery was
// removed with the account services; only the generic loading/placeholder cards remain.
import { Loader2Icon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ModelProviderLoadingCard({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{loadingLabel}</span>
      </div>
    </div>
  );
}

export function PresetProviderPlaceholderCard({
  displayName,
  messageId = "settings.modelProvider.presetEmpty",
}: {
  displayName: string;
  messageId?: string;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="bg-background/50 rounded-2xl p-3">
      <div className="text-ui-lg font-semibold text-foreground">{displayName}</div>
      <div className="mt-1 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: messageId })}
      </div>
    </div>
  );
}
