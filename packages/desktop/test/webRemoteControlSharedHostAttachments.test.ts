import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HostMessageTypes } from "@zcode/shared";
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

describe("createWebRemoteControlSharedHostAttachments", () => {
  it("attaches a local bridge to the existing desktop host process", async () => {
    const child = new MockUtilityProcess();
    const ports = createPortPair();
    browserWindowMock.fromId.mockReturnValueOnce({
      id: 7,
      webContents: { id: 99 },
    });
    const manager = createWebRemoteControlSharedHostAttachments({
      windowHostProcessMap: new Map([[99, child as never]]),
      createMessageChannel: () => ports as never,
      attachRemoteWorkspaceSessionHost: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const attachment = await manager.attachWorkspaceHost(7, {
      kind: "local",
      workspacePath: tmpdir(),
    });

    expect(attachment.entryId).toBe("desktop-host:7");
    expect(attachment.attachmentId).toMatch(/^shared-host-attachment-/);
    expect(attachment.process).toBe(child);
    expect(attachment.port).toBe(ports.port1);
    expect(child.postMessage).toHaveBeenCalledWith(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: expect.any(String),
        attachmentId: attachment.attachmentId,
        clientMode: "web-remote-replayable",
        scope: { kind: "local" },
      },
      [ports.port2],
    );

    manager.releaseAttachment(attachment.attachmentId);
    expect(ports.port1.close).toHaveBeenCalledTimes(1);
  });

  it("throws desktop-disconnected when the desktop host is missing", async () => {
    const manager = createWebRemoteControlSharedHostAttachments({
      windowHostProcessMap: new Map(),
      createMessageChannel: createPortPair as never,
      attachRemoteWorkspaceSessionHost: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      manager.attachWorkspaceHost(7, {
        kind: "local",
        workspacePath: tmpdir(),
      }),
    ).rejects.toMatchObject({ code: "DESKTOP_HOST_MISSING" });
  });

  it("rejects remote attach without workspaceIdentity", async () => {
    const attachRemoteWorkspaceSessionHost = vi.fn();
    const manager = createWebRemoteControlSharedHostAttachments({
      windowHostProcessMap: new Map(),
      createMessageChannel: createPortPair as never,
      attachRemoteWorkspaceSessionHost,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      manager.attachWorkspaceHost(7, {
        kind: "remote",
        workspacePath: "/repo/demo",
        remoteSessionId: "remote-session-1",
      }),
    ).rejects.toMatchObject({ code: "REMOTE_WORKSPACE_IDENTITY_MISSING" });
    expect(attachRemoteWorkspaceSessionHost).not.toHaveBeenCalled();
  });

  it("OW-P017：失效目录拒绝新建且不产生 attachment，历史可读，目录恢复后可重试", async () => {
    const root = await mkdtemp(join(tmpdir(), "remote-directory-"));
    const path = join(root, "workspace");
    const child = new MockUtilityProcess();
    const createMessageChannel = vi.fn(createPortPair);
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

  it("WPL-012 reuses one remote Window Host and releases only the mobile attachment port", async () => {
    const child = new MockUtilityProcess();
    const ports = createPortPair();
    const attachRemoteWorkspaceSessionHost = vi.fn(() => ({
      process: child as never,
      port: ports.port1 as never,
      remoteKind: "ssh" as const,
    }));
    const manager = createWebRemoteControlSharedHostAttachments({
      windowHostProcessMap: new Map(),
      createMessageChannel: createPortPair as never,
      attachRemoteWorkspaceSessionHost,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const attachment = await manager.attachWorkspaceHost(7, {
      kind: "remote",
      workspacePath: "/workspace",
      workspaceIdentity: "remote:ssh:host:22:user:/workspace",
      remoteSessionId: "remote-session-1",
      initialTaskId: "task-1",
    });

    expect(attachRemoteWorkspaceSessionHost).toHaveBeenCalledTimes(1);
    expect(attachRemoteWorkspaceSessionHost).toHaveBeenCalledWith({
      windowId: 7,
      remoteSessionId: "remote-session-1",
      workspacePath: "/workspace",
      workspaceIdentity: "remote:ssh:host:22:user:/workspace",
      workspaceKey: "remote:ssh:host:22:user:/workspace",
      clientMode: "web-remote-replayable",
    });
    expect(attachment).toMatchObject({
      entryId: "remote-session-host:remote-session-1",
      process: child,
      port: ports.port1,
      remoteKind: "ssh",
    });

    manager.releaseAttachment(attachment.attachmentId);
    expect(ports.port1.close).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
