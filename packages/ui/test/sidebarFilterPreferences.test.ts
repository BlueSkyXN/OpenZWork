// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VirtualProject } from "@/project-sidebar/contract.js";
import { useProjectSidebarPreferences } from "@/project-sidebar/useProjectSidebarPreferences.js";

const projects: VirtualProject[] = ["one", "two"].map((id, position) => ({
  id,
  hostId: "local",
  name: id,
  roots: [],
  nameOverridden: false,
  pinned: false,
  deleted: false,
  position,
  createdAt: 1,
  updatedAt: 1,
}));
const key = "zcode-project-sidebar-preferences";
const order = projects.map((project) => JSON.stringify([project.hostId, project.id]));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("OCC05：旧顺序保持手动，新增筛选与自动模式保存后可以读回", () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      order: [...order].reverse(),
      view: "grouped",
      expanded: { [order[0]!]: false },
    }),
  );
  const first = renderHook(() => useProjectSidebarPreferences(projects, false));
  expect(first.result.current.projectSort).toBe("manual");
  expect(first.result.current.filters).toEqual({ unreadOnly: false, status: "all" });
  expect(first.result.current.isExpanded(projects[0]!)).toBe(false);
  act(() => {
    first.result.current.setFilters({ unreadOnly: true, status: "waiting" });
    first.result.current.setProjectSort("activity");
  });
  expect(JSON.parse(localStorage.getItem(key)!).order).toEqual([...order].reverse());
  first.unmount();
  const next = renderHook(() => useProjectSidebarPreferences(projects, false));
  expect(next.result.current.filters).toEqual({ unreadOnly: true, status: "waiting" });
  expect(next.result.current.projectSort).toBe("activity");
  act(() => next.result.current.setProjectSort("manual"));
  expect(next.result.current.sort(projects).map((p) => p.id)).toEqual(["two", "one"]);
});

it("OCC05：storage 广播更新新字段，不形成回写循环；清除不改视图和顺序", () => {
  const result = renderHook(() => useProjectSidebarPreferences(projects, false));
  expect(result.result.current.projectSort).toBe("activity");
  const write = vi.spyOn(Storage.prototype, "setItem");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: JSON.stringify({
          order,
          view: "timeline",
          expanded: {},
          unreadOnly: true,
          taskStatus: "failed",
          projectSort: "manual",
        }),
      }),
    ),
  );
  expect(result.result.current.filters).toEqual({ unreadOnly: true, status: "failed" });
  expect(result.result.current.projectSort).toBe("manual");
  expect(write).not.toHaveBeenCalled();
  act(() => result.result.current.setFilters({ unreadOnly: false, status: "all" }));
  expect(result.result.current.view).toBe("timeline");
  expect(result.result.current.order).toEqual(order);
  expect(result.result.current.projectSort).toBe("manual");
});

it("OCC05：损坏的新字段回到合法默认，不丢弃旧顺序", () => {
  localStorage.setItem(
    key,
    JSON.stringify({ order, taskStatus: "unknown", unreadOnly: "true", projectSort: "unknown" }),
  );
  const result = renderHook(() => useProjectSidebarPreferences(projects, false));
  expect(result.result.current.filters).toEqual({ unreadOnly: false, status: "all" });
  expect(result.result.current.projectSort).toBe("manual");
});
