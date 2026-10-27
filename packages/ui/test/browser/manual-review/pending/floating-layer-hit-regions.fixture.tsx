import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const kind = params.get("kind") ?? "dropdown";
const chinese = params.get("locale") === "zh-CN";
document.documentElement.className =
  params.get("theme") === "dark" ? "dark theme-zai-dark" : "light theme-zai-light";
const searchLabel = chinese ? "搜索项目或设备" : "Search projects or devices";
const menuStyle = { width: 240, height: 300 };

function Fixture() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const select = () => setSelected("XRAG");
  const projects = ["Alpha", "XRAG", "Zeta"].filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  const field = (
    <div className="p-1" onKeyDown={(event) => event.stopPropagation()}>
      <input
        data-testid="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        className="h-8 w-full text-ui-base outline-none"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <output data-testid="filtered">{projects.join(",")}</output>
    </div>
  );
  const action = (
    <button data-testid="select-project" onClick={select}>
      {chinese ? "选择 XRAG" : "Select XRAG"}
    </button>
  );
  const submenu = kind.endsWith("-sub");
  let surface;
  if (kind.startsWith("dropdown")) {
    const contents = (
      <>
        {field}
        <DropdownMenuItem data-testid="select-project" onSelect={select}>
          XRAG
        </DropdownMenuItem>
      </>
    );
    surface = (
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger data-testid="trigger">
          {chinese ? "选择项目" : "Projects"}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          style={menuStyle}
          data-testid={submenu ? undefined : "surface"}
        >
          {submenu ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="submenu-trigger">More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="surface" className="w-60">
                {contents}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            contents
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  } else if (kind.startsWith("context")) {
    const contents = (
      <>
        {field}
        <ContextMenuItem data-testid="select-project" onSelect={select}>
          XRAG
        </ContextMenuItem>
      </>
    );
    surface = (
      <ContextMenu>
        <ContextMenuTrigger data-testid="trigger" className="[app-region:no-drag]">
          Context
        </ContextMenuTrigger>
        <ContextMenuContent style={menuStyle} data-testid={submenu ? undefined : "surface"}>
          {submenu ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger data-testid="submenu-trigger">More</ContextMenuSubTrigger>
              <ContextMenuSubContent data-testid="surface" className="w-60">
                {contents}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            contents
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  } else if (kind === "popover") {
    surface = (
      <Popover defaultOpen>
        <PopoverTrigger data-testid="trigger">Popover</PopoverTrigger>
        <PopoverContent data-testid="surface" side="top" align="start" style={menuStyle}>
          {field}
          {action}
        </PopoverContent>
      </Popover>
    );
  } else {
    surface = (
      <HoverCard open>
        <HoverCardTrigger data-testid="trigger">Details</HoverCardTrigger>
        <HoverCardContent data-testid="surface" side="top" align="start" style={menuStyle}>
          {field}
          {action}
        </HoverCardContent>
      </HoverCard>
    );
  }
  return (
    <>
      <div
        data-testid="drag-region"
        className="fixed inset-x-0 top-0 h-12 bg-header [app-region:drag]"
      />
      <div style={{ position: "absolute", top: kind.startsWith("context") ? 12 : 308, left: 16 }}>
        {surface}
      </div>
      <output data-testid="selected" className="fixed bottom-8 left-4">
        {selected}
      </output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
