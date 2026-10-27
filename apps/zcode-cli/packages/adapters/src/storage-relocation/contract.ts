import type { DataRelocationPlan } from "@zcode/shared/data-directory";

export interface CliStorageRelocationContract {
  /** 仅转换未发布的 staging 副本；保留原库、业务 ID、用户正文和远端身份。 */
  relocate(
    plan: DataRelocationPlan,
    readArtifact?: (uri: string) => Promise<{ path?: string; content: string }>,
  ): Promise<void>;
}
