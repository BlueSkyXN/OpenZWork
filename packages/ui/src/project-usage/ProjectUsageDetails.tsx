import type { AppUsageSessionsPage } from "@zcode/shared";
import { Folder, ChevronLeft, ChevronRight } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import type { ProjectUsageFilterProps } from "./contract.js";

export function ProjectUsageFilter({
  projectId,
  projects,
  onChange,
  disabled,
}: ProjectUsageFilterProps) {
  const { intl } = useZCodeIntl();
  return (
    <Select
      value={
        projectId === undefined ? "all" : projectId === null ? "unassigned" : `project:${projectId}`
      }
      onValueChange={(value) =>
        onChange(value === "all" ? undefined : value === "unassigned" ? null : value.slice(8))
      }
      disabled={disabled}
    >
      <SelectTrigger
        className="w-full min-w-0 @min-[520px]/usage:w-40 [&_[data-slot=select-value]]:truncate"
        aria-label={intl.formatMessage({ id: "settings.usage.project" })}
        data-testid="usage-project-filter"
      >
        <Folder className="size-3.5 shrink-0" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {intl.formatMessage({ id: "settings.usage.allProjects" })}
        </SelectItem>
        <SelectItem value="unassigned">
          {intl.formatMessage({ id: "settings.usage.unassigned" })}
        </SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={`project:${project.id}`}>
            <span className="break-words">{project.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SessionTitle({ value, className = "" }: { value: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`min-w-0 line-clamp-2 break-words [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-input-border-focused ${className}`}
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words [overflow-wrap:anywhere]">
        {value}
      </TooltipContent>
    </Tooltip>
  );
}

export function SessionUsageView({
  page,
  allProjects,
  onPageChange,
}: {
  page: AppUsageSessionsPage;
  allProjects: boolean;
  onPageChange(offset: number): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `settings.usage.sessionDetails.${key}` }, values);
  const formatter = new Intl.NumberFormat(locale);
  const format = (n: number) => formatter.format(n);
  const title = (row: AppUsageSessionsPage["rows"][number]) =>
    row.title?.trim() || `${t("untitled")} · ${row.sessionId.slice(-8)}`;
  const project = (row: AppUsageSessionsPage["rows"][number]) =>
    row.membership === "project"
      ? row.projectName
      : row.membership === "unassigned"
        ? intl.formatMessage({ id: "settings.usage.unassigned" })
        : t("notInTaskList");
  const totalLabel = t("totalRow", { count: format(page.totalCount) });
  return (
    <TooltipProvider>
      <div className="space-y-3" data-testid="usage-session-details">
        <div
          className="hidden overflow-hidden rounded-lg border border-border @min-[640px]/usage:block"
          data-testid="usage-session-table"
        >
          <table className="w-full table-fixed text-ui-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-foreground-subtle">
                <th className="w-[30%] px-3 py-2 text-left font-normal">{t("session")}</th>
                {allProjects ? (
                  <th className="w-[17%] px-3 py-2 text-left font-normal">{t("project")}</th>
                ) : null}
                {["main", "children", "total"].map((key) => (
                  <th key={key} className="px-3 py-2 text-right font-normal">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.sessionId} className="border-b border-border">
                  <td className="px-3 py-2">
                    <SessionTitle value={title(row)} />
                  </td>
                  {allProjects ? (
                    <td className="px-3 py-2">
                      <SessionTitle value={project(row) ?? ""} />
                    </td>
                  ) : null}
                  {[row.mainTokens, row.subagentTokens, row.totalTokens].map((n, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">
                      {format(n)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface font-medium" data-testid="usage-session-totals">
                <td colSpan={allProjects ? 2 : 1} className="px-3 py-3">
                  {totalLabel}
                </td>
                {[page.totals.mainTokens, page.totals.subagentTokens, page.totals.totalTokens].map(
                  (n, i) => (
                    <td key={i} className="px-3 py-3 text-right tabular-nums">
                      {format(n)}
                    </td>
                  ),
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <div
          className="divide-y divide-border @min-[640px]/usage:hidden"
          data-testid="usage-session-list"
        >
          {page.rows.map((row) => (
            <div key={row.sessionId} className="space-y-1 py-3">
              <div className="flex items-start gap-3">
                <SessionTitle value={title(row)} className="flex-1 text-ui-base" />
                <strong className="shrink-0 text-ui-base tabular-nums">
                  {format(row.totalTokens)}
                </strong>
              </div>
              <p className="break-words text-ui-sm text-foreground-subtle">
                {allProjects ? `${project(row)} · ` : ""}
                {t("mainShort")} {format(row.mainTokens)} · {t("childrenShort")}{" "}
                {format(row.subagentTokens)}
              </p>
            </div>
          ))}
          <div className="space-y-1 py-3 text-ui-sm" data-testid="usage-session-list-totals">
            <div className="flex justify-between gap-3 font-medium">
              <span>{totalLabel}</span>
              <span className="tabular-nums">{format(page.totals.totalTokens)}</span>
            </div>
            <p className="text-foreground-subtle">
              {t("mainShort")} {format(page.totals.mainTokens)} · {t("childrenShort")}{" "}
              {format(page.totals.subagentTokens)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-ui-sm">
          <span>
            {t("pageStatus", {
              from: page.totalCount ? format(page.offset + 1) : "0",
              to: format(Math.min(page.offset + page.rows.length, page.totalCount)),
              total: format(page.totalCount),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page.offset === 0}
              onClick={() => onPageChange(Math.max(0, page.offset - page.limit))}
            >
              <ChevronLeft aria-hidden="true" />
              {t("prevPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page.offset + page.limit >= page.totalCount}
              onClick={() => onPageChange(page.offset + page.limit)}
            >
              {t("nextPage")}
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
