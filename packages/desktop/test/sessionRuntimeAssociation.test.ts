import { describe, expect, it } from "vitest";

import {
  collectTreeCliInstanceKeys,
  parseRuntimeProcessTable,
  runtimeInstanceKey,
  verifySameSessionRuntime,
  type RuntimeProcessIdentity,
  type SessionRuntimeFacts,
} from "./e2e/helpers/session-runtime-association.js";

// H1：同一会话同 runtime 实例的关联判定。
// 反例来自 2026-11-15 独立复核：两个独立 CLI 进程各自 ensureReady('same-session') 后
// generation 都是 1、state=ready、revision=2 —— generation 相等不能证明同一实例。

const facts = (overrides: Partial<SessionRuntimeFacts> = {}): SessionRuntimeFacts => ({
  sessionId: "sess-1",
  generation: "1",
  lifecycleState: "ready",
  runtimeInstanceKey: "4242@Fri Nov 15 14:43:09 2026",
  workspaceIdentity: "ws-identity-1",
  remoteSessionId: null,
  ...overrides,
});

it("同一实例：会话、实例标识、generation 与树内 CLI 集合都不变时通过", () => {
  const key = "4242@Fri Nov 15 14:43:09 2026";
  const failures = verifySameSessionRuntime({
    desktop: facts(),
    mobile: facts(),
    desktopInstanceKeyBeforeView: key,
    desktopInstanceKeyAfterView: key,
    treeCliInstanceKeysBefore: [key],
    treeCliInstanceKeysAfter: [key],
  });
  expect(failures).toEqual([]);
});

it("反例：generation/state 相同但实例标识不同，必须拒绝", () => {
  const failures = verifySameSessionRuntime({
    desktop: facts({ runtimeInstanceKey: "4242@Fri Nov 15 14:43:09 2026" }),
    mobile: facts({ runtimeInstanceKey: "5150@Fri Nov 15 14:50:00 2026" }),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:43:09 2026",
    treeCliInstanceKeysBefore: ["4242@Fri Nov 15 14:43:09 2026"],
    treeCliInstanceKeysAfter: ["4242@Fri Nov 15 14:43:09 2026", "5150@Fri Nov 15 14:50:00 2026"],
  });
  const codes = failures.map((failure) => failure.code);
  expect(codes).toContain("instance-mismatch");
  expect(codes).toContain("cli-instance-added");
});

it("反例：同一 PID 换了实例（启动时间不同）也拒绝", () => {
  // PID 复用：pid 相同但 startedAt 不同 ⇒ 不同实例。
  expect(runtimeInstanceKey({ pid: 4242, startedAt: "Fri Nov 15 14:43:09 2026" })).not.toBe(
    runtimeInstanceKey({ pid: 4242, startedAt: "Fri Nov 15 18:02:11 2026" }),
  );
  const failures = verifySameSessionRuntime({
    desktop: facts({ runtimeInstanceKey: "4242@Fri Nov 15 14:43:09 2026" }),
    mobile: facts({ runtimeInstanceKey: "4242@Fri Nov 15 18:02:11 2026" }),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:43:09 2026",
    treeCliInstanceKeysBefore: [],
    treeCliInstanceKeysAfter: [],
  });
  expect(failures.map((failure) => failure.code)).toContain("instance-mismatch");
});

it("反例：空实例标识的空匹配不能当通过", () => {
  const failures = verifySameSessionRuntime({
    desktop: facts({ runtimeInstanceKey: null }),
    mobile: facts({ runtimeInstanceKey: null }),
    desktopInstanceKeyBeforeView: null,
    desktopInstanceKeyAfterView: null,
    treeCliInstanceKeysBefore: [],
    treeCliInstanceKeysAfter: [],
  });
  const codes = failures.map((failure) => failure.code);
  expect(codes).toContain("instance-key-missing");
  expect(codes).toContain("instance-key-missing-around-view");
});

it("反例：查看期间会话 runtime 被重启/替换", () => {
  const failures = verifySameSessionRuntime({
    desktop: facts(),
    mobile: facts(),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:50:00 2026",
    treeCliInstanceKeysBefore: ["4242@Fri Nov 15 14:43:09 2026"],
    treeCliInstanceKeysAfter: ["4242@Fri Nov 15 14:50:00 2026"],
  });
  const codes = failures.map((failure) => failure.code);
  expect(codes).toContain("instance-changed-during-view");
  expect(codes).toContain("cli-instance-added");
  expect(codes).toContain("cli-instance-removed");
});

it("反例：不同会话、不同 workspace identity、缺 generation 都拒绝", () => {
  const mismatched = verifySameSessionRuntime({
    desktop: facts(),
    mobile: facts({ sessionId: "sess-2" }),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:43:09 2026",
    treeCliInstanceKeysBefore: [],
    treeCliInstanceKeysAfter: [],
  });
  expect(mismatched.map((failure) => failure.code)).toContain("session-mismatch");

  const identity = verifySameSessionRuntime({
    desktop: facts(),
    mobile: facts({ workspaceIdentity: "ws-identity-2" }),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:43:09 2026",
    treeCliInstanceKeysBefore: [],
    treeCliInstanceKeysAfter: [],
  });
  expect(identity.map((failure) => failure.code)).toContain("workspace-identity-mismatch");

  const generation = verifySameSessionRuntime({
    desktop: facts({ generation: null }),
    mobile: facts({ generation: null }),
    desktopInstanceKeyBeforeView: "4242@Fri Nov 15 14:43:09 2026",
    desktopInstanceKeyAfterView: "4242@Fri Nov 15 14:43:09 2026",
    treeCliInstanceKeysBefore: [],
    treeCliInstanceKeysAfter: [],
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
