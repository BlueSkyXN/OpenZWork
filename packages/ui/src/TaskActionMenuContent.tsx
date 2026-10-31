interface TaskActionMenuItemProps {
  children: React.ReactNode;
  "data-testid"?: string;
  disabled?: boolean;
  onSelect?: () => void;
  title?: string;
  variant?: "default" | "destructive";
}

interface TaskActionMenuSeparatorProps {
  key?: string;
}

/** 普通列表、分组列表和 Header 使用同一个只读复制入口。 */
export function TaskCopyMarkdownMenuItem({
  intl,
  Item,
  activeSessionId,
  copyingConversation = false,
  disableCopyConversation = false,
  onCopyConversationMarkdown,
}: {
  intl: { formatMessage(desc: { id: string }): string };
  Item: React.ComponentType<TaskActionMenuItemProps>;
  activeSessionId?: string | null;
  copyingConversation?: boolean;
  disableCopyConversation?: boolean;
  onCopyConversationMarkdown: () => void;
}) {
  return (
    <Item
      data-testid="task-copy-markdown"
      disabled={!activeSessionId || copyingConversation || disableCopyConversation}
      onSelect={onCopyConversationMarkdown}
    >
      {intl.formatMessage({
        id: copyingConversation ? "conversationExport.copying" : "conversationExport.copy",
      })}
    </Item>
  );
}

export function TaskActionMenuContent({
  intl,
  isPinned,
  isArchived = false,
  fileManagerLabel,
  taskSessionFile,
  activeSessionId,
  taskNativeSessionLogFile,
  providerConfigFile,
  disableTaskActions = false,
  disableTaskTargetActions = false,
  disablePinTaskAction = false,
  disabledReason,
  hideMobileUnsupportedActions = false,
  Item,
  Separator,
  onTogglePinTask,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  // 净化保留：上游 onOpenTaskFeedback（打开官方反馈表单）属 feedback 净化域，不并入；任务重启为中性功能保留。
  onRestartTask,
  restartPending = false,
  onOpenTaskPathInFileManager,
  onCopyWorkspacePath,
  onCopyTaskPath,
  onCopyTaskLogPath,
  onCopySessionId,
  onViewModelTrajectory,
  onOpenProviderConfig,
  onCopyConversationMarkdown,
  copyingConversation = false,
  disableCopyConversation = false,
}: {
  intl: {
    formatMessage: (desc: { id: string }, values?: Record<string, string>) => string;
  };
  isPinned: boolean;
  isArchived?: boolean;
  fileManagerLabel: string;
  taskSessionFile: { loading: boolean; path: string | null; exists: boolean };
  activeSessionId?: string | null;
  taskNativeSessionLogFile: {
    loading: boolean;
    path: string | null;
    exists: boolean;
  };
  providerConfigFile: { loading: boolean; path: string | null; exists: boolean };
  disableTaskActions?: boolean;
  disableTaskTargetActions?: boolean;
  disablePinTaskAction?: boolean;
  disabledReason?: string;
  hideMobileUnsupportedActions?: boolean;
  Item: React.ComponentType<TaskActionMenuItemProps>;
  Separator: React.ComponentType<TaskActionMenuSeparatorProps>;
  onTogglePinTask: () => void;
  onStartRenameTask: () => void;
  onArchiveTask: () => void;
  onMarkTaskAsUnread: () => void;
  onRestartTask?: () => void;
  restartPending?: boolean;
  onOpenTaskPathInFileManager: () => void;
  onCopyWorkspacePath: () => void;
  onCopyTaskPath: () => void;
  onCopyTaskLogPath: () => void;
  onCopySessionId?: () => void;
  onViewModelTrajectory?: () => void;
  onOpenProviderConfig: () => void;
  onCopyConversationMarkdown?: () => void;
  copyingConversation?: boolean;
  disableCopyConversation?: boolean;
}) {
  const taskTargetActionsDisabled = disableTaskActions || disableTaskTargetActions;

  return (
    <>
      {onCopyConversationMarkdown ? (
        <>
          <TaskCopyMarkdownMenuItem
            intl={intl}
            Item={Item}
            activeSessionId={activeSessionId}
            copyingConversation={copyingConversation}
            disableCopyConversation={disableCopyConversation}
            onCopyConversationMarkdown={onCopyConversationMarkdown}
          />
          <Separator />
        </>
      ) : null}
      <Item
        disabled={taskTargetActionsDisabled || disablePinTaskAction}
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={() => {
          if (!taskTargetActionsDisabled && !disablePinTaskAction) {
            onTogglePinTask();
          }
        }}
      >
        {intl.formatMessage({ id: isPinned ? "taskList.unpin" : "taskList.pin" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onStartRenameTask();
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.rename" })}
      </Item>
      <Item
        variant={isArchived ? "default" : "destructive"}
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onArchiveTask();
          }
        }}
      >
        {intl.formatMessage({ id: isArchived ? "taskList.unarchive" : "taskList.archive" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled}
        title={disabledReason}
        onSelect={() => {
          if (!taskTargetActionsDisabled) {
            onMarkTaskAsUnread();
          }
        }}
      >
        {intl.formatMessage({ id: "taskList.markAsUnread" })}
      </Item>
      {onRestartTask ? (
        <Item
          data-testid="task-restart"
          disabled={taskTargetActionsDisabled || restartPending}
          onSelect={onRestartTask}
        >
          {intl.formatMessage({ id: restartPending ? "taskList.restarting" : "taskList.restart" })}
        </Item>
      ) : null}
      <Separator />
      {!hideMobileUnsupportedActions ? (
        <Item
          disabled={disableTaskActions}
          title={disableTaskActions ? disabledReason : undefined}
          onSelect={() => {
            if (!disableTaskActions) {
              onOpenTaskPathInFileManager();
            }
          }}
        >
          {fileManagerLabel}
        </Item>
      ) : null}
      <Item
        disabled={disableTaskActions}
        title={disableTaskActions ? disabledReason : undefined}
        onSelect={onCopyWorkspacePath}
      >
        {intl.formatMessage({ id: "appHeader.copyPath" })}
      </Item>
      <Item
        disabled={taskTargetActionsDisabled || taskSessionFile.loading || !taskSessionFile.path}
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={onCopyTaskPath}
      >
        {intl.formatMessage({ id: "appHeader.copyTaskPath" })}
      </Item>
      <Item
        disabled={
          taskTargetActionsDisabled ||
          taskNativeSessionLogFile.loading ||
          !taskNativeSessionLogFile.path
        }
        title={taskTargetActionsDisabled ? disabledReason : undefined}
        onSelect={onCopyTaskLogPath}
      >
        {/* Bugfix: ZCode Agent 的日志路径可能先按运行时约定得出，当前日期文件尚未落盘。
            复制动作只依赖路径字符串，不能把 exists=false 当成不可复制，否则菜单会表现成“不能点”。 */}
        {intl.formatMessage({ id: "appHeader.copyLogPath" })}
      </Item>
      {onCopySessionId ? (
        <Item
          disabled={taskTargetActionsDisabled || !activeSessionId}
          title={taskTargetActionsDisabled ? disabledReason : undefined}
          onSelect={onCopySessionId}
        >
          {intl.formatMessage({ id: "appHeader.copySessionId" })}
        </Item>
      ) : null}
      {!hideMobileUnsupportedActions ? (
        /* Bugfix: 手机远控运行在浏览器里，无法可靠打开桌面端 provider 配置文件。
           这里只在远控移动端隐藏入口，桌面端仍沿用“路径已知即可前往配置”的能力。 */
        <Item
          disabled={disableTaskActions || providerConfigFile.loading || !providerConfigFile.path}
          title={disableTaskActions ? disabledReason : undefined}
          onSelect={() => {
            if (!disableTaskActions) {
              onOpenProviderConfig();
            }
          }}
        >
          <span className="truncate">
            {intl.formatMessage({ id: "appHeader.goToProviderConfig" })}
          </span>
        </Item>
      ) : null}
      {onViewModelTrajectory ? (
        <>
          <Separator />
          {/* 调用轨迹查看：从 ~/.openzwork/cli 的 model-io 还原该 task 的模型请求/响应/工具调用，
              在右侧边栏可视化。只依赖 taskId（即 sessionId），不依赖快照文件是否落盘。 */}
          <Item
            disabled={taskTargetActionsDisabled || !activeSessionId}
            title={taskTargetActionsDisabled ? disabledReason : undefined}
            onSelect={onViewModelTrajectory}
          >
            {intl.formatMessage({ id: "taskList.viewModelTrajectory" })}
          </Item>
        </>
      ) : null}
    </>
  );
}
