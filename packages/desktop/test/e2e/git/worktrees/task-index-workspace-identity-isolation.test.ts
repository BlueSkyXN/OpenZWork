// 受管 worktree 任务 WT04 验收矩阵：同一路径两个不同 identity 的任务隔离与冷恢复
// （受控运行时入口，2026-11-15 独立复核 F3 从 services 业务单测迁移）。
// 走生产事实管道 createTaskFacts（zcodeAgentService 同一装配）+ 真实 TaskIndexRepo 存储
// 端口；写入/删除经 ingest/removed 公开面，查询经 adapter 同款的 queryTaskList workspaceScopes。
// 归属键 = workspaceIdentity?.trim() || workspacePath（AGENTS「Workspace Identity」唯一规则）。
// 注：schema 另有 UNIQUE(host_id, task_id)——task_id 是 host 级唯一，同一 host 下两个
// identity 各自持有不同 taskId（host 级唯一是产品身份模型本身的事实，不在本用例挑战）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";
import { TaskIndexRepo } from "../../../../../services/src/session/taskIndexRepo.js";
import { createTaskFacts } from "../../../../../services/src/task-facts/index.js";

const IDENTITY_A = "ssh://hostA/shared-project";
const IDENTITY_B = "ssh://hostB/shared-project";
const SHARED_PATH = "/virtual/shared-project";
const tempDirs: string[] = [];

after(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wt04-identity-runtime-"));
  tempDirs.push(dir);
  return join(dir, "tasks-index.sqlite");
}

function summaryOf(sessionId: string, title: string): SessionSummary {
  const now = 1_790_000_000_000;
  return {
    sessionId,
    workspaceId: sessionId,
    title,
    phase: "completedSuccess",
    sessionEnded: true,
    hasBackgroundWork: false,
    lastActivityAt: now,
    createdAt: now,
  };
}

// 本用例场景只走 CLI 事实 ingest/removed 公开面；对账/执行源未被触达即失败，
// 防止未来把 Host 侧运行态推导混入事实存储。
const untouchedSource = {
  reconcile: async () => {
    throw new Error("reconcile 不应被本场景触达");
  },
  execute: async () => {
    throw new Error("execute 不应被本场景触达");
  },
};

async function listTaskTitles(
  repo: TaskIndexRepo,
  workspaceIdentity?: string,
): Promise<string[]> {
  const result = await repo.queryTaskList({
    kind: "all",
    workspaceScopes: [
      { workspacePath: SHARED_PATH, ...(workspaceIdentity ? { workspaceIdentity } : {}) },
    ],
    sortBy: "updated",
  });
  return result.items.map((item) => item.title).sort();
}

describe("WT04 受控运行时：同一路径两个不同 identity 的任务隔离与冷恢复", () => {
  it("identity A/B 在同一路径互不可见，本地路径键看不到 identity 任务", async () => {
    const dbPath = await makeDbPath();
    const repo = new TaskIndexRepo(undefined, "local", dbPath);
    try {
      const facts = createTaskFacts({
        store: repo,
        source: untouchedSource,
        changed: () => undefined,
      });
      await facts.ingest(
        { workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_A },
        summaryOf("t_identity_a", "A 的任务"),
      );
      await facts.ingest(
        { workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_B },
        summaryOf("t_identity_b", "B 的任务"),
      );
      await facts.ingest(
        { workspacePath: SHARED_PATH },
        summaryOf("t_local", "本地任务"),
      );

      await expect(listTaskTitles(repo, IDENTITY_A)).resolves.toEqual(["A 的任务"]);
      await expect(listTaskTitles(repo, IDENTITY_B)).resolves.toEqual(["B 的任务"]);
      // 同一路径不带 identity 的本地键与两个 identity 键都不互通（不退化成路径去重）。
      await expect(listTaskTitles(repo)).resolves.toEqual(["本地任务"]);
    } finally {
      repo.close({ throwOnError: true });
    }
  });

  it("删除经事实管道 removed 公开面双向隔离，冷恢复（重开 DB）后隔离保持", async () => {
    const dbPath = await makeDbPath();
    const repo = new TaskIndexRepo(undefined, "local", dbPath);
    const changes: Array<{ target: { workspaceIdentity?: string; taskId: string }; reason: string }> =
      [];
    const facts = createTaskFacts({
      store: repo,
      source: untouchedSource,
      changed: (change) => changes.push({ target: change.target, reason: change.reason }),
    });
    await facts.ingest(
      { workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_A },
      summaryOf("t_a", "属于 A"),
    );
    await facts.ingest(
      { workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_B },
      summaryOf("t_b", "属于 B"),
    );
    // B 侧删除不波及 A 侧行；变更事件携带被删目标的 identity（供远端/侧栏按键过滤）。
    await facts.removed({ workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_B, taskId: "t_b" });
    expect(changes).toEqual([
      {
        target: { workspacePath: SHARED_PATH, workspaceIdentity: IDENTITY_B, taskId: "t_b" },
        reason: "task_deleted",
      },
    ]);
    await expect(listTaskTitles(repo, IDENTITY_A)).resolves.toEqual(["属于 A"]);
    await expect(listTaskTitles(repo, IDENTITY_B)).resolves.toEqual([]);
    repo.close({ throwOnError: true });

    // 冷恢复：新实例重开同一数据库，事实不串（运行时 owner 重启后的持久化隔离）。
    const reopened = new TaskIndexRepo(undefined, "local", dbPath);
    try {
      await expect(listTaskTitles(reopened, IDENTITY_A)).resolves.toEqual(["属于 A"]);
      await expect(listTaskTitles(reopened, IDENTITY_B)).resolves.toEqual([]);
    } finally {
      reopened.close({ throwOnError: true });
    }
  });
});
