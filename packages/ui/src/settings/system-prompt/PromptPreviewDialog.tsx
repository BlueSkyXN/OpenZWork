import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
  systemPromptSettingsSchema,
  systemPromptDocumentText,
  type SystemPromptPreviewDocument,
  type SystemPromptPreviewParams,
  type SystemPromptPreviewResult,
  type SystemPromptSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { PromptChanges, PromptTextDiff } from "./PromptDiff.js";
import { promptEditorError } from "./PromptProfileToolbar.js";
import { usePromptObservation, usePromptSessionTargets } from "./hooks/usePromptObservation.js";

export function PromptDocumentView({
  after,
  before,
}: {
  after: SystemPromptPreviewDocument;
  before?: SystemPromptPreviewDocument;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [search, setSearch] = useState("");
  const [copyError, setCopyError] = useState(false);
  const blocks = useMemo(() => {
    const ids = [...new Set([...after.blocks, ...(before?.blocks ?? [])].map((block) => block.id))];
    return ids
      .map((id) => ({
        id,
        after: after.blocks.find((x) => x.id === id),
        before: before?.blocks.find((x) => x.id === id),
      }))
      .filter(
        (pair) =>
          !search ||
          `${pair.after?.title ?? pair.before?.title}\n${pair.after?.content}\n${pair.before?.content}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
      );
  }, [after, before, search]);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 text-mobile-input-safe md:text-ui-base"
        />
        <Button
          variant="outline"
          onClick={() => {
            setCopyError(false);
            if (!navigator.clipboard) {
              setCopyError(true);
              return;
            }
            void navigator.clipboard
              .writeText(systemPromptDocumentText(after))
              .catch(() => setCopyError(true));
          }}
        >
          {t("copy")}
        </Button>
      </div>
      {copyError ? (
        <p role="alert" className="text-ui-sm text-warning">
          {t("copyError")}
        </p>
      ) : null}
      {(["system", "meta_user"] as const).map((target) => (
        <section key={target} className="space-y-3">
          <h3 className="text-ui-lg font-medium">
            {t(target === "system" ? "systemMessages" : "attachments")}
          </h3>
          {blocks
            .filter((pair) => (pair.after ?? pair.before)?.target === target)
            .map((pair) => (
              <details
                key={pair.id}
                open={!before || pair.before?.content !== pair.after?.content}
                className="min-w-0 rounded-lg border border-border p-3"
              >
                <summary className="cursor-pointer break-words text-ui-base font-medium">
                  {pair.after?.title ?? pair.before?.title}
                </summary>
                {before ? (
                  <PromptTextDiff
                    before={pair.before?.content ?? ""}
                    after={pair.after?.content ?? ""}
                  />
                ) : (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm leading-relaxed">
                    {pair.after?.content}
                  </pre>
                )}
              </details>
            ))}
        </section>
      ))}
    </div>
  );
}

function ActualPromptView({ draft }: { draft: SystemPromptSettings }) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const targets = usePromptSessionTargets();
  const [selected, setSelected] = useState("");
  const target = targets.find((item) => item.key === selected);
  const observation = usePromptObservation(target);
  const data = observation.data;
  const validDraft = systemPromptSettingsSchema.safeParse(draft).success;
  const comparisonCurrent = observation.comparedDraft === JSON.stringify(draft);
  return (
    <div className="space-y-4" data-testid="system-prompt-actual">
      <label className="block text-ui-base">{t("chooseSession")}</label>
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger aria-label={t("chooseSession")} className="w-full">
          <SelectValue placeholder={t("chooseSession")} />
        </SelectTrigger>
        <SelectContent>
          {targets.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!targets.length ? <p className="text-ui-sm">{t("noSessions")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!target || observation.loading} onClick={() => void observation.read()}>
          {t("refreshActual")}
        </Button>
        {data?.status === "available" ? (
          <Button
            variant="outline"
            disabled={!validDraft || observation.loading}
            onClick={() => void observation.read(draft, data.snapshotId)}
          >
            {t("compareDraft")}
          </Button>
        ) : null}
      </div>
      {observation.loading ? <p role="status">{t("loading")}</p> : null}
      {observation.error ? (
        <p role="alert" className="text-ui-base text-destructive">
          {t(observation.error)}
        </p>
      ) : null}
      {data?.status === "unavailable" ? <p role="status">{t(data.reason)}</p> : null}
      {data?.status === "available" ? (
        <>
          <p className="break-words text-ui-sm text-foreground-subtle">
            {data.model} · {new Date(data.capturedAt).toLocaleString()} · {t("requestBoundary")}
          </p>
          {data.comparisonUnavailable ? (
            <p role="status" className="text-ui-sm text-warning">
              {t(data.comparisonUnavailable)}
            </p>
          ) : null}
          {data.comparison && !comparisonCurrent ? (
            <p role="status" className="text-ui-sm text-warning">
              {t("comparisonStale")}
            </p>
          ) : null}
          <PromptDocumentView
            after={comparisonCurrent && data.comparison ? data.comparison : data.actual}
            before={comparisonCurrent && data.comparison ? data.actual : undefined}
          />
        </>
      ) : null}
    </div>
  );
}

export function PromptPreviewDialog({
  draft,
  baseline,
  preview,
  onClose,
}: {
  draft: SystemPromptSettings;
  baseline: SystemPromptSettings;
  preview: (params: SystemPromptPreviewParams) => Promise<SystemPromptPreviewResult>;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [tab, setTab] = useState<"draft" | "actual">("draft");
  const [diff, setDiff] = useState(false);
  const [scenario, setScenario] = useState(DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO);
  const deferredDraft = useDeferredValue(draft);
  const key = JSON.stringify([deferredDraft, baseline, scenario]);
  const [state, setState] = useState<{
    key: string;
    result?: SystemPromptPreviewResult;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (tab !== "draft") return;
    let active = true;
    const timer = setTimeout(() => {
      const parsed = systemPromptSettingsSchema.safeParse(deferredDraft);
      if (!parsed.success) {
        setState({ key, error: promptEditorError(parsed.error) });
        return;
      }
      void preview({ settings: parsed.data, baseline, scenario }).then(
        (result) => {
          if (active) setState({ key, result });
        },
        () => {
          if (active) setState({ key, error: t("previewError") });
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // key 覆盖所有序列化输入；active 拒收迟到结果，延迟仅合并连续输入请求。
  }, [key, preview, tab, baseline, deferredDraft, scenario, intl]);
  const current = state?.key === key && deferredDraft === draft ? state : null;
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] min-h-0 flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("fullPreview")}</DialogTitle>
          <DialogDescription>
            {tab === "draft" ? t("exampleSource") : t("actualHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={tab === "draft" ? "secondary" : "ghost"}
            aria-pressed={tab === "draft"}
            onClick={() => setTab("draft")}
          >
            {t("draft")}
          </Button>
          <Button
            data-testid="system-prompt-actual-tab"
            variant={tab === "actual" ? "secondary" : "ghost"}
            aria-pressed={tab === "actual"}
            onClick={() => setTab("actual")}
          >
            {t("actual")}
          </Button>
        </div>
        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto">
          {tab === "actual" ? (
            <ActualPromptView draft={draft} />
          ) : (
            <>
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-ui-base">{t("conditions")}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="prompt-surface">{t("desktop")}</label>
                    <Switch
                      id="prompt-surface"
                      checked={scenario.surface === "desktop"}
                      onCheckedChange={(checked) =>
                        setScenario((value) => ({
                          ...value,
                          surface: checked ? "desktop" : "terminal",
                        }))
                      }
                    />
                  </div>
                  {(["memory", "skills", "outputStyle", "git", "visualization"] as const).map(
                    (name) => (
                      <div key={name} className="flex items-center justify-between gap-3">
                        <label htmlFor={`prompt-condition-${name}`}>{t(`condition.${name}`)}</label>
                        <Switch
                          id={`prompt-condition-${name}`}
                          checked={scenario[name]}
                          onCheckedChange={(checked) =>
                            setScenario((value) => ({ ...value, [name]: checked }))
                          }
                        />
                      </div>
                    ),
                  )}
                </div>
              </details>
              <div className="flex gap-2">
                <Button
                  variant={!diff ? "secondary" : "ghost"}
                  aria-pressed={!diff}
                  onClick={() => setDiff(false)}
                >
                  {t("content")}
                </Button>
                <Button
                  data-testid="system-prompt-full-diff"
                  variant={diff ? "secondary" : "ghost"}
                  aria-pressed={diff}
                  onClick={() => setDiff(true)}
                >
                  {t("savedDiff")}
                </Button>
              </div>
              {diff ? (
                <details open>
                  <summary>{t("configurationChanges")}</summary>
                  <PromptChanges before={baseline} after={draft} summaryOnly />
                </details>
              ) : null}
              {!current ? (
                <p role="status">{t("loading")}</p>
              ) : current.error ? (
                <p role="alert" className="text-ui-base text-destructive">
                  {current.error}
                </p>
              ) : current.result ? (
                <div data-testid="system-prompt-full-content">
                  <PromptDocumentView
                    after={current.result.after}
                    before={diff ? current.result.before : undefined}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
