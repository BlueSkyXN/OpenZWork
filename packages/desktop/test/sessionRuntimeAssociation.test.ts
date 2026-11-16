import { describe, expect, it } from "vitest";

import {
  collectTreeCliInstanceKeys,
  parseRuntimeProcessTable,
  runtimeInstanceKey,
  verifySameSessionRuntime,
  type SessionRuntimeFacts,
} from "./e2e/helpers/session-runtime-association.js";

// H1：同一会话同 runtime 实例的关联判定。
// 反例来自 2026-11-15 独立复核：两个独立 CLI 进程各自 ensureReady('same-session') 后
// generation 都是 1、state=ready、revision=2 —— generation 相等不能证明同一实例。
//
// 2026-11-16 实跑修订（run desktop-e2e-20261115-235558-369）：树内短命 worker 以约
// 10 个/秒生死更替（6s 窗口 10 进 8 出），「树内集合严格相等」会把合法懒启动误判为
// 实例替换。判定改为：会话 runtime 必须是跨窗口稳定实例（同 pid@lstart 存活于查看
// 前后）；窗口内新增且收尾仍存活的实例是唯一能承载「为手机另起会话 CLI」的形态，
// 直接拒绝；瞬态进出由调用方记录为懒启动证据，不参与判定。

const KEY_A = "4242@Fri Nov 15 14:43:09 2026";
const KEY_B = "5150@Fri Nov 15 14:50:00 2026";
const KEY_PID_REUSE = "4242@Fri Nov 15 18:02:11 2026";

const facts = (overrides: Partial<SessionRuntimeFacts> = {}): SessionRuntimeFacts => ({
  sessionId: "sess-1",
  generation: "1",
  lifecycleState: "ready",
  runtimeInstanceKey: KEY_A,
  workspaceIdentity: "ws-identity-1",
  remoteSessionId: null,
  ...overrides,
});

describe("session runtime 实例关联判定", () => {
  it("同一实例：会话、实例标识、generation 与稳定实例都不变时通过", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts(),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(failures).toEqual([]);
  });

  it("反例：generation/state 相同但实例标识不同，必须拒绝", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts({ runtimeInstanceKey: KEY_B }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(failures.map((failure) => failure.code)).toContain("instance-mismatch");
  });

  it("反例：同一 PID 换了实例（启动时间不同）也拒绝", () => {
    // PID 复用：pid 相同但 startedAt 不同 ⇒ 不同实例。
    expect(runtimeInstanceKey({ pid: 4242, startedAt: "Fri Nov 15 14:43:09 2026" })).not.toBe(
      runtimeInstanceKey({ pid: 4242, startedAt: "Fri Nov 15 18:02:11 2026" }),
    );
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts({ runtimeInstanceKey: KEY_PID_REUSE }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [],
      endInstanceKeys: [KEY_A],
    });
    expect(failures.map((failure) => failure.code)).toContain("instance-mismatch");
  });

  it("反例：空实例标识的空匹配不能当通过", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts({ runtimeInstanceKey: null }),
      mobile: facts({ runtimeInstanceKey: null }),
      desktopInstanceKeyBeforeView: null,
      desktopInstanceKeyAfterView: null,
      stableInstanceKeys: [],
      endInstanceKeys: [],
    });
    const codes = failures.map((failure) => failure.code);
    expect(codes).toContain("instance-key-missing");
    expect(codes).toContain("instance-key-missing-around-view");
    expect(codes).toContain("stable-instance-missing");
  });

  it("反例：查看期间会话实例被重启/替换（同 pid 新启动时间）", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts(),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_PID_REUSE,
      stableInstanceKeys: [],
      endInstanceKeys: [KEY_A],
    });
    expect(failures.map((failure) => failure.code)).toContain("instance-changed-during-view");
  });

  it("合法懒启动：窗口内短命 worker 进出不影响判定（瞬态进出由调用方记录）", () => {
    // 实测形态（run desktop-e2e-20261115-235558-369）：6s 窗口 10 进 8 出。
    // 短命 worker 生命期盖不住窗口，不可能服务两端，也不构成实例替换。
    const shared = "63685@Mon Nov 16 07:56:59 2026";
    const failures = verifySameSessionRuntime({
      desktop: facts({ runtimeInstanceKey: shared }),
      mobile: facts({ runtimeInstanceKey: shared }),
      desktopInstanceKeyBeforeView: shared,
      desktopInstanceKeyAfterView: shared,
      stableInstanceKeys: [shared, "63686@Mon Nov 16 07:56:59 2026"],
      endInstanceKeys: [shared, "63686@Mon Nov 16 07:56:59 2026", "70000@Mon Nov 16 07:57:01 2026"],
    });
    // 70000 是窗口内新增、收尾仍存活的其他 lane worker：合法懒启动，不影响判定。
    expect(failures).toEqual([]);
  });

  it("反例：稳定实例在收尾前消失（会话 runtime 被替换的唯一可行形态）必须拒绝", () => {
    // chat/plugin lane 按 workspaceKey 单活且无空闲回收：为手机另起会话 CLI 只能替换
    // 原实例，表现为稳定成员消失；其他 lane 的持久 worker 不影响判定。
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts(),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: ["99999@Mon Nov 16 07:57:30 2026"],
    });
    const codes = failures.map((failure) => failure.code);
    expect(codes).toContain("stable-instance-lost");
    expect(failures.find((failure) => failure.code === "stable-instance-lost")?.detail).toContain(
      KEY_A,
    );
  });

  it("本地 workspace 两侧 identity 都为空是合法状态（key 回落路径），不算缺失", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts({ workspaceIdentity: null }),
      mobile: facts({ workspaceIdentity: null }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(failures).toEqual([]);
  });

  it("反例：单侧缺 workspace identity 也拒绝（不能只比相等）", () => {
    const failures = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts({ workspaceIdentity: null }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(failures.map((failure) => failure.code)).toContain("workspace-identity-mismatch");
  });

  it("反例：不同会话、不同 workspace identity、缺 generation 都拒绝", () => {
    const mismatched = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts({ sessionId: "sess-2" }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(mismatched.map((failure) => failure.code)).toContain("session-mismatch");

    const identity = verifySameSessionRuntime({
      desktop: facts(),
      mobile: facts({ workspaceIdentity: "ws-identity-2" }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(identity.map((failure) => failure.code)).toContain("workspace-identity-mismatch");

    const generation = verifySameSessionRuntime({
      desktop: facts({ generation: null }),
      mobile: facts({ generation: null }),
      desktopInstanceKeyBeforeView: KEY_A,
      desktopInstanceKeyAfterView: KEY_A,
      stableInstanceKeys: [KEY_A],
      endInstanceKeys: [KEY_A],
    });
    expect(generation.map((failure) => failure.code)).toContain("generation-missing");
  });

  it("解析 ps 表并只取本 run 树内的 CLI 实例", () => {
    const table = [
      "  100     1 Fri Nov 15 14:00:00 2026 /Applications/OpenZWork.app/Contents/MacOS/OpenZWork",
      "  200   100 Fri Nov 15 14:43:09 2026 zcode-host-local-1",
      "  300   200 Fri Nov 15 14:43:09 2026 zcode-cli",
      "  400   200 Fri Nov 15 14:44:00 2026 zcode-cli",
      "  900     1 Fri Nov 15 09:00:00 2026 zcode-cli",
    ].join("\n");
    const parsed = parseRuntimeProcessTable(table);
    expect(parsed).toHaveLength(5);
    expect(parsed[2].pid).toBe(300);
    expect(parsed[2].startedAt).toBe("Fri Nov 15 14:43:09 2026");

    const inTree = collectTreeCliInstanceKeys(parsed, 100);
    // 只含树内两个 CLI，不含树外 pid 900；标识带启动时间。
    expect(inTree).toEqual(["300@Fri Nov 15 14:43:09 2026", "400@Fri Nov 15 14:44:00 2026"]);
  });

  it("解析器忽略标题行与非法行，不因格式差异误判", () => {
    const parsed = parseRuntimeProcessTable(
      [
        "  PID  PPID STARTED COMMAND",
        "",
        "garbage line",
        "  12  1 Fri Nov 15 14:43:09 2026 zcode-cli",
      ].join("\n"),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pid).toBe(12);
  });
});
