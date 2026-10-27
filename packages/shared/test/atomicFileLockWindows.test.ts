import { mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireFileLock, withFileLock } from "@zcode/shared/node";

const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    mkdir: vi.fn(fs.mkdir),
    stat: vi.fn(fs.stat),
    readdir: vi.fn(fs.readdir),
    writeFile: vi.fn(fs.writeFile),
    rm: vi.fn(fs.rm),
    rmdir: vi.fn(fs.rmdir),
  };
});
vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: vi.fn(async (delay: number) => {
    clock.now += delay;
  }),
}));

const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
let directory: string;
let filePath: string;
let lockPath: string;

function error(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`mkdir ${code}`), { code, path: lockPath, syscall: "mkdir" });
}
function platform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { ...originalPlatform, value });
}
function lockAttempts() {
  return vi.mocked(mkdir).mock.calls.filter(([path]) => String(path) === lockPath).length;
}
function failLockCreation(failures: NodeJS.ErrnoException[], persistent?: NodeJS.ErrnoException) {
  vi.mocked(mkdir).mockImplementation(async (...args) => {
    if (String(args[0]) === lockPath) {
      const failure = failures.shift() ?? persistent;
      if (failure) throw failure;
    }
    return fs.mkdir(...args);
  });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "file-lock-windows-"));
  filePath = join(directory, "provider_config.json");
  lockPath = `${filePath}.lock`;
  clock.now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  platform("win32");
  vi.mocked(mkdir).mockReset().mockImplementation(fs.mkdir);
  vi.mocked(stat).mockReset().mockImplementation(fs.stat);
  vi.mocked(readdir).mockReset().mockImplementation(fs.readdir);
  vi.mocked(writeFile).mockReset().mockImplementation(fs.writeFile);
  vi.mocked(rm).mockClear();
  vi.mocked(rmdir).mockClear();
  vi.mocked(sleep).mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", originalPlatform);
  await fs.rm(directory, { recursive: true, force: true });
});

describe("OW-P019：Windows 锁目录创建的 EPERM", () => {
  it.each([1, 3])("连续 %i 次创建受阻后恢复，取得真实 owner 才进入写操作", async (count) => {
    // OW-P019：原实现把 Windows mkdir EPERM 直接抛出，双进程配置写入会提前失败。
    failLockCreation(Array.from({ length: count }, () => error("EPERM")));
    let entered = 0;
    await withFileLock(
      filePath,
      async () => {
        entered++;
        const owners = await fs.readdir(lockPath);
        expect(owners).toHaveLength(1);
        expect(JSON.parse(await readFile(join(lockPath, owners[0]!), "utf8"))).toMatchObject({
          pid: process.pid,
        });
        await fs.writeFile(filePath, "saved");
      },
      { lockRetryDelaysMs: [5], lockMaxWaitMs: 100 },
    );
    expect(entered).toBe(1);
    expect(lockAttempts()).toBe(count + 1);
    expect(await readFile(filePath, "utf8")).toBe("saved");
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("持续 EPERM 按原预算结束，不读取、回收锁或调用配置操作，并保留原错误", async () => {
    const denied = error("EPERM");
    failLockCreation([], denied);
    const startedAt = clock.now;
    const operation = vi.fn();
    await expect(
      withFileLock(filePath, operation, { lockRetryDelaysMs: [10], lockMaxWaitMs: 25 }),
    ).rejects.toBe(denied);
    expect(clock.now - startedAt).toBe(25);
    expect(vi.mocked(sleep).mock.calls.map(([delay]) => delay)).toEqual([10, 10, 5]);
    expect(lockAttempts()).toBe(3);
    expect(operation).not.toHaveBeenCalled();
    for (const call of [stat, readdir, rm, rmdir, writeFile]) expect(call).not.toHaveBeenCalled();
    // 失败释放原进程 FIFO；权限恢复后的调用必须能正常取得锁。
    failLockCreation([]);
    await withFileLock(filePath, async () => {
      operation();
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it.each([
    { delays: [] as number[], budget: 100 },
    { delays: [10], budget: 0 },
  ])("禁用等待时保持原始错误和单次尝试：%j", async ({ delays, budget }) => {
    const denied = error("EPERM");
    failLockCreation([], denied);
    await expect(acquireFileLock(filePath, delays, 100, budget)).rejects.toBe(denied);
    expect(lockAttempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(["EACCES", "ENOENT", "ENOSPC"])("其他 mkdir 错误 %s 仍立即返回", async (code) => {
    const denied = error(code);
    failLockCreation([], denied);
    await expect(acquireFileLock(filePath, [10], 100, 50)).rejects.toBe(denied);
    expect(lockAttempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux"] as const)("%s 的 EPERM 不进入 Windows 分支", async (os) => {
    platform(os);
    const denied = error("EPERM");
    failLockCreation([], denied);
    await expect(acquireFileLock(filePath, [10], 100, 50)).rejects.toBe(denied);
    expect(lockAttempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("mkdir 成功后的 owner 写入 EPERM 不重试，清理本次空目录", async () => {
    const denied = Object.assign(error("EPERM"), { syscall: "open" });
    vi.mocked(writeFile).mockRejectedValueOnce(denied);
    await expect(acquireFileLock(filePath, [10], 100, 50)).rejects.toBe(denied);
    expect(lockAttempts()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("EPERM 后遇到现存活 owner，按正常竞争超时，不能抢占或删除其他 owner", async () => {
    await fs.mkdir(lockPath);
    const ownerPath = join(lockPath, "owner-existing.json");
    const owner = JSON.stringify({
      pid: process.pid,
      createdAt: clock.now - 60_000,
      token: "existing",
    });
    await fs.writeFile(ownerPath, owner);
    failLockCreation([error("EPERM")]);
    await expect(acquireFileLock(filePath, [10], 0, 30)).rejects.toMatchObject({
      code: "ZCODE_FILE_LOCK_TIMEOUT",
    });
    expect(await fs.readFile(ownerPath, "utf8")).toBe(owner);
    expect(rm).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
  });
});
