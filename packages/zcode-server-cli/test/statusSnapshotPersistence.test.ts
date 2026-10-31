import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStatusPersister } from "../src/runtime/statusSnapshot.js";

// v3.17.1 同步复核：上游退役了原 supervisor.test.ts 全文件，
// 本文件按 OW-P013 原触发场景（Windows 原子替换短暂共享占用丢失最终 stopped 快照）重建回归。
const statusIo = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const error = await statusIo.rename(...args);
      if (error) throw error;
      return actual.rename(...args);
    },
  };
});
afterEach(() => statusIo.rename.mockReset());

const canWrite = async () => true;

describe("OW-P013：Supervisor 最终状态在原子替换暂时失败后仍持久化", () => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) {
    it(`transient ${code} replacement failure still persists stopped`, async () => {
      const root = await mkdtemp(join(tmpdir(), "zstatus-"));
      const path = join(root, "status.json");
      const onError = vi.fn();
      try {
        await writeFile(path, JSON.stringify({ state: "ready" }));
        // OW-P013：精确注入 Windows 原子替换的共享占用，旧实现只 rename 一次会丢失最终 stopped 快照。
        statusIo.rename.mockReturnValueOnce(Object.assign(new Error("shared file"), { code }));
        await createStatusPersister(path, () => ({ state: "stopped" }), onError, canWrite)();
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ state: "stopped" });
        expect(onError).not.toHaveBeenCalled();
        expect(statusIo.rename).toHaveBeenCalledTimes(2);
        expect(await readdir(root)).toEqual(["status.json"]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  it("persistent sharing failure preserves the snapshot and later writes recover", async () => {
    const root = await mkdtemp(join(tmpdir(), "zstatus-"));
    const path = join(root, "status.json");
    const onError = vi.fn();
    const error = Object.assign(new Error("still shared"), { code: "EPERM" });
    const persist = createStatusPersister(path, () => ({ state: "stopped" }), onError, canWrite);
    try {
      await writeFile(path, JSON.stringify({ state: "ready" }));
      statusIo.rename.mockReturnValue(error);
      await persist();
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
      expect(statusIo.rename).toHaveBeenCalledTimes(6);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ state: "ready" });
      expect(await readdir(root)).toEqual(["status.json"]);
      statusIo.rename.mockReset();
      await persist();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ state: "stopped" });
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      statusIo.rename.mockReset();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("non-retryable failure reports once and cleans the temporary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "zstatus-"));
    const path = join(root, "status.json");
    const onError = vi.fn();
    const error = Object.assign(new Error("IO failure"), { code: "EIO" });
    try {
      await writeFile(path, JSON.stringify({ state: "ready" }));
      statusIo.rename.mockReturnValueOnce(error);
      await createStatusPersister(path, () => ({ state: "stopped" }), onError, canWrite)();
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
      expect(statusIo.rename).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ state: "ready" });
      expect(await readdir(root)).toEqual(["status.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("queued writes sample the next state only after the blocked replacement completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "zstatus-"));
    const path = join(root, "status.json");
    const onError = vi.fn();
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let revision = 0;
    const getStatus = vi.fn(() => ({ revision: ++revision }));
    const persist = createStatusPersister(path, getStatus, onError, canWrite);
    statusIo.rename.mockImplementationOnce(async () => {
      signalEntered();
      await gate;
      return Object.assign(new Error("shared file"), { code: "EBUSY" });
    });
    const first = persist();
    await entered;
    const second = persist();
    try {
      expect(getStatus).toHaveBeenCalledTimes(1);
      release();
      await Promise.all([first, second]);
      expect(getStatus).toHaveBeenCalledTimes(2);
      expect(statusIo.rename).toHaveBeenCalledTimes(3);
      expect(onError).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ revision: 2 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
