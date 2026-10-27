// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

const contentProps = { className: "w-72", "data-testid": "surface" };
const field = () => h("input", { "aria-label": "Search" });
const cases = [
  {
    name: "dropdown and submenu",
    view: () =>
      h(
        DropdownMenu,
        { open: true, modal: false },
        h(DropdownMenuTrigger, {}, "Projects"),
        h(
          DropdownMenuContent,
          contentProps,
          field(),
          h(
            DropdownMenuSub,
            { open: true },
            h(DropdownMenuSubTrigger, {}, "More"),
            h(DropdownMenuSubContent, { className: "w-48", "data-testid": "subsurface" }, field()),
          ),
        ),
      ),
    submenu: true,
  },
  {
    name: "context menu and submenu",
    view: () =>
      h(
        ContextMenu,
        { modal: false },
        h(ContextMenuTrigger, { "data-testid": "context-trigger" }, "Projects"),
        h(
          ContextMenuContent,
          contentProps,
          field(),
          h(
            ContextMenuSub,
            { open: true },
            h(ContextMenuSubTrigger, {}, "More"),
            h(ContextMenuSubContent, { className: "w-48", "data-testid": "subsurface" }, field()),
          ),
        ),
      ),
    submenu: true,
  },
  {
    name: "popover",
    view: () =>
      h(
        Popover,
        { open: true },
        h(PopoverTrigger, {}, "Projects"),
        h(PopoverContent, contentProps, field()),
      ),
    submenu: false,
  },
  {
    name: "interactive hover card",
    view: () =>
      h(
        HoverCard,
        { open: true },
        h(HoverCardTrigger, {}, "Project details"),
        h(HoverCardContent, contentProps, h("button", {}, "Copy path")),
      ),
    submenu: false,
  },
];

describe("交互浮层的原生鼠标命中边界", () => {
  it.each(cases)("$name 保留调用方布局并排除窗口拖拽", async ({ view, submenu }) => {
    render(view());
    const contextTrigger = screen.queryByTestId("context-trigger");
    if (contextTrigger) fireEvent.contextMenu(contextTrigger, { clientX: 20, clientY: 20 });
    const surface = await screen.findByTestId("surface");
    await waitFor(() => {
      // OW-P015：共享内容根及子菜单必须自己声明 no-drag；Portal 不能依赖触发器的区域。
      expect(surface.classList.contains("[app-region:no-drag]")).toBe(true);
      expect(surface.classList.contains("w-72")).toBe(true);
      if (submenu) {
        const sub = screen.getByTestId("subsurface");
        expect(sub.classList.contains("[app-region:no-drag]")).toBe(true);
        expect(sub.classList.contains("w-48")).toBe(true);
      }
    });
  });
});
