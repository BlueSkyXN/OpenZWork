import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { execFileMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: execFileMock,
  spawnSync: spawnSyncMock,
}));
import {
  captureProcessTreeSnapshot,
  captureProcessTreeSnapshotAsync,
  terminateProcessTreeAndWait,
} from "../src/process/processTreeTerminator.js";

const epochTicks = 621_355_968_000_000_000n;
const start = Date.UTC(2026, 9, 21);
const entries = [
  [4242, 1, start],
  [5000, 4242, start + 1000],
  [5001, 5000, start + 2000],
  // 旧进程的历史 PPID 恰好等于新 root，整支都必须排除。
  [6000, 4242, start - 1000],
  [6001, 6000, start + 2000],
  // 同一规则也用于孙节点，不能只检查相对 root 的时间。
  [7000, 5000, start + 500],
  [7001, 7000, start + 2000],
] as const;
let alive: Set<number>;
let child: ChildProcess;
function processTable(pid?: number): string {
  return entries
    .filter(([id]) => alive.has(id) && (pid === undefined || id === pid))
    .map(([id, parent, created]) => `${id} ${parent} ${epochTicks + BigInt(created) * 10000n}\n`)
    .join("");
}
beforeEach(() => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  alive = new Set(entries.map(([pid]) => pid));
  child = Object.assign(new EventEmitter(), {
    pid: 4242,
    exitCode: null,
    signalCode: null,
  }) as ChildProcess;
  vi.spyOn(process, "kill").mockImplementation((pid) => {
    if (alive.has(Number(pid))) return true;
    throw Object.assign(new Error("not running"), { code: "ESRCH" });
  });
  spawnSyncMock.mockReset().mockImplementation(() => ({ status: 0, stdout: processTable() }));
  execFileMock.mockReset().mockImplementation((command, args, _options, callback) => {
    if (command === "powershell.exe") {
      const match = /ProcessId = (\d+)/u.exec(args.join(" "));
      callback(null, processTable(match ? Number(match[1]) : undefined), "");
    } else {
      const pid = Number(args[1]);
      alive.delete(pid);
      if (pid === child.pid) {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }
      callback(null, "", "");
    }
    return {};
  });
});
afterEach(() => vi.restoreAllMocks());

it.each(["sync", "async"])(
  "%s snapshot rejects historical PPID edges at every generation",
  async (mode) => {
    const snapshot =
      mode === "sync"
        ? captureProcessTreeSnapshot(child)
        : await captureProcessTreeSnapshotAsync(child);
    expect(snapshot?.identities.map(({ pid }) => pid)).toEqual([4242, 5000, 5001]);
    expect(snapshot?.descendantPids).toEqual([5000, 5001]);
  },
);

it.each([false, true])(
  "cleans verified PIDs without expanding historical PPID links (root exited: %s)",
  async (rootExited) => {
    const snapshot = await captureProcessTreeSnapshotAsync(child);
    if (rootExited) {
      child.exitCode = 0;
      alive.delete(4242);
    }
    await expect(
      terminateProcessTreeAndWait(child, {
        snapshot,
        forceAfterMs: 1000,
        windowsTaskkillTimeoutMs: 100,
      }),
    ).resolves.toEqual({ remainingPids: [] });
    const commands = execFileMock.mock.calls.filter(([command]) => command === "taskkill");
    expect(new Set(commands.map(([, args]) => Number(args[1])))).toEqual(
      new Set(rootExited ? [5000, 5001] : [4242, 5000, 5001]),
    );
    expect(commands.every(([, args]) => !args.includes("/T"))).toBe(true);
    expect([...alive]).toEqual([6000, 6001, 7000, 7001]);
  },
);
