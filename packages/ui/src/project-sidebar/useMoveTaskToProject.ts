import { useCallback } from "react";
import type {
  IProjectService,
  ProjectTaskRef,
  VirtualProject,
} from "@/project-sidebar/contract.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";
import { logger } from "@/logger.js";

/** 菜单和拖拽共用 Host 移动入口；UI 不保存归属副本，缺目录确认取消不写入。 */
export function useMoveTaskToProject(
  service: IProjectService | undefined,
  refresh: () => Promise<void>,
) {
  const confirm = useConfirmDialog();
  const { intl } = useZCodeIntl();
  return useCallback(
    async (task: ProjectTaskRef, project: VirtualProject) => {
      if (!service) return;
      try {
        const request = {
          task: {
            taskId: task.taskId,
            workspacePath: task.workspacePath,
            ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
          },
          projectId: project.id,
          hostId: project.hostId,
        };
        try {
          await service.moveTask(request);
        } catch (cause) {
          if (
            project.hostId !== "local" ||
            !String(cause).includes("project.root-confirmation-required")
          )
            throw cause;
          if (
            !(await confirm({
              testId: "task-project-move-confirm",
              title: intl.formatMessage(
                { id: "project.move.addFolderTitle" },
                { project: project.name },
              ),
              description: intl.formatMessage(
                { id: "project.move.addFolderDescription" },
                { path: task.workspacePath },
              ),
              confirmLabel: intl.formatMessage({ id: "project.move.addAndMove" }),
            }))
          )
            return;
          // 目标项目和目录的最终有效性由 Host 在同一事务复检，确认不授权更换 cwd。
          await service.moveTask({ ...request, addMissingRoot: true });
        }
        await refresh();
        toast(intl.formatMessage({ id: "project.move.done" }, { project: project.name }));
      } catch (cause) {
        logger.error("[project-sidebar] 移动任务到项目失败", cause);
        toast(intl.formatMessage({ id: "project.move.failed" }));
      }
    },
    [service, refresh, confirm, intl],
  );
}
