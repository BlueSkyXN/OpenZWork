import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  createDefaultSystemPromptSettings,
  createSystemPromptReplacement,
  exportSystemPromptProfile,
  mergeSystemPromptProfile,
  parseSystemPromptProfile,
  type SystemPromptCatalog,
  type SystemPromptProfile,
  type SystemPromptSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { PromptChanges } from "./PromptDiff.js";
import { usePromptProfileFiles } from "./hooks/usePromptProfileFiles.js";

type Action = "import" | "export" | "reset" | "fromDefault" | "fromCurrent";
export function promptEditorError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const issue = error.issues[0] as { path?: unknown[]; message?: string } | undefined;
    if (issue) return `${issue.path?.join(".") || "settings"}: ${issue.message ?? "Invalid value"}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function PromptProfileToolbar({
  draft,
  catalog,
  disabled,
  onApply,
  onPreview,
}: {
  draft: SystemPromptSettings;
  catalog: SystemPromptCatalog;
  disabled: boolean;
  onApply: (value: SystemPromptSettings) => void;
  onPreview?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<SystemPromptProfile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("My profile");
  const [id, setId] = useState("");
  const operation = useRef(0);
  const files = usePromptProfileFiles();
  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );
  const close = () => {
    operation.current += 1;
    setAction(null);
    setBusy(false);
  };
  const open = (next: Action) => {
    operation.current += 1;
    setAction(next);
    setProfile(null);
    setError("");
    setText("");
    setBusy(false);
    if (next === "export") {
      setId(nanoid());
      setName(t("profileNameDefault"));
    }
  };
  const candidate = useMemo(() => {
    try {
      let value: SystemPromptSettings | undefined;
      if (action === "import" && profile) value = mergeSystemPromptProfile(draft, profile, catalog);
      if (action === "reset") value = createDefaultSystemPromptSettings();
      if (action === "fromDefault")
        value = {
          ...draft,
          mode: "replace",
          replacement: createSystemPromptReplacement(createDefaultSystemPromptSettings(), catalog)
            .replacement,
        };
      if (action === "fromCurrent") value = createSystemPromptReplacement(draft, catalog);
      return { value, error: "" };
    } catch (caught) {
      return { value: undefined, error: promptEditorError(caught) };
    }
  }, [action, catalog, draft, profile]);
  const exported = useMemo(() => {
    if (action !== "export") return { text: "", error: "" };
    try {
      return {
        text: JSON.stringify(exportSystemPromptProfile(draft, { id, name }), null, 2),
        error: "",
      };
    } catch (caught) {
      return { text: "", error: promptEditorError(caught) };
    }
  }, [action, draft, id, name]);
  const readFile = async () => {
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = await files.read();
      if (generation === operation.current && result !== null) {
        setText(result);
        setProfile(null);
      }
    } catch (caught) {
      if (generation === operation.current) setError(promptEditorError(caught));
    } finally {
      if (generation === operation.current) setBusy(false);
    }
  };
  const exportFile = async () => {
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    try {
      await files.save(exported.text);
    } catch (caught) {
      if (generation === operation.current) setError(promptEditorError(caught));
    } finally {
      if (generation === operation.current) setBusy(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          data-testid="system-prompt-open-preview"
          disabled={!onPreview}
          onClick={onPreview}
        >
          {t("fullPreview")}
        </Button>
        <Button
          variant="outline"
          data-testid="system-prompt-import"
          disabled={disabled}
          onClick={() => open("import")}
        >
          {t("import")}
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => open("export")}>
          {t("export")}
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={() => open("reset")}>
          {t("reset")}
        </Button>
        {draft.mode === "replace" ? (
          <>
            <Button variant="outline" disabled={disabled} onClick={() => open("fromDefault")}>
              {t("fromDefault")}
            </Button>
            <Button variant="outline" disabled={disabled} onClick={() => open("fromCurrent")}>
              {t("fromCurrent")}
            </Button>
          </>
        ) : null}
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{action ? t(action) : ""}</DialogTitle>
            <DialogDescription>
              {t(action === "export" ? "exportHint" : "applyHint")}
            </DialogDescription>
          </DialogHeader>
          {action === "import" ? (
            <div className="space-y-3">
              {files.canReadFile ? (
                <Button
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void readFile()}
                >
                  {t("chooseFile")}
                </Button>
              ) : null}
              <label className="block text-ui-base" htmlFor="prompt-profile-json">
                {t("pasteJson")}
              </label>
              <SettingsFormTextarea
                id="prompt-profile-json"
                data-testid="system-prompt-profile-json"
                value={text}
                disabled={busy || disabled}
                className="min-h-48 font-mono text-mobile-input-safe md:text-ui-base"
                onChange={(event) => {
                  setText(event.target.value);
                  setProfile(null);
                  setError("");
                }}
              />
              <Button
                data-testid="system-prompt-profile-preview"
                disabled={busy || disabled || !text.trim()}
                onClick={() => {
                  try {
                    setProfile(parseSystemPromptProfile(text));
                    setError("");
                  } catch (caught) {
                    setError(promptEditorError(caught));
                  }
                }}
              >
                {t("review")}
              </Button>
              {profile ? <p className="text-ui-base font-medium">{profile.name}</p> : null}
            </div>
          ) : null}
          {action === "export" ? (
            <div className="space-y-3">
              <label htmlFor="prompt-profile-name">{t("profileName")}</label>
              <Input
                id="prompt-profile-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <SettingsFormTextarea
                aria-label={t("export")}
                readOnly
                value={exported.text}
                className="min-h-64 font-mono text-mobile-input-safe md:text-ui-base"
              />
              <div className="flex gap-2">
                <Button disabled={busy || !exported.text} onClick={() => void exportFile()}>
                  {t("download")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!exported.text}
                  onClick={() => {
                    setError("");
                    if (!navigator.clipboard) {
                      setError(t("copyError"));
                      return;
                    }
                    void navigator.clipboard
                      .writeText(exported.text)
                      .catch(() => setError(t("copyError")));
                  }}
                >
                  {t("copy")}
                </Button>
              </div>
            </div>
          ) : null}
          {error || candidate.error || exported.error ? (
            <p role="alert" className="text-ui-base text-destructive">
              {error || candidate.error || exported.error}
            </p>
          ) : null}
          {action === "fromDefault" || action === "fromCurrent" ? (
            <p role="alert" className="text-ui-sm text-warning">
              {t("conversionWarning")}
            </p>
          ) : null}
          {candidate.value ? (
            <PromptChanges before={draft} after={candidate.value} catalog={catalog} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {t("cancel")}
            </Button>
            {action !== "export" ? (
              <Button
                data-testid="system-prompt-profile-apply"
                disabled={disabled || busy || !candidate.value}
                onClick={() => {
                  if (candidate.value) {
                    onApply(candidate.value);
                    close();
                  }
                }}
              >
                {t("apply")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
