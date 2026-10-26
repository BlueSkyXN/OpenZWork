import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { isZCodeFileLockTimeoutError } from "@zcode/shared";
import { acquireFileLock } from "@zcode/shared/node";

export type DataRootLockInspection =
  | { state: "missing" }
  | { state: "active"; pid: number }
  | { state: "stale"; pid: number }
  | { state: "invalid" }
  | { state: "unreadable"; error: unknown };

export class DataRootLock {
  private handle: FileHandle | undefined;
  private ownerToken: string | undefined;
  public constructor(private readonly path: string) {}

  public async inspect(): Promise<DataRootLockInspection> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { state: "missing" };
      }
      return { state: "unreadable", error };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { state: "invalid" };
    }
    const pid =
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0
        ? parsed.pid
        : undefined;
    if (pid === undefined) return { state: "invalid" };
    return this.isHolderAlive(pid) ? { state: "active", pid } : { state: "stale", pid };
  }

  public async acquire(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let releaseRecovery: () => Promise<void>;
    try {
      // OW-P014：首次建锁与陈旧恢复都必须受同一门闩保护，防止空文件被误当成损坏 owner 回收。
      // 共享工具以唯一 owner 目录校验实例；沿用 5ms 间隔及原 100 次重试对应的等待预算。
      releaseRecovery = await acquireFileLock(`${this.path}.recovery`, [5], 100, 500);
    } catch (error) {
      if (isZCodeFileLockTimeoutError(error)) {
        throw new Error("Another ZCode Server instance is already running", { cause: error });
      }
      throw error;
    }
    try {
      if (await this.tryAcquireOnce()) return;
      const current = await this.readOwner(this.path);
      if (current && this.isHolderAlive(current.record.pid)) {
        throw new Error("Another ZCode Server instance is already running");
      }
      if (current) await this.claimStalePath(this.path, current.raw);
      if (await this.tryAcquireOnce()) return;
      throw new Error("Another ZCode Server instance is already running");
    } finally {
      await releaseRecovery();
    }
  }

  public async release(): Promise<void> {
    await this.handle?.close().catch(() => undefined);
    this.handle = undefined;
    const token = this.ownerToken;
    this.ownerToken = undefined;
    if (token) await this.releaseOwnedPath(this.path, token);
  }

  private async tryAcquireOnce(): Promise<boolean> {
    const ownerToken = randomUUID();
    let handle: FileHandle | undefined;
    try {
      handle = await open(this.path, "wx", 0o600);
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), ownerToken })}\n`,
      );
      this.handle = handle;
      this.ownerToken = ownerToken;
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
      await handle?.close().catch(() => undefined);
      const observed = await this.readOwner(this.path);
      if (observed?.record.ownerToken === ownerToken) {
        await this.releaseOwnedPath(this.path, ownerToken);
      }
      throw error;
    }
  }

  private async readOwner(path: string): Promise<{
    raw: string;
    record: { ownerToken?: string; pid?: number };
  } | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { ownerToken?: unknown; pid?: unknown };
      return {
        raw,
        record: {
          ownerToken: typeof parsed.ownerToken === "string" ? parsed.ownerToken : undefined,
          pid:
            typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
              ? parsed.pid
              : undefined,
        },
      };
    } catch {
      return { raw, record: {} };
    }
  }

  public isHolderAlive(pid: number | undefined): boolean {
    if (pid === undefined) return false;
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      // ESRCH 表示进程不存在（stale）；EPERM 表示进程存在但无权限，保守视为存活。
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  }

  private async claimStalePath(path: string, expectedRaw: string): Promise<void> {
    const quarantine = `${path}.stale-${process.pid}-${randomUUID()}`;
    try {
      await rename(path, quarantine);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const claimedRaw = await readFile(quarantine, "utf8").catch(() => null);
    if (claimedRaw === expectedRaw) {
      await rm(quarantine, { force: true });
      return;
    }
    // 陈旧观察误 claim 了后来者时必须恢复，不能删除新 owner 的 lock。
    await rename(quarantine, path).catch(() => undefined);
  }

  private async releaseOwnedPath(path: string, ownerToken: string): Promise<void> {
    const observed = await this.readOwner(path);
    if (observed?.record.ownerToken !== ownerToken) return;
    const quarantine = `${path}.release-${process.pid}-${randomUUID()}`;
    try {
      await rename(path, quarantine);
    } catch {
      return;
    }
    const claimed = await this.readOwner(quarantine);
    if (claimed?.record.ownerToken === ownerToken) {
      await rm(quarantine, { force: true });
      return;
    }
    await rename(quarantine, path).catch(() => undefined);
  }
}
