import { X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  DEFAULT_SIDEBAR_TASK_FILTERS,
  SIDEBAR_TASK_STATUSES,
  hasSidebarTaskFilters,
  type SidebarProjectSort,
  type SidebarTaskFilters,
  type SidebarTaskStatus,
} from "@/project-sidebar/task-filters.js";

interface Props {
  filters: SidebarTaskFilters;
  onChange(filters: SidebarTaskFilters): void;
}

export function SidebarTaskFilterMenu({
  filters,
  onChange,
  projectSort,
  onProjectSortChange,
}: Props & {
  projectSort?: SidebarProjectSort;
  onProjectSortChange?(value: SidebarProjectSort): void;
}) {
  const { intl } = useZCodeIntl();
  const message = (name: string) => intl.formatMessage({ id: "sidebarFilters." + name });
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        data-testid="sidebar-filter-unread"
        checked={filters.unreadOnly}
        onCheckedChange={(unreadOnly) => onChange({ ...filters, unreadOnly })}
        onSelect={(event) => event.preventDefault()}
      >
        {message("unreadOnly")}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid="sidebar-filter-status">
          <span>{message("status")}</span>
          <span className="ml-auto pl-3 text-foreground-subtle">
            {message("status." + filters.status)}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={filters.status}
            onValueChange={(value) => {
              if (SIDEBAR_TASK_STATUSES.includes(value as SidebarTaskStatus))
                onChange({ ...filters, status: value as SidebarTaskStatus });
            }}
          >
            {SIDEBAR_TASK_STATUSES.map((status) => (
              <DropdownMenuRadioItem
                key={status}
                value={status}
                data-testid={"sidebar-filter-status-" + status}
                onSelect={(event) => event.preventDefault()}
              >
                {message("status." + status)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {projectSort && onProjectSortChange ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="sidebar-project-sort">
              <span>{message("projectSort")}</span>
              <span className="ml-auto pl-3 text-foreground-subtle">
                {message("sort." + projectSort)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={projectSort}
                onValueChange={(value) => {
                  if (value === "activity" || value === "manual") onProjectSortChange(value);
                }}
              >
                {(["activity", "manual"] as const).map((value) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    data-testid={"sidebar-project-sort-" + value}
                  >
                    {message("sort." + value)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : null}
      {hasSidebarTaskFilters(filters) ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="sidebar-filter-reset"
            onSelect={() => onChange(DEFAULT_SIDEBAR_TASK_FILTERS)}
          >
            {message("clear")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

export function SidebarTaskFilterChips({ filters, onChange }: Props) {
  const { intl } = useZCodeIntl();
  if (!hasSidebarTaskFilters(filters)) return null;
  const message = (name: string) => intl.formatMessage({ id: "sidebarFilters." + name });
  const chip = (label: string, clear: () => void) => (
    <button
      type="button"
      className="inline-flex min-h-7 items-center gap-1 rounded-md bg-selected px-2 text-ui-sm text-foreground"
      aria-label={intl.formatMessage({ id: "sidebarFilters.remove" }, { filter: label })}
      onClick={clear}
    >
      {label}
      <X className="size-3" aria-hidden="true" />
    </button>
  );
  return (
    <div data-testid="sidebar-filter-chips" className="flex flex-wrap items-center gap-1 px-3 pb-2">
      {filters.unreadOnly
        ? chip(message("unread"), () => onChange({ ...filters, unreadOnly: false }))
        : null}
      {filters.status !== "all"
        ? chip(message("status." + filters.status), () => onChange({ ...filters, status: "all" }))
        : null}
      <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_SIDEBAR_TASK_FILTERS)}>
        {message("clear")}
      </Button>
    </div>
  );
}
