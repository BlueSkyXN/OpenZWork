import { isAbsolute } from "node:path";
import { z } from "zod";

const absolutePath = z.string().min(1).refine(isAbsolute, "Expected an absolute path");
export const dataRelocationPlanSchema = z
  .object({
    sourceRoot: absolutePath,
    sourceAliases: z.array(absolutePath).optional(),
    targetRoot: absolutePath,
    stageRoot: absolutePath,
  })
  .strict();
export type DataRelocationPlan = z.infer<typeof dataRelocationPlanSchema>;
export const STORAGE_RELOCATION_COMMAND = "storage-relocate";
export const storageRelocationReportSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("storage-relocated"),
  })
  .strict();

export const BUSINESS_DATA_ENTRIES = [
  "v2",
  "cli",
  "workspace",
  "agent-memory",
  "clipboard",
  "git-checkpoint-index",
  "backup",
  "tmp",
  "cache",
  "mailbox",
  "security",
] as const;
export const DATA_ROOT_RELOCATED_MARKER = ".data-directory-relocated.json";

/** 租约只协调同根使用者；业务库和转换格式分别由其 owner 管理。 */
export interface DataDirectoryContract {
  /** 在首次业务 I/O 前登记，所有业务资源关闭后释放；迁移中/已迁走的根拒绝准入。 */
  acquireUse(root: string): Promise<() => Promise<void>>;
  /** 持有排他门禁并确认无存活使用者后执行，异常传播且释放门禁。 */
  exclusive<T>(root: string, operation: () => Promise<T>): Promise<T>;
}
