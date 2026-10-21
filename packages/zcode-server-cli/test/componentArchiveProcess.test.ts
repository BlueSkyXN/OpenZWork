import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn,
}));
import { extractArchiveSafely } from "../src/runtime/componentCache.js";

beforeEach(() => {
  spawn.mockReset();
});

it.each([
  "lrwxrwxrwx user/group 0 2026-01-01 ./runtime -> /outside",
  "hrw-r--r-- user/group 0 2026-01-01 ./runtime link to /outside",
])("waits for tar stdout before rejecting %s without extraction", async (listing) => {
  spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const output = args[0] === "-tvzf" ? `${listing}\n` : "./runtime\n";
    // 子进程退出时管道可能尚未读完；必须等 close 才能依赖完整的安全校验输入。
    queueMicrotask(() => {
      child.emit("exit", 0);
      setImmediate(() => {
        child.stdout.end(output);
        child.stderr.end();
        child.emit("close", 0);
      });
    });
    return child;
  });
  await expect(extractArchiveSafely("fixture.tar.gz", "/isolated")).rejects.toThrow(
    /symbolic|hard link/i,
  );
  expect(spawn.mock.calls.map((call) => call[1][0])).toEqual(["-tzf", "-tvzf"]);
});
