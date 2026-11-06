import { Check } from "lucide-react";
import type { ProjectTask } from "@/project-sidebar/contract.js";
import { useProjectSelectionDirectory } from "@/project-sidebar/ProjectDirectoryProvider.js";
import { projectKey } from "@/project-sidebar/view.js";
import { useMoveTaskToProject } from "@/project-sidebar/useMoveTaskToProject.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu.js";

/** 仅在任务菜单打开时挂载，复用目录项目切片；同 Host 的候选不依赖已打开 tabs。 */
export function TaskProjectMoveMenu({ task }: { task: ProjectTask }) {
  const { projects, allProjects, availability, service, refresh, error } =
    useProjectSelectionDirectory();
  const { intl } = useZCodeIntl();
  const move = useMoveTaskToProject(service, refresh);
  const source = allProjects.find(
    (project) => project.hostId === task.hostId && project.id === task.projectId,
  );
  if (!service || source?.legacySingleRoot) return null;
  const candidates = projects.filter(
    (project) =>
      !project.deleted &&
      !project.legacySingleRoot &&
      project.hostId === task.hostId &&
      (project.hostId === "local" ||
        (availability.get(projectKey(project))?.online === true &&
          project.roots.some((root) => root.rootPath === task.workspacePath))),
  );
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="task-project-move-menu" disabled={Boolean(error)}>
        {intl.formatMessage({ id: "project.move.menu" })}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        data-testid="task-project-move-targets"
        collisionPadding={8}
        className="w-60 min-w-0 max-w-[var(--radix-context-menu-content-available-width)] max-h-[min(18rem,var(--radix-context-menu-content-available-height))] overflow-y-auto"
      >
        {candidates.map((project) => (
          <ContextMenuItem
            key={projectKey(project)}
            data-task-project-target={project.id}
            data-task-project-host={project.hostId}
            disabled={project.id === task.projectId}
            onSelect={() => void move(task, project)}
          >
            <span className="min-w-0 flex-1 truncate" title={project.name}>
              {project.name}
            </span>
            {project.id === task.projectId ? (
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
            ) : null}
          </ContextMenuItem>
        ))}
        {!candidates.length ? (
          <ContextMenuItem disabled>
            {intl.formatMessage({ id: "project.move.empty" })}
          </ContextMenuItem>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
