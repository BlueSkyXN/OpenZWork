// OW-P024 回归（UI 读状态，spec §5）：savedWorkflowStore 的历史错误分离与请求代际。
// 证明范围：仅 UI 状态机——用受控 IZCodeAgentService 替身按受控顺序 resolve/reject，
// 确定性地复现「旧请求后完成覆盖新刷新」「历史失败被伪装为空历史」两个竞态/表达缺陷；
// 不据此声称任何进程或服务端结论。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IZCodeAgentService, ZCodeAgentSavedWorkflowTarget } from "@zcode/services";
import type { ZCodeWorkflowsListResult, ZCodeSavedWorkflowRun } from "@zcode/shared";
import {
  resetSavedWorkflowStoreForTests,
  selectSavedWorkflowState,
  useSavedWorkflowStore,
} from "@/store/savedWorkflowStore.js";

function listResult(names: string[]): ZCodeWorkflowsListResult {
  return {
    workflows: names.map((name) => ({
      name,
      description: `${name}-desc`,
      scope: "project" as const,
      path: `/fixture/${name}.dwf.ts`,
    })),
    invalid: [],
    dir: "/fixture/.zcode/workflows",
  };
}

function runsResult(names: string[]): { runs: ZCodeSavedWorkflowRun[] } {
  return {
    runs: names.map((name) => ({
      runId: `run-${name}`,
      name,
      startedAt: 1,
      finishedAt: 2,
      status: "completed" as const,
    })),
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createControlledService() {
  const listCalls: Array<Deferred<ZCodeWorkflowsListResult>> = [];
  const runsCalls: Array<Deferred<{ runs: ZCodeSavedWorkflowRun[] }>> = [];
  const service = {
    listSavedWorkflows: vi.fn((_target: ZCodeAgentSavedWorkflowTarget) => {
      const call = deferred<ZCodeWorkflowsListResult>();
      listCalls.push(call);
      return call.promise;
    }),
    listSavedWorkflowRuns: vi.fn((_target: ZCodeAgentSavedWorkflowTarget) => {
      const call = deferred<{ runs: ZCodeSavedWorkflowRun[] }>();
      runsCalls.push(call);
      return call.promise;
    }),
  } as unknown as IZCodeAgentService;
  return { service, listCalls, runsCalls };
}

const target: ZCodeAgentSavedWorkflowTarget = { workspacePath: "/fixture/proj-a" };

describe("savedWorkflowStore 的历史错误与请求代际（OW-P024）", () => {
  beforeEach(() => {
    resetSavedWorkflowStoreForTests();
  });

  it("运行历史失败单独暴露 runsError：列表可用、runs 保留、不显示为空历史", async () => {
    const { service, listCalls, runsCalls } = createControlledService();
    const first = useSavedWorkflowStore.getState().load(target, service);
    listCalls[0]!.resolve(listResult(["flow-1"]));
    runsCalls[0]!.resolve(runsResult(["flow-1"]));
    await first;

    const second = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });
    listCalls[1]!.resolve(listResult(["flow-1", "flow-2"]));
    runsCalls[1]!.reject(new Error("journal unreadable"));
    await second;

    const state = selectSavedWorkflowState(useSavedWorkflowStore.getState(), target);
    expect(state.error).toBeNull();
    expect(state.entries.map((entry) => entry.name)).toEqual(["flow-1", "flow-2"]);
    // 上次已知 runs 保留，错误单独表达（可重试），不再被伪装成「尚未运行」。
    expect(state.runs.map((run) => run.name)).toEqual(["flow-1"]);
    expect(state.runsError).toBe("journal unreadable");
  });

  it("历史失败后重试成功会清掉 runsError", async () => {
    const { service, listCalls, runsCalls } = createControlledService();
    const first = useSavedWorkflowStore.getState().load(target, service);
    listCalls[0]!.resolve(listResult(["flow-1"]));
    runsCalls[0]!.reject(new Error("boom"));
    await first;
    expect(selectSavedWorkflowState(useSavedWorkflowStore.getState(), target).runsError).toBe(
      "boom",
    );

    const retry = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });
    listCalls[1]!.resolve(listResult(["flow-1"]));
    runsCalls[1]!.resolve(runsResult(["flow-1"]));
    await retry;
    expect(selectSavedWorkflowState(useSavedWorkflowStore.getState(), target).runsError).toBeNull();
    expect(selectSavedWorkflowState(useSavedWorkflowStore.getState(), target).runs).toHaveLength(1);
  });

  it("旧刷新后完成不得覆盖新刷新：旧代际结果被丢弃，loading 也不被旧代际清掉", async () => {
    const { service, listCalls, runsCalls } = createControlledService();
    // 旧刷新（bypass）先发起，但故意让它后完成。
    const stale = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });
    const fresh = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });

    // 新请求先完成（旧请求仍在途）。
    listCalls[1]!.resolve(listResult(["fresh"]));
    runsCalls[1]!.resolve(runsResult(["fresh"]));
    await fresh;
    let state = selectSavedWorkflowState(useSavedWorkflowStore.getState(), target);
    expect(state.entries.map((entry) => entry.name)).toEqual(["fresh"]);
    expect(state.loading).toBe(false);

    // 旧请求此刻才完成：内容与 loading 都不得被它改写。
    listCalls[0]!.resolve(listResult(["stale"]));
    runsCalls[0]!.resolve(runsResult(["stale"]));
    await stale;
    state = selectSavedWorkflowState(useSavedWorkflowStore.getState(), target);
    expect(state.entries.map((entry) => entry.name)).toEqual(["fresh"]);
    expect(state.runs.map((run) => run.name)).toEqual(["fresh"]);
    expect(state.loading).toBe(false);
  });

  it("旧代际失败同样不得把新代际的已加载数据改成错误", async () => {
    const { service, listCalls, runsCalls } = createControlledService();
    const stale = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });
    const fresh = useSavedWorkflowStore.getState().load(target, service, { bypassCache: true });
    listCalls[1]!.resolve(listResult(["fresh"]));
    runsCalls[1]!.resolve(runsResult(["fresh"]));
    await fresh;
    // 旧请求失败在新请求成功之后到达：不改变新状态。
    listCalls[0]!.reject(new Error("stale request failed"));
    runsCalls[0]!.reject(new Error("stale runs failed"));
    await stale.catch(() => undefined);
    const state = selectSavedWorkflowState(useSavedWorkflowStore.getState(), target);
    expect(state.error).toBeNull();
    expect(state.runsError).toBeNull();
    expect(state.entries.map((entry) => entry.name)).toEqual(["fresh"]);
  });

  it("非 bypass 的在途复用保留：同 key 并发只发一次请求", async () => {
    const { service, listCalls, runsCalls } = createControlledService();
    const first = useSavedWorkflowStore.getState().load(target, service);
    const second = useSavedWorkflowStore.getState().load(target, service);
    listCalls[0]!.resolve(listResult(["flow-1"]));
    runsCalls[0]!.resolve(runsResult(["flow-1"]));
    await Promise.all([first, second]);
    expect(service.listSavedWorkflows).toHaveBeenCalledTimes(1);
    expect(service.listSavedWorkflowRuns).toHaveBeenCalledTimes(1);
  });
});
