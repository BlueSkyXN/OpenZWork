import { useRef, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderModelDiscovery } from "@/hooks/useProviderModelDiscovery.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.js";
import type { ProviderModelDiscoveryDialogProps } from "./contract.js";

/** 外层按 Provider/open 挂载；一次弹窗就是一份选择草稿。 */
export function ProviderModelDiscoveryDialog(props: ProviderModelDiscoveryDialogProps) {
  if (!props.open) return null;
  return <DiscoveryContents key={props.providerId} {...props} />;
}
function DiscoveryContents({
  providerId,
  providerName,
  models,
  open,
  onOpenChange,
  onAddModel,
  onConfigure,
}: ProviderModelDiscoveryDialogProps) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.modelProvider.discovery.${key}` });
  const query = useProviderModelDiscovery(providerId, open);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const existing = new Set([...models.map((model) => model.modelId), ...saved]);
  const candidates = query.result?.ok ? query.result.models : [];
  const selectedIds = [...selected].filter((id) => !existing.has(id));
  const commit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(new Set());
    const failures = new Set<string>();
    try {
      for (const modelId of selectedIds) {
        try {
          const resolution = await query.resolve(modelId);
          await onAddModel({
            kind: "candidate",
            modelId,
            builtin: false,
            personalConfig: {},
            config: resolution.effectiveConfig,
            inheritedConfig: resolution.inheritedConfig,
            useRecommendedConfig: true,
            hasPersonalConfig: false,
            executable: false,
            selectable: false,
          });
          setSaved((previous) => new Set([...previous, modelId]));
          setSelected((previous) => {
            const next = new Set(previous);
            next.delete(modelId);
            return next;
          });
        } catch {
          failures.add(modelId);
        }
      }
      setFailed(failures);
      if (!failures.size) onOpenChange(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!savingRef.current) onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-lg" data-testid="provider-model-discovery-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{providerName || providerId}</DialogDescription>
        </DialogHeader>
        {query.loading ? (
          <p role="status" className="text-ui-base">
            {t("loading")}
          </p>
        ) : null}
        {query.result && !query.result.ok ? (
          <div role="alert" className="space-y-2">
            <p className="text-ui-base text-destructive">{t(`error.${query.result.error}`)}</p>
            <Button variant="outline" onClick={query.refresh}>
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {query.result?.ok && !candidates.length ? (
          <p role="status" className="text-ui-base text-foreground-subtle">
            {t("empty")}
          </p>
        ) : null}
        {candidates.length ? (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {candidates.map((candidate) => {
              const added = existing.has(candidate.modelId);
              const incomplete = candidate.configComplete !== true;
              return (
                <div
                  key={candidate.modelId}
                  className="flex min-w-0 items-center justify-between gap-2 border-b border-border p-3 last:border-b-0"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-ui-base">
                    <Checkbox
                      disabled={added || incomplete || saving}
                      checked={!added && selected.has(candidate.modelId)}
                      onCheckedChange={(checked) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked === true) next.add(candidate.modelId);
                          else next.delete(candidate.modelId);
                          return next;
                        })
                      }
                      aria-label={candidate.modelId}
                    />
                    <span className="min-w-0 break-all">
                      <span>{candidate.modelId}</span>
                      <span className="block text-ui-sm text-foreground-subtle">
                        {added ? t("added") : incomplete ? t("incomplete") : t("ready")}
                      </span>
                      {failed.has(candidate.modelId) ? (
                        <span className="block text-ui-sm text-destructive">{t("saveFailed")}</span>
                      ) : null}
                    </span>
                  </label>
                  {!added && incomplete ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        onOpenChange(false);
                        onConfigure(candidate.modelId);
                      }}
                    >
                      {t("configure")}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {query.result?.ok && query.result.truncated ? (
          <p className="text-ui-sm text-foreground-subtle">{t("truncated")}</p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={saving || !selectedIds.length || query.loading}
            onClick={() => void commit()}
            data-testid="provider-model-discovery-add"
          >
            {saving
              ? t("saving")
              : intl.formatMessage(
                  { id: "settings.modelProvider.discovery.addSelected" },
                  { count: selectedIds.length },
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
