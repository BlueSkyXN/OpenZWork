// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { GroupedTaskContextMenuContent } from "@/project-sidebar/grouped/task-context-menu-content.js";

afterEach(cleanup);

it.each([undefined, "只读目录"])(
  "OCC01/06：分组菜单复用复制入口，归档样式不受只读目录影响（%s）",
  async (disabledReason) => {
    const copy = vi.fn();
    const path = { loading: false, path: null };
    render(
      createElement(
        TooltipProvider,
        {},
        createElement(
          ContextMenu,
          {},
          createElement(ContextMenuTrigger, { "data-testid": "grouped-row" }, "示例任务"),
          createElement(GroupedTaskContextMenuContent, {
            task: {
              taskId: "example",
              hostId: "local",
              workspacePath: "/example",
              title: "示例任务",
              traceId: "example",
              mode: "default",
              projectId: null,
              pinned: false,
              archived: false,
              createdAt: 1,
              updatedAt: 1,
            },
            groups: [],
            intl: { formatMessage: ({ id }) => id },
            fileManagerLabel: "Finder",
            taskSessionFile: path,
            taskNativeSessionLogFile: path,
            providerConfigFile: path,
            onMoveTaskToGroup: vi.fn(),
            onMoveTaskToTop: vi.fn(),
            onStartRenameTask: vi.fn(),
            onArchiveTask: vi.fn(),
            onMarkTaskAsUnread: vi.fn(),
            onOpenTaskPathInFileManager: vi.fn(),
            onCopyText: vi.fn(),
            onOpenProviderConfig: vi.fn(),
            onCopyConversationMarkdown: copy,
            disableCopyConversation: false,
            disabledReason,
          }),
        ),
      ),
    );
    fireEvent.contextMenu(screen.getByTestId("grouped-row"));
    const item = await screen.findByTestId("task-copy-markdown");
    expect(item.getAttribute("data-disabled")).toBeNull();
    expect(screen.getByText("taskList.archive").getAttribute("data-variant")).toBe("destructive");
    fireEvent.click(item);
    expect(copy).toHaveBeenCalledOnce();
  },
);
