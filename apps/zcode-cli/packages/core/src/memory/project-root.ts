import { join } from "node:path";
import { projectMemoryDirectoryName } from "@zcode/shared/data-directory";

interface ProjectMemoryRootInput {
  cliStorageRoot: string;
  workspaceIdentity?: string;
  workspacePath: string;
}

export function resolveProjectMemoryRoot(input: ProjectMemoryRootInput): string {
  return join(
    input.cliStorageRoot,
    "memories",
    "projects",
    projectMemoryDirectoryName(input.workspacePath, input.workspaceIdentity),
    "memory",
  );
}
