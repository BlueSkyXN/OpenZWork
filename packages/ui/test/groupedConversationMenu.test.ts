// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from "@/components/ui/context-menu.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { GroupedTaskContextMenuContent } from "@/project-sidebar/grouped/task-context-menu-content.js";
import { TaskList } from "@/TaskList.js";

vi.mock("@/project-sidebar/TaskProjectMoveMenu.js", () => ({ TaskProjectMoveMenu: () => null }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (select: (state: { openSettingsTab(): void }) => unknown) =>
    select({ openSettingsTab() {} }),
}));
vi.mock("@/TaskListItem.js", () => ({
  MemoTaskItem: ({
    task,
    onOpenTaskContextMenu,
  }: {
    task: { taskId: string };
    onOpenTaskContextMenu(id: string): void;
  }) =>
    createElement(
      "li",
      {
        "data-testid": `row-${task.taskId}`,
        onPointerDown: () => onOpenTaskContextMenu(task.taskId),
        onContextMenu: () => onOpenTaskContextMenu(task.taskId),
      },
      task.taskId,
    ),
  TaskListItemContextMenuContent: ({ task }: { task: { taskId: string } }) =>
    createElement(ContextMenuContent, { "data-testid": "selected-task-menu" }, task.taskId),
}));

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

it("OW-P022：列表长按选择正确任务，普通点按不挂载菜单，关闭后可选择其他任务", async () => {
  // row 事件是输入端口，实际 Radix 长按和列表选择生命周期由生产 TaskList 执行；
  // 真机事件与真实 MemoTaskItem 的接线另由 TPM03 的 Chromium touch E2E 覆盖。
  const tasks = ["first", "second"].map((taskId) => ({
    taskId,
    workspacePath: "/example",
    title: taskId,
    traceId: taskId,
    mode: "default" as const,
    createdAt: 1,
    updatedAt: 1,
  }));
  render(
    createElement(
      TooltipProvider,
      {},
      createElement(TaskList, {
        workspacePath: "/example",
        tasks,
        activeTaskId: null,
        onSelectTask: vi.fn(),
        onRenameTask: async () => null,
        onSetTaskPinned: async () => null,
        onArchiveTask: async () => null,
        showCreateButton: false,
        showFooter: false,
      }),
    ),
  );
  const touchDown = (target: HTMLElement) => {
    const event = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    fireEvent(target, event);
  };
  touchDown(screen.getByTestId("row-first"));
  expect(screen.queryByTestId("selected-task-menu")).toBeNull();
  fireEvent.pointerUp(screen.getByTestId("row-first"), { pointerType: "touch" });
  touchDown(screen.getByTestId("row-second"));
  expect(
    (await screen.findByTestId("selected-task-menu", {}, { timeout: 5_000 })).textContent,
  ).toBe("second");
  fireEvent.keyDown(screen.getByTestId("selected-task-menu"), { key: "Escape" });
  fireEvent.contextMenu(screen.getByTestId("row-first"));
  expect(
    (await screen.findByTestId("selected-task-menu", {}, { timeout: 5_000 })).textContent,
  ).toBe("first");
});
