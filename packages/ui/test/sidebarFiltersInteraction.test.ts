// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSidebarListHeader } from "@/project-sidebar/ProjectSidebarListHeader.js";
import type { ProjectSidebarView } from "@/project-sidebar/contract.js";
import type { SidebarProjectSort, SidebarTaskFilters } from "@/project-sidebar/task-filters.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
afterEach(cleanup);

function Harness() {
  const [filters, setFilters] = useState<SidebarTaskFilters>({ unreadOnly: false, status: "all" });
  const [sort, setSort] = useState<SidebarProjectSort>("manual");
  const [view, setView] = useState<ProjectSidebarView>("projects");
  return createElement(
    TooltipProvider,
    {},
    createElement(ProjectSidebarListHeader, {
      view,
      onViewChange: setView,
      onOpenCommandCenter: () => {},
      filters,
      onFiltersChange: setFilters,
      projectSort: sort,
      onProjectSortChange: setSort,
    }),
    createElement(
      "output",
      { "data-testid": "preferences" },
      JSON.stringify({ filters, sort, view }),
    ),
  );
}

it("OCC03：真实菜单组合未读/状态并显示条件；清除只重置筛选", async () => {
  render(createElement(Harness));
  fireEvent.keyDown(screen.getByTestId("sidebar-view-menu"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByTestId("sidebar-filter-unread"));
  expect(screen.getByTestId("sidebar-filter-count").textContent).toBe("1");
  fireEvent.keyDown(screen.getByTestId("sidebar-filter-status"), { key: "ArrowRight" });
  fireEvent.click(await screen.findByTestId("sidebar-filter-status-waiting"));
  expect(screen.getByTestId("sidebar-filter-count").textContent).toBe("2");
  expect(screen.getByTestId("sidebar-filter-chips").textContent).toContain(
    "sidebarFilters.status.waiting",
  );
  fireEvent.keyDown(screen.getByTestId("sidebar-filter-status-waiting"), { key: "ArrowLeft" });
  fireEvent.click(screen.getByTestId("sidebar-filter-reset"));
  expect(screen.queryByTestId("sidebar-filter-chips")).toBeNull();
  expect(JSON.parse(screen.getByTestId("preferences").textContent!)).toEqual({
    filters: { unreadOnly: false, status: "all" },
    sort: "manual",
    view: "projects",
  });
});

it("OCC04：项目排序单独提交；分组视图不提供不适用的项目排序", async () => {
  render(createElement(Harness));
  fireEvent.keyDown(screen.getByTestId("sidebar-view-menu"), { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByTestId("sidebar-project-sort"), { key: "ArrowRight" });
  fireEvent.click(await screen.findByTestId("sidebar-project-sort-activity"));
  expect(screen.getByTestId("preferences").textContent).toContain('"sort":"activity"');
  fireEvent.keyDown(screen.getByTestId("sidebar-view-menu"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByTestId("sidebar-view-grouped"));
  fireEvent.keyDown(screen.getByTestId("sidebar-view-menu"), { key: "ArrowDown" });
  await screen.findByTestId("sidebar-view-grouped");
  expect(screen.queryByTestId("sidebar-project-sort")).toBeNull();
  expect(screen.getByTestId("sidebar-filter-unread")).toBeTruthy();
});
