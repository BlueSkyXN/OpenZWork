import { useRef } from "react";
import { CONFIG_PACKAGE_CATEGORIES, type ConfigCategory } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ConfigPackageSectionProps } from "./contract.js";
import { rowId, useConfigPackage } from "./useConfigPackage.js";

export function ConfigPackageSection({ service }: ConfigPackageSectionProps) {
  const ui = useConfigPackage(service);
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: "configPackage." + id }, values);
  const invoker = useRef<HTMLButtonElement | null>(null);
  if (!ui.available) return null;
  const { screen } = ui;
  const preview = screen.page === "preview" ? screen.preview : undefined;
  const candidate = preview?.defaultModelCandidate;
  const defaultModel =
    candidate &&
    preview.rows.some(
      (row) =>
        row.category === "providers" &&
        row.key === candidate.providerId &&
        (row.status === "same" || ui.selected.has(rowId(row))),
    )
      ? candidate
      : undefined;
  const categoryName = (id: ConfigCategory) => t("category." + id);
  const description =
    screen.page === "preview"
      ? t("previewHelp")
      : screen.page === "categories"
        ? t("chooseHelp")
        : undefined;
  return (
    <section className="mt-6 space-y-2" data-testid="config-package-section">
      <h3 className="text-ui-base font-semibold">{t("title")}</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          data-testid="config-package-export"
          disabled={screen.page !== "closed"}
          onClick={(e) => {
            invoker.current = e.currentTarget;
            ui.openExport();
          }}
        >
          {t("export")}
        </Button>
        <Button
          variant="outline"
          data-testid="config-package-import"
          disabled={screen.page !== "closed"}
          onClick={(e) => {
            invoker.current = e.currentTarget;
            void ui.openImport();
          }}
        >
          {t("import")}
        </Button>
      </div>
      <Dialog
        open={screen.page !== "closed"}
        onOpenChange={(open) => {
          if (!open) ui.close();
        }}
      >
        <DialogContent
          data-testid="config-package-dialog"
          className="flex max-h-[85dvh] w-[calc(100%-2rem)] min-w-0 flex-col sm:max-w-lg"
          showCloseButton={screen.page !== "loading"}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            invoker.current?.focus();
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <DialogHeader>
            <DialogTitle>{t("page." + screen.page)}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 min-w-0 space-y-2 overflow-y-auto break-words text-ui-base">
            {screen.page === "categories" &&
              CONFIG_PACKAGE_CATEGORIES.map((id) => (
                <label key={id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    data-testid={"config-package-category-" + id}
                    checked={ui.categories.includes(id)}
                    onChange={() => ui.toggleCategory(id)}
                  />
                  {categoryName(id)}
                </label>
              ))}
            {screen.page === "confirm" && (
              <>
                <p>{t("plaintext")}</p>
                {ui.categories.includes("providers") && <p>{t("sensitive.providers")}</p>}
                {ui.categories.includes("mcp") && <p>{t("sensitive.mcp")}</p>}
                {ui.categories.includes("hooks") && <p>{t("sensitive.hooks")}</p>}
              </>
            )}
            {screen.page === "preview" && (
              <>
                {screen.preview.differentVersion && (
                  <p>{t("version", { version: screen.preview.appVersion })}</p>
                )}
                {screen.preview.differentPlatform && (
                  <p>{t("platform", { platform: screen.preview.sourcePlatform })}</p>
                )}
                {defaultModel && (
                  <p data-testid="config-package-default-preview">
                    {t("defaultPreview", defaultModel)}
                  </p>
                )}
                {CONFIG_PACKAGE_CATEGORIES.filter((id) => id in screen.preview.counts).map((id) => (
                  <fieldset className="min-w-0 space-y-1" key={id}>
                    <legend className="font-medium">
                      {categoryName(id)} · {screen.preview.counts[id]}
                    </legend>
                    {screen.preview.rows
                      .filter((r) => r.category === id)
                      .map((row) => (
                        <label
                          key={row.key}
                          data-testid="config-package-row"
                          data-key={row.key}
                          data-status={row.status}
                          className="flex items-start gap-2 py-1"
                        >
                          <input
                            className="mt-1 shrink-0"
                            type="checkbox"
                            checked={ui.selected.has(rowId(row))}
                            disabled={row.status === "same" || row.status === "blocked"}
                            onChange={() => ui.toggle(rowId(row))}
                          />
                          <span className="min-w-0 break-all">
                            {id === "systemPrompt" ? categoryName(id) : row.name} ·{" "}
                            {t("status." + row.status)}
                            {row.reason && (
                              <span className="block text-foreground-subtle">
                                {t("reason." + row.reason)}
                              </span>
                            )}
                            {row.absolutePath && (
                              <span className="block text-foreground-subtle">
                                {t("absolutePath")}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                  </fieldset>
                ))}
              </>
            )}
            {screen.page === "exported" && (
              <div data-testid="config-package-exported">
                {CONFIG_PACKAGE_CATEGORIES.filter((id) => id in screen.counts).map((id) => (
                  <p key={id}>
                    {categoryName(id)} · {screen.counts[id]}
                  </p>
                ))}
              </div>
            )}
            {screen.page === "imported" && (
              <div data-testid="config-package-imported" className="space-y-2">
                {screen.result.items.map((item) => (
                  <p key={rowId(item)}>
                    {categoryName(item.category)} ·{" "}
                    {item.category === "systemPrompt"
                      ? categoryName(item.category)
                      : (screen.rows.find((r) => r.category === item.category && r.key === item.key)
                          ?.name ?? item.key)}{" "}
                    · {t("status." + item.status)}
                    {item.reason && " · " + t("reason." + item.reason)}
                  </p>
                ))}
                {screen.result.defaultModelSkipped && <p>{t("defaultSkipped")}</p>}
                {screen.result.defaultModelApplied && (
                  <p data-testid="config-package-default-applied">
                    {t("defaultApplied", screen.result.defaultModelApplied)}
                  </p>
                )}
                {!screen.result.items.length &&
                  !screen.result.defaultModelApplied &&
                  !screen.result.defaultModelSkipped && <p>{t("noSelected")}</p>}
                <p>{t("restart")}</p>
              </div>
            )}
            {screen.page === "error" && <p role="alert">{t("error." + screen.code)}</p>}
          </div>
          <DialogFooter>
            {screen.page === "categories" && (
              <Button
                disabled={!ui.categories.length}
                data-testid="config-package-next"
                onClick={ui.confirm}
              >
                {t("continue")}
              </Button>
            )}
            {screen.page === "confirm" && (
              <>
                <Button variant="outline" onClick={ui.back}>
                  {t("back")}
                </Button>
                <Button data-testid="config-package-save" onClick={() => void ui.save()}>
                  {t("save")}
                </Button>
              </>
            )}
            {screen.page === "preview" && (
              <Button
                data-testid="config-package-apply"
                disabled={!ui.selected.size && !defaultModel}
                onClick={() => void ui.apply()}
              >
                {defaultModel && !ui.selected.size
                  ? t("applyDefault")
                  : t("apply", { count: ui.selected.size })}
              </Button>
            )}
            {["exported", "imported", "error"].includes(screen.page) && (
              <Button data-testid="config-package-close" onClick={ui.close}>
                {t("done")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
