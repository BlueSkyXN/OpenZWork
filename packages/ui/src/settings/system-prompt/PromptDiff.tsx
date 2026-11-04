import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import {
  GENERATED_SYSTEM_PROMPT_SECTIONS,
  resolveSystemPromptSection,
  SYSTEM_PROMPT_SECTION_IDS,
  type SystemPromptCatalog,
  type SystemPromptSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const Diff = lazy(() =>
  import("@/components/ui/diff-viewer.js").then((module) => ({ default: module.DiffViewer })),
);
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const readDark = () => document.documentElement.classList.contains("dark");
function subscribeWide(listener: () => void) {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const readWide = () => window.matchMedia("(min-width: 768px)").matches;

export function PromptTextDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.editor.${key}` });
  const [split, setSplit] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const dark = useSyncExternalStore(subscribeTheme, readDark, () => false);
  return (
    <div data-testid="system-prompt-text-diff" className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm">
        <span>
          {beforeLabel ?? t("before")} → {afterLabel ?? t("after")}
        </span>
        <Button
          className="hidden md:inline-flex"
          size="sm"
          variant="ghost"
          aria-pressed={split}
          onClick={() => setSplit((value) => !value)}
        >
          {split ? t("unified") : t("split")}
        </Button>
      </div>
      <div className="flex gap-4 text-ui-sm">
        <span className="text-foreground">
          <span aria-hidden className="font-bold text-diff-removed">
            −
          </span>{" "}
          {t("removed")}
        </span>
        <span className="text-foreground">
          <span aria-hidden className="font-bold text-diff-added">
            +
          </span>{" "}
          {t("added")}
        </span>
      </div>
      {before === after ? (
        <p className="text-ui-sm text-foreground-subtle">{t("noChanges")}</p>
      ) : (
        <Suspense fallback={<p role="status">{t("loading")}</p>}>
          <Diff
            oldFile={{ name: "before.md", contents: before }}
            newFile={{ name: "after.md", contents: after }}
            lightTheme="github-light"
            darkTheme="github-dark"
            themeType={dark ? "dark" : "light"}
            diffClassName="min-h-0"
            options={{
              diffStyle: split && wide ? "split" : "unified",
              diffIndicators: "classic",
              lineDiffType: "word-alt",
              overflow: "wrap",
            }}
            // 通用查看器的 h-full 会连同上方标签一起撑出对话框行，覆盖后续按钮。
            className="h-auto max-h-96 min-w-0 overflow-auto rounded-lg border border-border"
          />
        </Suspense>
      )}
    </div>
  );
}

export function PromptChanges({
  before,
  after,
  summaryOnly = false,
  catalog,
}: {
  before: SystemPromptSettings;
  after: SystemPromptSettings;
  summaryOnly?: boolean;
  catalog?: SystemPromptCatalog;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.${key}` });
  const changes = SYSTEM_PROMPT_SECTION_IDS.filter((id) => {
    const a = before.sections[id],
      b = after.sections[id];
    return (
      (a?.mode ?? "default") !== (b?.mode ?? "default") || (a?.content ?? "") !== (b?.content ?? "")
    );
  });
  const customIds = [
    ...new Set([...before.customSections, ...after.customSections].map((item) => item.id)),
  ];
  const customChanged = customIds.filter(
    (id) =>
      JSON.stringify(before.customSections.find((x) => x.id === id)) !==
      JSON.stringify(after.customSections.find((x) => x.id === id)),
  );
  const modeChanged = before.mode !== after.mode;
  const replacementChanged = before.replacement !== after.replacement;
  const orderChanged =
    before.customSections.map((x) => x.id).join(",") !==
    after.customSections.map((x) => x.id).join(",");
  const securityChanged =
    changes.includes("security") &&
    ["replace", "disabled"].includes(after.sections.security?.mode ?? "default");
  return (
    <div data-testid="system-prompt-changes" className="space-y-3">
      {(modeChanged || securityChanged) && (
        <p role="alert" className="text-ui-sm text-warning">
          {t(
            modeChanged && after.mode === "replace"
              ? "editor.wholeWarning"
              : modeChanged
                ? "editor.sectionsWarning"
                : "editor.securityWarning",
          )}
        </p>
      )}
      {modeChanged && (
        <p className="text-ui-base">
          {t("editingMode")}: {t(`mode.${before.mode}`)} → {t(`mode.${after.mode}`)}
        </p>
      )}
      {replacementChanged && (
        <details open className="rounded-lg border border-border p-3">
          <summary>{t("replacement")}</summary>
          {!summaryOnly && <PromptTextDiff before={before.replacement} after={after.replacement} />}
        </details>
      )}
      {changes.map((id) => (
        <details open key={id} className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-ui-base font-medium">
            {t(`chapter.${id}`)}: {t(`chapterMode.${before.sections[id]?.mode ?? "default"}`)} →{" "}
            {t(`chapterMode.${after.sections[id]?.mode ?? "default"}`)}
          </summary>
          {GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id) &&
          after.sections[id]?.mode === "disabled" ? (
            <p role="alert" className="text-ui-sm text-warning">
              {t(
                id === "request_user_context"
                  ? "editor.instructionsWarning"
                  : "editor.contextWarning",
              )}
            </p>
          ) : null}
          {!summaryOnly && !GENERATED_SYSTEM_PROMPT_SECTIONS.includes(id) && (
            <PromptTextDiff
              before={resolveSystemPromptSection(
                { ...before, mode: "sections" },
                id,
                catalog?.sections.find((section) => section.id === id)?.content ?? "",
              )}
              after={resolveSystemPromptSection(
                { ...after, mode: "sections" },
                id,
                catalog?.sections.find((section) => section.id === id)?.content ?? "",
              )}
            />
          )}
        </details>
      ))}
      {customChanged.map((id) => {
        const a = before.customSections.find((x) => x.id === id),
          b = after.customSections.find((x) => x.id === id);
        return (
          <details open key={id} className="rounded-lg border border-border p-3">
            <summary>
              {a
                ? b
                  ? t("editor.modified")
                  : `− ${t("editor.removed")}`
                : `+ ${t("editor.added")}`}{" "}
              · {b?.title ?? a?.title}
            </summary>
            {!summaryOnly && (
              <PromptTextDiff
                before={a ? `# ${a.title}\n\n${a.content}` : ""}
                after={b ? `# ${b.title}\n\n${b.content}` : ""}
              />
            )}
          </details>
        );
      })}
      {orderChanged && (
        <p className="text-ui-sm">
          {t("editor.customOrder")}: {after.customSections.map((x) => x.title).join(" → ") || "—"}
        </p>
      )}
      {!modeChanged &&
      !replacementChanged &&
      !changes.length &&
      !customChanged.length &&
      !orderChanged ? (
        <p className="text-ui-sm">{t("editor.noChanges")}</p>
      ) : null}
    </div>
  );
}
