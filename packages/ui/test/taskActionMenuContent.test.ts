import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";

const PIN_ITEM_INDEX = 0;
const RENAME_ITEM_INDEX = 1;
const ARCHIVE_ITEM_INDEX = 2;
const UNREAD_ITEM_INDEX = 3;
const FILE_MANAGER_ITEM_INDEX = 4;
const WORKSPACE_PATH_ITEM_INDEX = 5;
const TASK_PATH_ITEM_INDEX = 6;
const TASK_LOG_PATH_ITEM_INDEX = 7;
const PROVIDER_CONFIG_ITEM_INDEX = 8;

function renderMenu(overrides: Partial<React.ComponentProps<typeof TaskActionMenuContent>> = {}) {
  const itemStates: Array<{ disabled?: boolean; variant?: string; onSelect?: () => void }> = [];

  const html = renderToStaticMarkup(
    createElement(TaskActionMenuContent, {
      intl: {
        formatMessage: ({ id }: { id: string }) => id,
      },
      isPinned: false,
      fileManagerLabel: "Open in Finder",
      taskSessionFile: {
        loading: false,
        path: "/tmp/task/session.md",
        exists: true,
      },
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/session.jsonl",
        exists: true,
      },
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: true,
      },
      Item: ({
        children,
        title,
        disabled,
        variant,
        onSelect,
      }: {
        children: React.ReactNode;
        title?: string;
        disabled?: boolean;
        variant?: "default" | "destructive";
        onSelect?: () => void;
      }) => {
        itemStates.push({ disabled, variant, onSelect });
        return createElement("button", { title, disabled }, children);
      },
      Separator: () => createElement("hr"),
      onTogglePinTask: vi.fn(),
      onStartRenameTask: vi.fn(),
      onArchiveTask: vi.fn(),
      onMarkTaskAsUnread: vi.fn(),
      onOpenTaskPathInFileManager: vi.fn(),
      onCopyWorkspacePath: vi.fn(),
      onCopyTaskPath: vi.fn(),
      onCopyTaskLogPath: vi.fn(),
      onOpenProviderConfig: vi.fn(),
      ...overrides,
    }),
  );

  return {
    html,
    itemStates,
  };
}

describe("TaskActionMenuContent", () => {
  it("OCC01/06：复制入口独立读取能力，归档和取消归档使用各自语义颜色", () => {
    const copy = vi.fn();
    const result = renderMenu({
      onCopyConversationMarkdown: copy,
      activeSessionId: "session",
      disableTaskActions: true,
    });
    expect(result.html).toContain("conversationExport.copy");
    expect(result.itemStates[0]?.disabled).toBe(false);
    result.itemStates[0]?.onSelect?.();
    expect(copy).toHaveBeenCalledOnce();
    expect(renderMenu().itemStates[ARCHIVE_ITEM_INDEX]?.variant).toBe("destructive");
    expect(renderMenu({ isArchived: true }).itemStates[ARCHIVE_ITEM_INDEX]?.variant).toBe(
      "default",
    );
    expect(
      renderMenu({
        onCopyConversationMarkdown: copy,
        activeSessionId: "session",
        copyingConversation: true,
      }).itemStates[0]?.disabled,
    ).toBe(true);
    expect(
      renderMenu({ onCopyConversationMarkdown: copy, disableCopyConversation: true }).itemStates[0]
        ?.disabled,
    ).toBe(true);
  });
  it("provider 配置文件未落盘但路径已知时仍保留入口", () => {
    const { itemStates } = renderMenu({
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: false,
      },
    });

    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("日志文件未落盘但路径已知时仍允许复制路径", () => {
    const { itemStates } = renderMenu({
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/zcode-log.jsonl",
        exists: false,
      },
    });

    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("新建未落库任务只禁用依赖 taskId 的动作", () => {
    const { itemStates } = renderMenu({
      disableTaskTargetActions: true,
    });

    expect(itemStates[PIN_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[RENAME_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[ARCHIVE_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[UNREAD_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[FILE_MANAGER_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[WORKSPACE_PATH_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("手机远控菜单隐藏本机文件和配置入口但保留复制路径", () => {
    const { html } = renderMenu({
      hideMobileUnsupportedActions: true,
    });

    expect(html).not.toContain("Open in Finder");
    expect(html).not.toContain("appHeader.goToProviderConfig");
    expect(html).toContain("appHeader.copyPath");
    expect(html).toContain("appHeader.copyTaskPath");
    expect(html).toContain("appHeader.copyLogPath");
  });

  it("不再提供在分屏打开入口", () => {
    const { html } = renderMenu();

    expect(html).not.toContain("taskList.openInSplitPane");
  });
});
