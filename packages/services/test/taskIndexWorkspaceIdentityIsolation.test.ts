import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

// WT04 验收缺口（2026-11-15 独立复核）：现有 E2E 只断言本地 identity 为空、同路径单一
// workspace，未覆盖验收矩阵「同一路径两个不同 identity 的隔离与冷恢复」。tasks-index 的
// 归属键是 workspace_key = workspaceIdentity?.trim() || workspacePath；这里在同一物理路径
// 下写入两个 identity 的任务，验证列表互不可见、双向删除隔离、重开（冷恢复）后隔离保持。
// 注：schema 另有 UNIQUE(host_id, task_id)——task_id 是 host 级唯一，同一 host 下两个
// identity 各自持有不同 taskId（host 级唯一是产品身份模型本身的事实，不在本测试挑战）。
const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt04-identity-"));
  tempDirs.push(dir);
  return join(dir, "tasks-index.sqlite");
}

function makeMeta(params: {
  taskId: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
}): ZCodeTaskMeta {
  return {
    taskId: params.taskId,
    traceId: `trace_${params.taskId}`,
    title: params.title,
    titleOverridden: true,
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
    mode: "build",
    provider: "glm",
    status: "completed",
  };
}

const IDENTITY_A = "ssh://hostA/shared-project";
const IDENTITY_B = "ssh://hostB/shared-project";

async function listTaskTitles(
  repo: TaskIndexRepo,
  workspacePath: string,
  workspaceIdentity?: string,
): Promise<string[]> {
  const result = await repo.queryTaskList({
    kind: "all",
    workspaceScopes: [{ workspacePath, ...(workspaceIdentity ? { workspaceIdentity } : {}) }],
    sortBy: "updated",
  });
  return result.items.map((item) => item.title).sort();
}

describe("WT04：同一路径两个不同 identity 的任务隔离与冷恢复", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("identity A/B 在同一路径互不可见，本地路径键看不到 identity 任务", async () => {
    const dbPath = makeDbPath();
    const path = "/virtual/shared-project";
    const repo = new TaskIndexRepo(undefined, "local", dbPath);
    try {
      await repo.applyCliFacts({
        meta: makeMeta({
          taskId: "t_identity_a",
          title: "A 的任务",
          workspacePath: path,
          workspaceIdentity: IDENTITY_A,
        }),
      });
      await repo.applyCliFacts({
        meta: makeMeta({
          taskId: "t_identity_b",
          title: "B 的任务",
          workspacePath: path,
          workspaceIdentity: IDENTITY_B,
        }),
      });
      await repo.applyCliFacts({
        meta: makeMeta({ taskId: "t_local", title: "本地任务", workspacePath: path }),
      });

      await expect(listTaskTitles(repo, path, IDENTITY_A)).resolves.toEqual(["A 的任务"]);
      await expect(listTaskTitles(repo, path, IDENTITY_B)).resolves.toEqual(["B 的任务"]);
      // 同一路径不带 identity 的本地键与两个 identity 键都不互通（不退化成路径去重）。
      await expect(listTaskTitles(repo, path)).resolves.toEqual(["本地任务"]);
    } finally {
      repo.close({ throwOnError: true });
    }
  });

  it("双向删除隔离，冷恢复（重开 DB）后隔离保持", async () => {
    const dbPath = makeDbPath();
    const path = "/virtual/shared-project";
    const repo = new TaskIndexRepo(undefined, "local", dbPath);
    await repo.applyCliFacts({
      meta: makeMeta({
        taskId: "t_a",
        title: "属于 A",
        workspacePath: path,
        workspaceIdentity: IDENTITY_A,
      }),
    });
    await repo.applyCliFacts({
      meta: makeMeta({
        taskId: "t_b",
        title: "属于 B",
        workspacePath: path,
        workspaceIdentity: IDENTITY_B,
      }),
    });
    // B 侧删除不波及 A 侧行。
    await repo.applyCliDeletion({
      workspacePath: path,
      workspaceIdentity: IDENTITY_B,
      taskId: "t_b",
    });
    repo.close({ throwOnError: true });

    // 冷恢复：新实例重开同一数据库，事实不串。
    const reopened = new TaskIndexRepo(undefined, "local", dbPath);
    try {
      await expect(listTaskTitles(reopened, path, IDENTITY_A)).resolves.toEqual(["属于 A"]);
      await expect(listTaskTitles(reopened, path, IDENTITY_B)).resolves.toEqual([]);
    } finally {
      reopened.close({ throwOnError: true });
    }
  });
});
