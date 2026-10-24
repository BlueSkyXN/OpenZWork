import { useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  createDefaultSystemPromptSettings,
  resolveSystemPromptSection,
  systemPromptSettingsSchema,
  type SystemPromptSectionId,
  type SystemPromptSectionOverride,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SystemPromptEditorProps } from "./types.js";
import { useSystemPromptSettings } from "./hooks/useSystemPromptSettings.js";

export function SystemPromptSettingsSection() {
  const state = useSystemPromptSettings();
  const { intl } = useZCodeIntl();
  if (state.error)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "settings.systemPrompt.loadError" })}
        </p>
        <Button variant="outline" onClick={state.retry}>
          {intl.formatMessage({ id: "settings.systemPrompt.retry" })}
        </Button>
      </div>
    );
  if (state.loading || !state.catalog)
    return (
      <p role="status" className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.systemPrompt.loading" })}
      </p>
    );
  return (
    <SystemPromptEditor catalog={state.catalog} settings={state.settings} onSave={state.save} />
  );
}

export function SystemPromptEditor({ catalog, settings, onSave }: SystemPromptEditorProps) {
  const { intl } = useZCodeIntl();
  const t = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: "settings.systemPrompt." + key }, values);
  const [baseline, setBaseline] = useState(settings);
  const [draft, setDraft] = useState(() => settings ?? createDefaultSystemPromptSettings());
  const [selected, setSelected] = useState<SystemPromptSectionId | "custom">("role");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState("");
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline ?? createDefaultSystemPromptSettings());
  const conflict = JSON.stringify(settings) !== JSON.stringify(baseline);
  const lastIncomingSettings = useRef(JSON.stringify(settings));
  useEffect(() => {
    const incoming = JSON.stringify(settings);
    if (incoming === lastIncomingSettings.current) return;
    lastIncomingSettings.current = incoming;
    if (!dirty && !saving) {
      setBaseline(settings);
      setDraft(settings ?? createDefaultSystemPromptSettings());
    }
  }, [settings, dirty, saving]);

  const entry = catalog.sections.find((section) => section.id === selected);
  const override = entry ? draft.sections[entry.id] : undefined;
  const mode = override?.mode ?? "default";
  const defaultsChanged =
    override?.baseContent !== undefined && override.baseContent !== entry?.content;
  const preview = entry ? resolveSystemPromptSection(draft, entry.id, entry.content) : "";
  const changeChapter = (patch: Partial<SystemPromptSectionOverride>) => {
    if (!entry) return;
    setSaveState("idle");
    setDraft((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [entry.id]: {
          mode: "default",
          content: "",
          baseContent: entry.content,
          ...current.sections[entry.id],
          ...patch,
        },
      },
    }));
  };
  const discard = () => {
    setBaseline(settings);
    setDraft(settings ?? createDefaultSystemPromptSettings());
    setSaveState("idle");
    setSaveError("");
  };
  const save = async () => {
    const parsed = systemPromptSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setSaveError(t("invalid"));
      setSaveState("failed");
      return;
    }
    setSaving(true);
    setSaveState("idle");
    try {
      const committed = await onSave(parsed.data, baseline);
      setBaseline(committed);
      setDraft(committed);
      setSaveState("saved");
      setSaveError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(
        message.includes("settings.systemPrompt.conflict") ? t("conflict") : t("saveError"),
      );
      setSaveState("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="system-prompt-editor" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 rounded-lg border border-border p-1"
          aria-label={t("editingMode")}
        >
          {(["sections", "replace"] as const).map((value) => (
            <Button
              key={value}
              variant={draft.mode === value ? "secondary" : "ghost"}
              aria-pressed={draft.mode === value}
              data-testid={"system-prompt-mode-" + value}
              disabled={saving}
              onClick={() => {
                setDraft((current) => ({ ...current, mode: value }));
                setSaveState("idle");
              }}
            >
              {t("mode." + value)}
            </Button>
          ))}
        </div>
        <span className="text-ui-sm text-foreground-subtle">
          {t(dirty ? "unsaved" : "savedConfig")}
        </span>
      </div>
      <p className="text-ui-base text-foreground-subtle">{t("scope")}</p>
      {conflict && dirty && !saving ? (
        <p role="alert" className="text-ui-base text-warning">
          {t("conflict")}
        </p>
      ) : null}
      {draft.mode === "replace" ? (
        <div className="space-y-3">
          <p className="text-ui-base text-foreground-subtle">{t("replaceHint")}</p>
          <label htmlFor="system-prompt-replacement" className="block text-ui-base font-medium">
            {t("replacement")}
          </label>
          <SettingsFormTextarea
            id="system-prompt-replacement"
            data-testid="system-prompt-replacement"
            value={draft.replacement}
            maxLength={64_000}
            disabled={saving}
            className="min-h-80 font-mono text-mobile-input-safe md:text-ui-base"
            onChange={(event) => {
              const replacement = event.target.value;
              setDraft((current) => ({ ...current, replacement }));
              setSaveState("idle");
            }}
          />
          <p className="text-ui-sm text-foreground-subtle">
            {t("chars", { count: draft.replacement.length })}
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label={t("chapters")}
            className="flex max-h-52 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1 md:max-h-none md:self-start"
          >
            {catalog.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                disabled={saving}
                data-testid={"system-prompt-chapter-" + section.id}
                aria-current={selected === section.id ? "true" : undefined}
                className={
                  "flex min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-ui-base hover:bg-hover " +
                  (selected === section.id ? "bg-selected font-medium" : "")
                }
                onClick={() => setSelected(section.id)}
              >
                <span>{t("chapter." + section.id)}</span>
                {draft.sections[section.id] && draft.sections[section.id]?.mode !== "default" ? (
                  <span className="text-ui-xs text-foreground-subtle">{t("modified")}</span>
                ) : null}
              </button>
            ))}
            <button
              type="button"
              data-testid="system-prompt-chapter-custom"
              disabled={saving}
              aria-current={selected === "custom" ? "true" : undefined}
              className={
                "mt-1 flex min-h-8 items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-ui-base hover:bg-hover " +
                (selected === "custom" ? "bg-selected font-medium" : "")
              }
              onClick={() => setSelected("custom")}
            >
              <Plus className="size-4" />
              {t("customChapters")}
            </button>
          </nav>
          <div className="min-w-0 space-y-4">
            {selected === "custom" ? (
              <div className="space-y-4">
                <h3 className="text-ui-lg font-medium">{t("customChapters")}</h3>
                <p className="text-ui-base text-foreground-subtle">{t("customHint")}</p>
                {draft.customSections.map((custom, index) => (
                  <div key={custom.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={t("customTitle", { index: index + 1 })}
                        value={custom.title}
                        disabled={saving}
                        maxLength={80}
                        className="text-mobile-input-safe md:text-ui-base"
                        onChange={(event) => {
                          const title = event.target.value;
                          setDraft((current) => ({
                            ...current,
                            customSections: current.customSections.map((item) =>
                              item.id === custom.id ? { ...item, title } : item,
                            ),
                          }));
                        }}
                      />
                      <Button
                        variant="ghost"
                        disabled={saving}
                        aria-label={t("removeChapter")}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            customSections: current.customSections.filter(
                              (item) => item.id !== custom.id,
                            ),
                          }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <SettingsFormTextarea
                      aria-label={t("customBody", { index: index + 1 })}
                      value={custom.content}
                      disabled={saving}
                      maxLength={32_000}
                      className="min-h-40 font-mono text-mobile-input-safe md:text-ui-base"
                      onChange={(event) => {
                        const content = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          customSections: current.customSections.map((item) =>
                            item.id === custom.id ? { ...item, content } : item,
                          ),
                        }));
                      }}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={saving || draft.customSections.length >= 12}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      customSections: [
                        ...current.customSections,
                        { id: crypto.randomUUID(), title: t("newChapter"), content: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  {t("addChapter")}
                </Button>
              </div>
            ) : entry ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-ui-lg font-medium">{t("chapter." + entry.id)}</h3>
                  <Button
                    variant="ghost"
                    disabled={saving || !override}
                    data-testid="system-prompt-reset-chapter"
                    onClick={() =>
                      setDraft((current) => {
                        const sections = { ...current.sections };
                        delete sections[entry.id];
                        return { ...current, sections };
                      })
                    }
                  >
                    <RotateCcw className="size-4" />
                    {t("resetChapter")}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={mode}
                    disabled={saving}
                    onValueChange={(value) => {
                      const nextMode = value as SystemPromptSectionOverride["mode"];
                      changeChapter({
                        mode: nextMode,
                        ...(nextMode === "replace" && !override?.content
                          ? { content: entry.content }
                          : {}),
                      });
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("chapterMode")}
                      data-testid="system-prompt-chapter-mode"
                      className="w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(entry.generated
                        ? ["default", "disabled"]
                        : ["default", "append", "replace", "disabled"]
                      ).map((value) => (
                        <SelectItem key={value} value={value}>
                          {t("chapterMode." + value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-ui-sm text-foreground-subtle">
                    {t(entry.injectionTarget === "system" ? "systemLayer" : "userContextLayer")}
                  </span>
                </div>
                {entry.generated ? (
                  <p className="text-ui-base text-foreground-subtle">
                    {t("generated." + entry.id)}
                  </p>
                ) : (
                  <>
                    {["memory", "desktop_context", "session_guidance", "output_style"].includes(
                      entry.id,
                    ) ? (
                      <p className="text-ui-sm text-foreground-subtle">
                        {t("condition." + entry.id, {
                          variable:
                            entry.id === "memory" ? "{{memoryRoot}}" : "{{genUiOutputDirectory}}",
                        })}
                      </p>
                    ) : null}
                    {mode === "append" || mode === "replace" ? (
                      <div className="space-y-2">
                        <label
                          htmlFor="system-prompt-chapter-content"
                          className="block text-ui-base font-medium"
                        >
                          {t("customContent")}
                        </label>
                        <SettingsFormTextarea
                          id="system-prompt-chapter-content"
                          data-testid="system-prompt-chapter-content"
                          value={override?.content ?? ""}
                          maxLength={32_000}
                          disabled={saving}
                          className="min-h-64 font-mono text-mobile-input-safe md:text-ui-base"
                          onChange={(event) => changeChapter({ content: event.target.value })}
                        />
                      </div>
                    ) : null}
                    <details open={mode === "default"} className="rounded-lg border border-border">
                      <summary className="cursor-pointer px-3 py-2 text-ui-base font-medium">
                        {t("defaultContent")}
                      </summary>
                      <pre
                        data-testid="system-prompt-default"
                        className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-ui-sm leading-relaxed"
                      >
                        {entry.content || t("emptyDefault")}
                      </pre>
                    </details>
                    {defaultsChanged ? (
                      <details className="rounded-lg border border-border">
                        <summary className="cursor-pointer px-3 py-2 text-ui-base text-warning">
                          {t("defaultsChanged")}
                        </summary>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-ui-sm">
                          {override?.baseContent}
                        </pre>
                      </details>
                    ) : null}
                  </>
                )}
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h4 className="text-ui-base font-medium">{t("preview")}</h4>
                    {!entry.generated ? (
                      <span className="text-ui-sm text-foreground-subtle">
                        {t("chars", { count: preview.length })}
                      </span>
                    ) : null}
                  </div>
                  <pre
                    data-testid="system-prompt-preview"
                    className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-3 font-mono text-ui-sm leading-relaxed"
                  >
                    {mode === "disabled"
                      ? t("notInjected")
                      : entry.generated
                        ? t("runtimeGenerated")
                        : preview || t("emptyDefault")}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
        <Button
          disabled={saving || !dirty || conflict}
          data-testid="system-prompt-save"
          onClick={() => void save()}
        >
          {t(saving ? "saving" : "save")}
        </Button>
        <Button variant="outline" disabled={saving || (!dirty && !conflict)} onClick={discard}>
          {t(conflict ? "reload" : "discard")}
        </Button>
        {saveState === "saved" && !dirty ? (
          <span role="status" className="text-ui-sm text-success">
            {t("saved")}
          </span>
        ) : null}
        {saveState === "failed" ? (
          <span role="alert" className="text-ui-sm text-destructive">
            {saveError}
          </span>
        ) : null}
      </div>
    </section>
  );
}
