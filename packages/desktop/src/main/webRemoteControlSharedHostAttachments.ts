import { BrowserWindow, MessageChannelMain } from "electron";
import { stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from "electron";
import { HostMessageTypes, type RemoteWorkspaceIdentityKind } from "@zcode/shared";

type WebRemoteControlSharedHostKind = "local" | "remote";

interface WebRemoteControlSharedHostAttachContext {
  kind: WebRemoteControlSharedHostKind;
  terminalOwnerId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}

interface WebRemoteControlSharedHostAttachment {
  entryId: string;
  attachmentId: string;
  process: ElectronUtilityProcess;
  port: MessagePortMain;
  remoteKind?: RemoteWorkspaceIdentityKind;
}

interface WebRemoteControlSharedHostError extends Error {
  code:
    | "DESKTOP_HOST_MISSING"
    | "LOCAL_WORKSPACE_UNAVAILABLE"
    | "REMOTE_WORKSPACE_IDENTITY_MISSING"
    | "REMOTE_WORKSPACE_IDENTITY_MISMATCH"
    | "REMOTE_SESSION_MISSING"
    | "REMOTE_SESSION_WINDOW_MISMATCH";
}

function createSharedHostError(
  code: WebRemoteControlSharedHostError["code"],
  message: string,
): WebRemoteControlSharedHostError {
  const error = new Error(message) as WebRemoteControlSharedHostError;
  error.code = code;
  return error;
}

export function createWebRemoteControlSharedHostAttachments(dependencies: {
  windowHostProcessMap: Map<number, ElectronUtilityProcess>;
  createMessageChannel?: () => { port1: MessagePortMain; port2: MessagePortMain };
  attachRemoteWorkspaceSessionHost: (params: {
    windowId: number;
    remoteSessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
    workspaceKey: string;
    clientMode: "web-remote-replayable";
    terminalOwnerId?: string;
  }) => {
    process: ElectronUtilityProcess;
    port: MessagePortMain;
    remoteKind: RemoteWorkspaceIdentityKind;
  };
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}) {
  let nextAttachmentId = 0;
  const attachments = new Map<
    string,
    {
      windowId: number;
      remoteSessionId?: string;
      port: MessagePortMain;
    }
  >();

  function createMessageChannel() {
    return dependencies.createMessageChannel?.() ?? new MessageChannelMain();
  }

  function attachLocalHost(
    windowId: number,
    terminalOwnerId?: string,
  ): WebRemoteControlSharedHostAttachment {
    const hostProcessWindowId = BrowserWindow.fromId(windowId)?.webContents.id ?? windowId;
    const process = dependencies.windowHostProcessMap.get(hostProcessWindowId);
    if (!process) {
      throw createSharedHostError(
        "DESKTOP_HOST_MISSING",
        `未找到桌面窗口 host process，windowId=${windowId}`,
      );
    }

    const { port1, port2 } = createMessageChannel();
    const attachmentId = `shared-host-attachment-${++nextAttachmentId}`;
    process.postMessage(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: `shared-host-request-${nextAttachmentId}`,
        attachmentId,
        clientMode: "web-remote-replayable",
        ...(terminalOwnerId ? { terminalOwnerId } : {}),
        scope: { kind: "local" },
      },
      [port2],
    );
    attachments.set(attachmentId, { windowId, port: port1 });
    return {
      entryId: `desktop-host:${windowId}`,
      attachmentId,
      process,
      port: port1,
    };
  }

  async function attachWorkspaceHost(
    windowId: number,
    context: WebRemoteControlSharedHostAttachContext,
  ): Promise<WebRemoteControlSharedHostAttachment> {
    if (context.kind === "local") {
      // OW-P017：旧入口直接交付 Host port，失效 cwd 仍可新建；历史恢复保留只读访问。
      // 合并：上游为本地 attachment 引入 terminalOwnerId（终端 owner 隔离），与其一并透传。
      if (!context.initialTaskId) {
        try {
          if (!(await stat(context.workspacePath)).isDirectory()) throw new Error("not-directory");
          await access(context.workspacePath, constants.R_OK | constants.X_OK);
        } catch {
          throw createSharedHostError(
            "LOCAL_WORKSPACE_UNAVAILABLE",
            "工作区目录不可用。请恢复目录或在桌面选择有效目录后新建任务。",
          );
        }
      }
      return attachLocalHost(windowId, context.terminalOwnerId);
    }
    if (!context.remoteSessionId) {
      throw createSharedHostError(
        "REMOTE_SESSION_MISSING",
        "远程 workspace bridge 缺少 remoteSessionId。",
      );
    }
    const workspaceIdentity = context.workspaceIdentity?.trim();
    if (!workspaceIdentity) {
      throw createSharedHostError(
        "REMOTE_WORKSPACE_IDENTITY_MISSING",
        "远程 workspace bridge 缺少 workspaceIdentity，不能建立身份隔离。",
      );
    }
    const workspaceKey = workspaceIdentity || context.workspacePath;
    const attached = dependencies.attachRemoteWorkspaceSessionHost({
      windowId,
      remoteSessionId: context.remoteSessionId,
      workspacePath: context.workspacePath,
      workspaceIdentity,
      workspaceKey,
      clientMode: "web-remote-replayable",
      ...(context.terminalOwnerId ? { terminalOwnerId: context.terminalOwnerId } : {}),
    });
    const attachmentId = `shared-host-attachment-${++nextAttachmentId}`;
    attachments.set(attachmentId, {
      windowId,
      remoteSessionId: context.remoteSessionId,
      port: attached.port,
    });
    return {
      entryId: `remote-session-host:${context.remoteSessionId}`,
      attachmentId,
      process: attached.process,
      port: attached.port,
      remoteKind: attached.remoteKind,
    };
  }

  function releaseAttachment(attachmentId: string): void {
    const attachment = attachments.get(attachmentId);
    if (!attachment) {
      return;
    }
    attachments.delete(attachmentId);
    try {
      attachment.port.close();
    } catch (error) {
      dependencies.logger.warn("[web-remote-control] failed to close shared host attachment", {
        attachmentId,
        error,
      });
    }
  }

  function disposeWindow(windowId: number): void {
    for (const [attachmentId, attachment] of Array.from(attachments)) {
      if (attachment.windowId === windowId) {
        releaseAttachment(attachmentId);
      }
    }
  }

  function disposeRemoteSession(remoteSessionId: string): void {
    for (const [attachmentId, attachment] of Array.from(attachments)) {
      if (attachment.remoteSessionId === remoteSessionId) {
        releaseAttachment(attachmentId);
      }
    }
  }

  function setTerminalOwner(windowId: number, ownerId: string | null): void {
    // local/remote attachment 都归该窗口已有 Host；不把页面 owner 绑定到临时 port。
    const webContentsId = BrowserWindow.fromId(windowId)?.webContents.id ?? windowId;
    dependencies.windowHostProcessMap.get(webContentsId)?.postMessage({
      type: HostMessageTypes.SetTerminalOwner,
      ownerId,
    });
  }

  return {
    setTerminalOwner,
    attachWorkspaceHost,
    releaseAttachment,
    disposeWindow,
    disposeRemoteSession,
  };
}
