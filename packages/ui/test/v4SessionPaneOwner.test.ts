import { act, createElement, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import type { PendingCommandEntry } from "@/v4/pendingCommandRegistry.js";
import { SessionPane, type SessionPaneProps } from "@/v4/SessionPane.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";

type ProjectionState = {
  status: "connecting" | "live";
  snapshot: ConversationSnapshot | null;
  subscriptionId: string | null;
  lastError: string | null;
  optimisticCommands: readonly [];
  loadingOlder: boolean;
};

const recoveryCapture = vi.hoisted(() => ({
  entries: [] as PendingCommandEntry[],
  onResend: null as null | (() => void),
}));
vi.mock("@/v4/usePendingCommandRecovery.js", () => ({
  usePendingCommandRecovery: () => recoveryCapture.entries,
}));
vi.mock("@/v4/PendingCommandRecoveryBanner.js", () => ({
  PendingCommandRecoveryBanner: (props: { onResend?: () => void }) => {
    recoveryCapture.onResend = props.onResend ?? null;
    return null;
  },
}));

const projectionState = vi.hoisted(() => ({
  current: null as ProjectionState | null,
}));

const composerLifecycle = vi.hoisted(() => ({
  disabledStates: [] as boolean[],
  mounts: 0,
  nextInstanceId: 1,
  renders: [] as number[],
  unmounts: 0,
}));

const scrollFocus = vi.hoisted(() => ({
  composerProps: null as null | {
    onOpenRunningBackgroundWorks?: () => void;
    onSendText: (
      text: string,
      options?: {
        heldQueueDisposition?: "clearQueueAndSend" | "keepQueueAndSend";
        expectedHeldQueueItemIds?: readonly string[];
        requestedDelivery?: "startNow" | "queue" | "guide";
        sharedContextRefs?: Array<{ kind: "shared_context_import"; context_id: string }>;
        submission?: {
          mode: "build";
          modelSelection: {
            providerId: string;
            modelId: string;
            options: { reasoningLevel: string };
          };
        };
      },
    ) => Promise<"sent" | "blocked" | "confirmationRequired">;
  },
  queueProps: null as null | {
    onResume?: () => Promise<void>;
    onSendNow?: (queueItemId: string) => void;
  },
  statusPanelProps: null as null | {
    onTerminalSectionOpenChange?: (open: boolean) => void;
    terminalSectionOpen?: boolean;
    onAgentSectionOpenChange?: (open: boolean) => void;
    agentSectionOpen?: boolean;
    summaryPanelVariantOverride?: "panel" | "mini" | null;
  },
  scrollToBottom: vi.fn(),
}));

// 永不 resolve：这些文件不测发现查询；resolve 会在环境拆除后触发 setState（未处理异常）。
const workflowRunsQueryMock = vi.hoisted(() =>
  vi.fn(() => new Promise<{ runs: unknown[] }>(() => {})),
);
const conversationMock = vi.hoisted(() => {
  const lease = {
    release: vi.fn(),
    store: {
      expectAcceptedInputProjection: vi.fn(),
      markCommandPending: vi.fn(),
      recoverFromStaleAuthority: vi.fn(),
      onOnlineModelTransition: vi.fn(() => () => {}),
      refreshPlans: vi.fn(async () => {}),
      settleCommand: vi.fn(),
    },
  };
  const sendCommand = vi.fn(async (envelope: { commandId: string }) => ({
    commandId: envelope.commandId,
    revisionAtDecision: 1,
    status: "accepted" as const,
  }));
  const layer = {
    acquire: vi.fn(() => lease),
    queryCommands: vi.fn(async () => ({ results: [] })),
  };
  return {
    layer,
    lease,
    currentLayer: null as typeof layer | null,
    currentSendCommand: null as typeof sendCommand | null,
    sendCommand,
  };
});

const prewarmHookInputs = vi.hoisted(() => ({
  binding: null as null | { sessionId: string; beginPromotion: () => boolean; promote: () => void },
  current: [] as Array<{
    workspaceKey: string;
    transportIdentity: unknown;
    dispatchCommand: (
      type: string,
      payload: Record<string, unknown>,
      sessionId: string | null,
    ) => Promise<unknown>;
  }>,
}));

const servicesMock = vi.hoisted(() => ({
  projectService: {
    resolveSessionDirectories: vi.fn(async (task) => ({
      ...task,
      projectId: null,
      additionalDirectories: [],
    })),
  },
  // 修复原因：readiness hook 将 service 作为 effect 依赖；每次 render 重建会导致无限重渲染直至 OOM。
  modelSelectionService: {
    getView: vi.fn(async () => ({
      revision: 1,
      providers: [
        {
          providerId: "provider-deepseek",
          config: { kind: "api" as const },
          models: [{ modelId: "deepseek-v4-flash", config: {} }],
        },
      ],
    })),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    validate: vi.fn(),
  },
  zcodeSessionService: {
    updateProviderRegistry: vi.fn(),
  },
  zcodeTaskService: {
    restartWorkspaceProcess: vi.fn(),
  },
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: vi.fn() }));

// 本组只验证输入框连续性；群同步服务由独立组件测试和真实 Host/CLI E2E 覆盖。
vi.mock("@/v4/BotGroupDeliveryAction.js", () => ({
  BotGroupDeliveryProvider: ({ children }: { children: unknown }) => children,
  ConnectedBotGroupDeliveryAction: () => null,
}));

// 同理隔离推荐提示词占位：本文件用的是只实现 createElement 的极简 DOM，
// 渲染 lucide 图标会走 createElementNS 而直接崩掉，与 composer 连续性无关。
vi.mock("@/v4/ConversationDraftSuggestedPromptsContainer.js", () => ({
  ConversationDraftSuggestedPromptsContainer: () => null,
}));

vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => projectionState.current,
}));

vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({
    layer: conversationMock.currentLayer ?? conversationMock.layer,
    sendCommand: conversationMock.currentSendCommand ?? conversationMock.sendCommand,
    attachmentPut: vi.fn(),
    // SessionPane 挂载即拉 journal 兜底的 run 发现查询：缺桩会在 effect 里 TypeError；
    // 桩必须是稳定引用——effect 以 workflowRuns 为依赖，每次渲染换新函数会死循环。
    workflowRuns: workflowRunsQueryMock,
    fileChanges: vi.fn(),
    fileRewindPreview: vi.fn(),
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStoreWithDefault: (_selector: unknown, fallback: unknown) => fallback,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: { zcodeInteractionBehavior: "queue" },
    loading: false,
    error: null,
    update: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useComposerClientNamespace: () => "desktop",
  useOptionalServices: () => null,
  useServices: () => servicesMock,
}));

// 本文件只验证 composer 生命周期；目标 Host View 的异步订阅已有独立 hook 测试。
// 若让真实 hook 在极简 DOM 中运行，Promise 回流会把 React 调度留到 window 清理之后。
vi.mock("@/hooks/useModelSelectionView.js", () => ({
  useModelSelectionServiceView: () => ({
    state: {
      status: "ready",
      view: {
        revision: 1,
        preferredSelection: {
          providerId: "provider-deepseek",
          modelId: "deepseek-v4-flash",
        },
        providers: [
          {
            providerId: "provider-deepseek",
            config: { kind: "api" as const },
            models: [
              {
                modelId: "deepseek-v4-flash",
                config: {
                  optionSpecs: { reasoningLevel: { values: ["low", "high"], map: "{}" } },
                },
              },
            ],
          },
        ],
      },
    },
    reload: vi.fn(),
  }),
}));

vi.mock("@/v4/composer/useDraftConfigControl.js", () => ({
  buildDraftCreateConfigPayload: () => ({}),
  useDraftConfigControl: () => ({
    modelSelectionRead: useModelSelectionServiceView(null),
    captureAcceptedModelSelection: () => vi.fn(),
    composerDraft: { text: "", updatedAt: 0 },
    draftConfig: {},
    draftConfigRef: {
      current: {
        mode: "build",
        modelSelection: {
          providerId: "provider-deepseek",
          modelId: "deepseek-v4-flash",
          options: { reasoningLevel: "high" },
        },
      },
    },
    resolveInitialDraftConfig: vi.fn(async () => ({})),
    handleDraftSelectModel: vi.fn(),
    handleDraftSelectThought: vi.fn(),
    handleDraftSwitchMode: vi.fn(),
    promoteComposerDraft: vi.fn(),
    replaceComposerDraft: vi.fn(),
    updateComposerContent: vi.fn(),
  }),
}));

vi.mock("@/v4/composer/useDraftSessionPrewarm.js", () => ({
  useDraftSessionPrewarm: (params: (typeof prewarmHookInputs.current)[number]) => {
    prewarmHookInputs.current.push(params);
    return {
      binding: prewarmHookInputs.binding,
      waitForSession: async () => {
        if (prewarmHookInputs.binding) return prewarmHookInputs.binding;
        const ack = (await params.dispatchCommand("createSession", {}, null)) as {
          result: { sessionId: string };
        };
        return { sessionId: ack.result.sessionId, beginPromotion: () => true, promote: vi.fn() };
      },
    };
  },
}));

vi.mock("@/v4/ConversationComposer.js", () => ({
  ConversationComposer: (props: {
    disabled?: boolean;
    onOpenRunningBackgroundWorks?: () => void;
    onSendText: (
      text: string,
      options?: {
        heldQueueDisposition?: "clearQueueAndSend" | "keepQueueAndSend";
        expectedHeldQueueItemIds?: readonly string[];
        requestedDelivery?: "startNow" | "queue" | "guide";
        sharedContextRefs?: Array<{ kind: "shared_context_import"; context_id: string }>;
      },
    ) => Promise<"sent" | "blocked" | "confirmationRequired">;
  }) => {
    const { disabled = false } = props;
    scrollFocus.composerProps = props;
    const instanceIdRef = useRef<number | null>(null);
    if (instanceIdRef.current === null) {
      instanceIdRef.current = composerLifecycle.nextInstanceId;
      composerLifecycle.nextInstanceId += 1;
    }
    composerLifecycle.renders.push(instanceIdRef.current);
    composerLifecycle.disabledStates.push(disabled);
    useEffect(() => {
      composerLifecycle.mounts += 1;
      return () => {
        composerLifecycle.unmounts += 1;
      };
    }, []);
    return createElement("div", { "data-testid": "mock-composer" });
  },
}));

vi.mock("@/v4/ConversationHeader.js", () => ({
  ConversationHeader: () => createElement("div", null),
}));

vi.mock("@/v4/ConversationStatusPanel.js", () => ({
  ConversationStatusPanel: (props: {
    onTerminalSectionOpenChange?: (open: boolean) => void;
    terminalSectionOpen?: boolean;
    onAgentSectionOpenChange?: (open: boolean) => void;
    agentSectionOpen?: boolean;
    summaryPanelVariantOverride?: "panel" | "mini" | null;
  }) => {
    scrollFocus.statusPanelProps = props;
    return createElement("div", null);
  },
}));

vi.mock("@/v4/ConversationTimeline.js", () => ({
  ConversationTimeline: ({
    bottomDock,
    emptyState,
    scrollToBottomActionRef,
  }: {
    bottomDock?: ReactNode;
    emptyState?: ReactNode;
    scrollToBottomActionRef?: { current: (() => void) | null };
  }) => {
    useLayoutEffect(() => {
      if (scrollToBottomActionRef) {
        scrollToBottomActionRef.current = scrollFocus.scrollToBottom;
      }
    }, [scrollToBottomActionRef]);
    return createElement("div", null, emptyState, bottomDock);
  },
}));

vi.mock("@/v4/ConversationQueuePanel.js", () => ({
  ConversationQueuePanel: (props: {
    onResume?: () => Promise<void>;
    onSendNow?: (queueItemId: string) => void;
  }) => {
    scrollFocus.queueProps = props;
    return createElement("div", null);
  },
}));

vi.mock("@/v4/V4InteractionDialogs.js", () => ({
  V4InteractionDialogs: () => createElement("div", null),
}));

vi.mock("@/v4/ConversationDraftEmptyState.js", () => ({
  ConversationDraftEmptyState: () => createElement("div", null),
}));

function makeDraftSnapshot(): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "prewarm-1",
    logEpoch: "epoch-1",
    seq: 0,
    revision: 0,
    control: {
      phase: "draft",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: false, reasonCode: "noHistory" },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: false, reasonCode: "emptyQueue" },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
    },
    inputRouting: { mode: "startNow" },
    meta: { title: "", titleSource: "firstInput" },
    config: {
      provider: "provider-deepseek",
      model: "deepseek-v4-flash",
      thought: "medium",
      followupMode: "queue",
      mode: "build",
    },
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    goal: null,
    plan: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
}

const mountedRoots: Root[] = [];

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    clientWidth: 1024,
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {
      removeProperty: () => {},
      setProperty: () => {},
    },
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    innerWidth: 1024,
    Node: function Node() {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock, "div");
}

function renderPane(
  root: Root,
  sessionId: string | null,
  props: Partial<SessionPaneProps> = {},
): void {
  act(() => {
    root.render(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(SessionPane, {
          paneId: "workspace-main",
          sessionId,
          workspacePath: "/workspace",
          ...props,
        }),
      ),
    );
  });
}

beforeEach(() => {
  servicesMock.projectService.resolveSessionDirectories.mockClear();
  recoveryCapture.entries = [];
  recoveryCapture.onResend = null;
  prewarmHookInputs.binding = null;
  composerLifecycle.disabledStates = [];
  composerLifecycle.mounts = 0;
  composerLifecycle.nextInstanceId = 1;
  composerLifecycle.renders = [];
  composerLifecycle.unmounts = 0;
  conversationMock.layer.acquire.mockClear();
  conversationMock.lease.release.mockClear();
  conversationMock.lease.store.expectAcceptedInputProjection.mockClear();
  conversationMock.currentLayer = null;
  conversationMock.currentSendCommand = null;
  conversationMock.sendCommand.mockReset();
  conversationMock.sendCommand.mockImplementation(async (envelope) => ({
    commandId: envelope.commandId,
    revisionAtDecision: 1,
    status: "accepted" as const,
  }));
  prewarmHookInputs.current = [];
  scrollFocus.composerProps = null;
  scrollFocus.queueProps = null;
  scrollFocus.statusPanelProps = null;
  scrollFocus.scrollToBottom.mockClear();
  projectionState.current = {
    status: "live",
    snapshot: makeDraftSnapshot(),
    subscriptionId: "sub-draft",
    lastError: null,
    optimisticCommands: [],
    loadingOlder: false,
  };
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
});

describe("SessionPane Recent project ownership", () => {
  it.each([
    ["selection_side_chat", true, "parent"],
    ["interactive", false, "session-1"],
    ["fork", false, "session-1"],
  ] as const)("%s 发送按自身语义解析 Recent 归属", async (_kind, selectionSideChat, ownerId) => {
    const root = createRoot(installMinimalDom());
    mountedRoots.push(root);
    projectionState.current = {
      ...projectionState.current,
      snapshot: { ...makeDraftSnapshot(), sessionId: "session-1" },
    };
    servicesMock.projectService.resolveSessionDirectories.mockImplementationOnce(async (task) => {
      if (selectionSideChat && task.taskId === "session-1")
        throw new Error("project.remote-project-required");
      return { ...task, projectId: null, additionalDirectories: [] };
    });
    renderPane(root, "session-1", { selectionSideChat, rootSessionId: "parent" });
    await act(async () => {
      await scrollFocus.composerProps?.onSendText("follow up");
    });
    expect(servicesMock.projectService.resolveSessionDirectories).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: ownerId }),
      expect.any(String),
    );
    expect(conversationMock.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sendText", sessionId: "session-1" }),
    );
  });
});
