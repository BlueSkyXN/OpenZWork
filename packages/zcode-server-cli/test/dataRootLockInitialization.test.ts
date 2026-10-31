import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataRootLock } from "../src/runtime/lock.js";

// v3.17.1 同步复核：上游退役了原 lock.test.ts 全文件，
// 本文件按 OW-P014 原触发场景（初始化空锁文件被竞争者回收）重建回归。
const lockIo = vi.hoisted(() => ({ afterCreate: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      await lockIo.afterCreate(...args);
      return handle;
    },
  };
});
afterEach(() => lockIo.afterCreate.mockReset());

// 超出常见平台 pid 上限的值：process.kill(pid, 0) 必然 ESRCH，模拟已死的持锁进程。
const DEAD_PID = 2 ** 30;

describe("OW-P014：数据目录锁初始化空文件不被竞争者回收", () => {
  for (const stale of [false, true]) {
    it(`protects initializing ownership during ${stale ? "stale recovery" : "first acquisition"}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "zcode-lock-initializing-"));
      const lockFile = join(root, "server.lock");
      if (stale) await writeFile(lockFile, JSON.stringify({ pid: DEAD_PID }));
      let signalCreated!: () => void;
      let resume!: () => void;
      const created = new Promise<void>((resolve) => {
        signalCreated = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      lockIo.afterCreate.mockImplementation(async (path) => {
        if (String(path) !== lockFile) return;
        lockIo.afterCreate.mockReset();
        signalCreated();
        await paused;
      });
      const first = new DataRootLock(lockFile);
      const second = new DataRootLock(lockFile);
      const acquiring = first.acquire();
      try {
        await created;
        // OW-P014：精确暂停 open(wx) 后的空文件窗口，旧实现会让第二个 owner 回收并成功占用。
        await expect(second.acquire()).rejects.toThrow(/already running/);
        resume();
        await acquiring;
        expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({ pid: process.pid });
      } finally {
        resume();
        await acquiring.catch(() => undefined);
        await second.release();
        await first.release();
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  it("stale recovery keeps ownerToken protection against a live rival", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-lock-stale-"));
    const lockFile = join(root, "server.lock");
    try {
      await writeFile(lockFile, `${JSON.stringify({ pid: DEAD_PID, acquiredAt: 0 })}\n`, "utf8");
      const lock = new DataRootLock(lockFile);
      await lock.acquire();
      expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({ pid: process.pid });
      const rival = new DataRootLock(lockFile);
      await expect(rival.acquire()).rejects.toThrow(/already running/);
      await rival.release();
      await lock.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
