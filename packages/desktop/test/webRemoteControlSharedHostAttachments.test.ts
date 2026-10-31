import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWebRemoteControlSharedHostAttachments } from "../src/main/webRemoteControlSharedHostAttachments.js";

const { browserWindowMock } = vi.hoisted(() => ({
  browserWindowMock: {
    fromId: vi.fn(() => null),
  },
}));

vi.mock("electron", () => ({
  BrowserWindow: browserWindowMock,
  MessageChannelMain: vi.fn(),
}));

class MockUtilityProcess extends EventEmitter {
  kill = vi.fn();
  postMessage = vi.fn();
}

function createPortPair() {
  const port1 = { close: vi.fn(), start: vi.fn(), on: vi.fn(), off: vi.fn(), postMessage: vi.fn() };
  const port2 = { close: vi.fn(), start: vi.fn(), on: vi.fn(), off: vi.fn(), postMessage: vi.fn() };
  return { port1, port2 };
}

// v3.17.1 同步复核：上游退役了原 webRemoteControlSharedHostAttachments.test.ts 全文件，
// 本文件按 OW-P017 原触发场景（本地目录失效仍交付 Host attachment）重建回归。
describe("OW-P017：本地远控新建在目录失效时拒绝交付 Host attachment", () => {
  it("失效目录拒绝新建且不产生 attachment，历史可读，目录恢复后可重试", async () => {
    const root = await mkdtemp(join(tmpdir(), "remote-directory-"));
    const path = join(root, "workspace");
    const child = new MockUtilityProcess();
    const createMessageChannel = vi.fn(createPortPair);
    browserWindowMock.fromId.mockReturnValue({ id: 7, webContents: { id: 7 } });
    const manager = createWebRemoteControlSharedHostAttachments({
      windowHostProcessMap: new Map([[7, child as never]]),
      createMessageChannel: createMessageChannel as never,
      attachRemoteWorkspaceSessionHost: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    try {
      // OW-P017：过去 local 分支忽略 cwd，会在目录不存在时仍交付可新建的 Host port。
      await expect(
        manager.attachWorkspaceHost(7, { kind: "local", workspacePath: path }),
      ).rejects.toMatchObject({ code: "LOCAL_WORKSPACE_UNAVAILABLE" });
      expect(createMessageChannel).not.toHaveBeenCalled();
      expect(child.postMessage).not.toHaveBeenCalled();
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      const history = await manager.attachWorkspaceHost(7, {
        kind: "local",
        workspacePath: path,
        initialTaskId: "history",
      });
      manager.releaseAttachment(history.attachmentId);
      await writeFile(path, "file, not directory");
      await expect(
        manager.attachWorkspaceHost(7, { kind: "local", workspacePath: path }),
      ).rejects.toMatchObject({ code: "LOCAL_WORKSPACE_UNAVAILABLE" });
      await rm(path);
      await mkdir(path);
      const recovered = await manager.attachWorkspaceHost(7, {
        kind: "local",
        workspacePath: path,
      });
      expect(recovered.entryId).toBe("desktop-host:7");
      manager.releaseAttachment(recovered.attachmentId);
    } finally {
      manager.disposeWindow(7);
      await rm(root, { recursive: true, force: true });
    }
  });
});
