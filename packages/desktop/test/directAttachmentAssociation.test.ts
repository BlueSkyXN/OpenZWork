import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseHostAttachmentProbeRecords,
  verifyDirectAttachmentAssociation,
  type DirectPaneRuntimeQuery,
  type HostAttachmentSubscriptionRecord,
} from "./e2e/helpers/direct-attachment-association.js";
import {
  createHostE2EAttachmentProbe,
  resolveHostE2EAttachmentProbeFilePath,
  type HostE2EConversationSubscribeParams,
} from "../src/host/e2e-attachment-probe/index.js";

// WT04 direct 关联判定合同回归（docs/specs/wt04-direct-runtime-association-openzwork.md）。
// 反例矩阵覆盖任务要求的全部拒绝面：不同 runtime 但 generation/state 相同、缺少一侧
// attachment、scope/会话不匹配、订阅已结束、查询不可用、缺 artifact、E2E gate 未启用，
// 以及旧「两端赋同一 sharedInstanceKey」代填（无 Host 记录支撑即拒绝）。
//
// runtime identity 形态为 `${workspaceKey}:${generation}:${pid}`（zcodeAgentProcessManager
// 启动时生成），是实例的决定性字段；generation 单独相等不构成同一实例（2026-11-15 独立
// 复核反例：两个独立 CLI 各自 ensureReady 后 generation 都是 1）。

const SESSION = "sess-wt04";
const WORKSPACE = "/repo/wt04-project";
const IDENTITY_A = `${WORKSPACE}:1:4242`;
const IDENTITY_B = `${WORKSPACE}:1:5150`;

const paneQuery = (overrides: Partial<DirectPaneRuntimeQuery> = {}): DirectPaneRuntimeQuery => ({
  status: "ok",
  identity: IDENTITY_A,
  generation: 1,
  processId: 4242,
  workspaceKey: WORKSPACE,
  queriedAt: "2026-11-16T08:00:00.000Z",
  target: {
    workspacePath: WORKSPACE,
    workspaceIdentity: null,
    remoteSessionId: null,
  },
  ...overrides,
});

let seqCounter = 0;
const hostRecord = (
  overrides: Partial<HostAttachmentSubscriptionRecord> & {
    clientMode: HostAttachmentSubscriptionRecord["clientMode"];
  },
): HostAttachmentSubscriptionRecord => {
  seqCounter += 1;
  return {
    attachmentId: `att-${seqCounter}`,
    clientMode: overrides.clientMode,
    event: "subscribed",
    hostConnectionId: `host-rpc-${seqCounter}`,
    hostGeneration: 1,
    hostProcessId: 900,
    recordedAt: "2026-11-16T08:00:01.000Z",
    remoteSessionId: null,
    runtimeIdentity: {
      generation: 1,
      identity: IDENTITY_A,
      processId: 4242,
      workspaceKey: WORKSPACE,
    },
    scope: { kind: "local" },
    scopeMatchesTarget: true,
    seq: seqCounter,
    sessionId: SESSION,
    subscribeRemoteSessionId: null,
    subscriptionId: `sub-${seqCounter}`,
    topic: `conversation/${SESSION}`,
    workspaceIdentity: null,
    workspaceKey: WORKSPACE,
    workspacePath: WORKSPACE,
    ...overrides,
  };
};

const validInput = () => {
  // 每次构造都从 seq=1 开始：窗口断言（lastSeqBeforeView/lastSeqInViewEnd）与
  // 记录 seq 必须逐调用对齐，不能用跨调用递增计数器。
  seqCounter = 0;
  return {
    sessionId: SESSION,
    desktopQuery: paneQuery(),
    mobileQuery: paneQuery({
      queriedAt: "2026-11-16T08:00:30.000Z",
      target: {
        workspacePath: WORKSPACE,
        workspaceIdentity: null,
        remoteSessionId: "remote-session-1",
      },
    }),
    hostRecords: [
      hostRecord({ clientMode: "desktop-continuous", scope: { kind: "local" } }),
      hostRecord({
        clientMode: "web-remote-replayable",
        remoteSessionId: "remote-session-1",
        subscribeRemoteSessionId: null,
        scope: {
          kind: "remote",
          remoteSessionId: "remote-session-1",
          workspacePath: WORKSPACE,
          workspaceIdentity: "",
        },
      }),
    ],
    lastSeqBeforeView: 1,
    lastSeqInViewEnd: 2,
  };
};

describe("WT04 direct attachment 关联判定合同", () => {
  it("合法样本：两端独立查询与两条真实 Host 订阅记录一致时通过", () => {
    expect(verifyDirectAttachmentAssociation(validInput())).toEqual([]);
  });

  it("反例：不同 runtime 但 generation/state 相同（identity 不同）必须拒绝", () => {
    // 手机 pane 独立查询拿到另一实例（identity 含 pid，generation 相同），Host 记录
    // runtimeIdentity 仍是 IDENTITY_A：两端查询互异（cross-end）且手机查询与 Host
    // 记录互异（identity-mismatch）——generation 相同不能弥补。
    const failures = verifyDirectAttachmentAssociation({
      ...validInput(),
      mobileQuery: paneQuery({
        identity: IDENTITY_B,
        processId: 5150,
        queriedAt: "2026-11-16T08:00:30.000Z",
        target: {
          workspacePath: WORKSPACE,
          workspaceIdentity: null,
          remoteSessionId: "remote-session-1",
        },
      }),
    });
    expect(failures.map((failure) => failure.code)).toContain("identity-mismatch");
    expect(failures.map((failure) => failure.code)).toContain("cross-end-identity-mismatch");
  });

  it("反例：缺少手机侧 attachment（查看窗口内无 web-remote-replayable 订阅）必须拒绝", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: input.hostRecords.filter(
        (record) => record.clientMode !== "web-remote-replayable",
      ),
    });
    expect(failures.map((failure) => failure.code)).toContain("mobile-attachment-missing");
  });

  it("反例：窗口前已有旧手机订阅不算当前连接（seq 早于查看起点）", () => {
    const input = validInput();
    // 手机 attachment 存在但 seq=1（= recordsBeforeView，窗口前发生）。
    const staleMobile = {
      ...input.hostRecords[1],
      seq: 1,
    } as HostAttachmentSubscriptionRecord;
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [input.hostRecords[0], staleMobile],
    });
    expect(failures.map((failure) => failure.code)).toContain("mobile-attachment-missing");
  });

  it("反例：scope 与订阅目标不匹配（scopeMatchesTarget=false）必须拒绝", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: input.hostRecords.map((record, index) =>
        index === 0 ? { ...record, scopeMatchesTarget: false } : record,
      ),
    });
    expect(failures.map((failure) => failure.code)).toContain("scope-mismatch");
  });

  it("反例：会话不匹配（Host 记录指向另一会话）必须拒绝", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: input.hostRecords.map((record) => ({
        ...record,
        sessionId: "sess-other",
        topic: "conversation/sess-other",
      })),
    });
    expect(failures.map((failure) => failure.code)).toContain("mobile-attachment-missing");
    expect(failures.map((failure) => failure.code)).toContain("desktop-attachment-missing");
  });

  it("反例：桌面订阅在查看期间已结束（unsubscribed/attachment-disposed）必须拒绝", () => {
    const input = validInput();
    const desktopRecord = input.hostRecords[0];
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [
        desktopRecord,
        input.hostRecords[1],
        {
          ...desktopRecord,
          event: "attachment-disposed",
          seq: 3,
          recordedAt: "2026-11-16T08:00:20.000Z",
        },
      ],
      lastSeqInViewEnd: 3,
    });
    expect(failures.map((failure) => failure.code)).toContain("subscription-ended");
  });

  it.each(["unsubscribed", "attachment-disposed"] as const)(
    "反例：桌面原订阅 %s 后重订阅同一 runtime 仍须拒绝",
    (event) => {
      const input = validInput();
      const desktop = input.hostRecords[0];
      const ended = { ...desktop, event, seq: 3 };
      const replacement = hostRecord({
        clientMode: "desktop-continuous",
        seq: 4,
        ...(event === "unsubscribed"
          ? { attachmentId: desktop.attachmentId, hostConnectionId: desktop.hostConnectionId }
          : {}),
      });
      const failures = verifyDirectAttachmentAssociation({
        ...input,
        hostRecords: [...input.hostRecords, ended, replacement],
        lastSeqInViewEnd: 4,
      });
      expect(failures.map((failure) => failure.code)).toContain("subscription-ended");
    },
  );

  it("反例：只有查看开始后建立的桌面订阅，缺少查看前的基线", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [input.hostRecords[1], { ...input.hostRecords[0], seq: 3 }],
      lastSeqBeforeView: 0,
      lastSeqInViewEnd: 3,
    });
    expect(failures.map((failure) => failure.code)).toContain("desktop-attachment-missing");
  });

  it("反例：手机订阅在查看期间追加 attachment-disposed 也必须拒绝（不只查桌面结束）", () => {
    const input = validInput();
    const mobileRecord = input.hostRecords[1];
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [
        input.hostRecords[0],
        mobileRecord,
        {
          ...mobileRecord,
          event: "attachment-disposed",
          seq: 3,
          recordedAt: "2026-11-16T08:00:40.000Z",
        },
      ],
      lastSeqInViewEnd: 3,
    });
    expect(failures.map((failure) => failure.code)).toContain("subscription-ended");
    expect(failures.map((failure) => failure.code).join()).not.toContain("desktop");
  });

  it("窗口边界：用例收尾产生的 dispose（seq 晚于查看结束快照）不算查看中关闭", () => {
    const input = validInput();
    const desktopRecord = input.hostRecords[0];
    const mobileRecord = input.hostRecords[1];
    // 收尾 dispose 在快照之后（seq=5/6 > lastSeqInViewEnd=2）：真实文件尾部的合法形态。
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [
        desktopRecord,
        mobileRecord,
        { ...desktopRecord, event: "attachment-disposed", seq: 5 },
        { ...mobileRecord, event: "attachment-disposed", seq: 6 },
      ],
    });
    expect(failures).toEqual([]);
  });

  it("反例：两端记录复用同一 hostConnectionId/subscriptionId/attachmentId 必须拒绝", () => {
    const input = validInput();
    // 桌面记录被手机端复用（同一 attachment、同一连接、同一订阅）——不是两条独立关系。
    const reused = {
      ...input.hostRecords[1],
      attachmentId: input.hostRecords[0].attachmentId,
      hostConnectionId: input.hostRecords[0].hostConnectionId,
      subscriptionId: input.hostRecords[0].subscriptionId,
    } as HostAttachmentSubscriptionRecord;
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [input.hostRecords[0], reused],
    });
    const codes = failures.map((failure) => failure.code);
    expect(codes).toContain("cross-end-connection-reuse");
    expect(codes).toContain("cross-end-subscription-reuse");
    expect(codes).toContain("cross-end-attachment-reuse");
  });

  it("反例：Host runtime 查询返回 other-workspace 而 pane 查回本 workspace 必须拒绝", () => {
    const input = validInput();
    // 只改 Host 记录内嵌的查询返回值：顶层字段一致也不放行（完整核查询返回值）。
    const desktopRecord = {
      ...input.hostRecords[0],
      runtimeIdentity: {
        ...input.hostRecords[0].runtimeIdentity!,
        workspaceKey: "/other-workspace",
        identity: `/other-workspace:1:${input.hostRecords[0].runtimeIdentity!.processId}`,
      },
    } as HostAttachmentSubscriptionRecord;
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [desktopRecord, input.hostRecords[1]],
    });
    const codes = failures.map((failure) => failure.code);
    expect(codes).toContain("host-returned-workspace-key-mismatch");
    expect(codes).toContain("identity-mismatch");
  });

  it("反例：Host 记录 seq 非单调（行序与序号不一致）判观察不可靠", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [
        { ...input.hostRecords[0], seq: 2 },
        { ...input.hostRecords[1], seq: 1 },
      ],
    });
    expect(failures.map((failure) => failure.code)).toContain("host-records-seq-disorder");
  });

  it("反例：查看窗口快照自相矛盾（end < before）必须拒绝", () => {
    const failures = verifyDirectAttachmentAssociation({
      ...validInput(),
      lastSeqBeforeView: 5,
      lastSeqInViewEnd: 2,
    });
    expect(failures.map((failure) => failure.code)).toContain("view-window-invalid");
  });

  it("反例：任一端 pane 查询不可用必须拒绝（错误不得吞成绿色）", () => {
    const failures = verifyDirectAttachmentAssociation({
      ...validInput(),
      mobileQuery: paneQuery({
        status: "error",
        error: "Error: ZCode agent runtime identity is unavailable.",
        identity: undefined,
      }),
    });
    expect(failures.map((failure) => failure.code)).toContain("query-unavailable");
  });

  it("反例：缺 artifact（无任何 Host 记录）时旧同值代填也被拒绝", () => {
    // 两侧 pane 查询 identity 完全相同（旧 sharedInstanceKey 同值代填形态），
    // 但没有 Host attachment/subscription 记录支撑 —— 不构成 direct 证据。
    const failures = verifyDirectAttachmentAssociation({
      sessionId: SESSION,
      desktopQuery: paneQuery(),
      mobileQuery: paneQuery(),
      hostRecords: [],
      lastSeqBeforeView: 0,
    });
    expect(failures.map((failure) => failure.code)).toContain("host-records-missing");
  });

  it("反例：Host 侧 runtime 查询失败（existing-only 不可用）必须拒绝", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      hostRecords: [
        { ...input.hostRecords[0], runtimeIdentity: null, runtimeIdentityError: "Error" },
        input.hostRecords[1],
      ],
    });
    expect(failures.map((failure) => failure.code)).toContain("host-runtime-query-unavailable");
  });

  it("反例：workspace key 单侧不同（含同路径不同 identity）必须拒绝", () => {
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      mobileQuery: paneQuery({
        queriedAt: "2026-11-16T08:00:30.000Z",
        target: {
          workspacePath: WORKSPACE,
          workspaceIdentity: "identity-mobile-only",
          remoteSessionId: "remote-session-1",
        },
      }),
    });
    expect(failures.map((failure) => failure.code)).toContain("workspace-key-mismatch");
    expect(failures.map((failure) => failure.code)).toContain("cross-end-workspace-key-mismatch");
  });

  it("合法样本：本地配对查看走 shared Host attachment（scope=local）时通过", () => {
    // 实测拓扑（run desktop-e2e-20261116-162434-554）：手机查看本地 workspace 的
    // attachmentId 为 shared-host-attachment-*，scope 与桌面同为 local；两端 pane 解析的
    // remoteSessionId 均为 null，判定按实际 scope 匹配。
    const input = validInput();
    const failures = verifyDirectAttachmentAssociation({
      ...input,
      mobileQuery: paneQuery({
        queriedAt: "2026-11-16T08:00:30.000Z",
        target: {
          workspacePath: WORKSPACE,
          workspaceIdentity: null,
          remoteSessionId: null,
        },
      }),
      hostRecords: [
        input.hostRecords[0],
        {
          ...hostRecord({
            clientMode: "web-remote-replayable",
            attachmentId: "shared-host-attachment-1",
            scope: { kind: "local" },
          }),
          seq: 2,
        } as HostAttachmentSubscriptionRecord,
      ],
    });
    expect(failures).toEqual([]);
  });

  it("合法样本：本地 workspace 两侧 identity 同为空（key 回落为路径）通过", () => {
    // validInput 的 target.workspaceIdentity 与 Host 记录 workspaceIdentity 均为 null/空，
    // key 按 workspacePath 回落 —— 此用例固定该合同不被误判为缺失。
    expect(verifyDirectAttachmentAssociation(validInput())).toEqual([]);
  });

  it("ndjson 解析：按行序还原事件序列", () => {
    const input = validInput();
    const ndjson = input.hostRecords.map((record) => JSON.stringify(record)).join("\n");
    const parsed = parseHostAttachmentProbeRecords(`${ndjson}\n`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].seq).toBeLessThan(parsed[1].seq);
    expect(parsed[1].clientMode).toBe("web-remote-replayable");
  });
});

describe("Host E2E attachment probe 启用矩阵与记录行为", () => {
  const subscribeParams = (sessionId = SESSION): HostE2EConversationSubscribeParams => ({
    workspacePath: WORKSPACE,
    sessionId,
  });

  const fakeAgentService = () => ({
    async subscribeConversationV4(params: HostE2EConversationSubscribeParams) {
      return {
        ack: { subscriptionId: `sub-${params.sessionId}` },
      } as never;
    },
    async unsubscribeConversationV4() {},
  });

  const fakeSessionService = (identity: string) => ({
    async getWorkspaceRuntimeIdentity() {
      return { generation: 1, identity, processId: 4242, workspaceKey: WORKSPACE };
    },
  });

  it("gate 未启用（flag/runId/artifactDir 任一缺失）时不包装、不落盘", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "wt04-probe-off-"));
    try {
      const probe = createHostE2EAttachmentProbe({ enabled: false, artifactDir });
      expect(probe.enabled).toBe(false);
      const service = fakeAgentService();
      const binding = probe.wrapService({
        attachmentId: "att-1",
        clientMode: "desktop-continuous",
        hostConnectionId: "host-rpc-1",
        hostGeneration: 1,
        scope: { kind: "local" },
        service: service as never,
        sessionService: fakeSessionService(IDENTITY_A),
      });
      // 关闭时保持原服务引用（零包装）。
      expect(binding.service).toBe(service);
      await binding.dispose();
      // 关闭时不创建观察输出。
      await expect(stat(join(artifactDir, "host-probes"))).rejects.toThrow();
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("flag 开但 artifact 目录缺失时禁用（零输出）", async () => {
    const probe = createHostE2EAttachmentProbe({ enabled: true });
    expect(probe.enabled).toBe(false);
    expect(probe.outputPath).toBeNull();
  });

  it("gate 全开时记录真实 subscribe ACK/unsubscribe/dispose，结果透传不变", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "wt04-probe-on-"));
    try {
      const probe = createHostE2EAttachmentProbe({
        enabled: true,
        artifactDir,
        hostProcessId: 31337,
      });
      expect(probe.enabled).toBe(true);
      const agentService = fakeAgentService();
      const binding = probe.wrapService({
        attachmentId: "att-1",
        clientMode: "desktop-continuous",
        hostConnectionId: "host-rpc-1",
        hostGeneration: 1,
        scope: { kind: "local" },
        service: agentService as never,
        sessionService: fakeSessionService(IDENTITY_A),
      });
      const result = await binding.service.subscribeConversationV4(subscribeParams());
      // ACK 透传不变。
      expect(result).toEqual({ ack: { subscriptionId: `sub-${SESSION}` } });
      await binding.service.unsubscribeConversationV4({
        workspacePath: WORKSPACE,
        subscriptionId: `sub-${SESSION}`,
      });
      // 再订阅一条后直接 dispose attachment：该订阅按 attachment-disposed 收口。
      await binding.service.subscribeConversationV4(subscribeParams("sess-second"));
      await binding.dispose();
      const filePath = resolveHostE2EAttachmentProbeFilePath(artifactDir);
      const records = parseHostAttachmentProbeRecords(await readFile(filePath, "utf8"));
      const events = records.map((record) => `${record.event}:${record.sessionId}`);
      expect(events).toContain(`subscribed:${SESSION}`);
      expect(events).toContain(`unsubscribed:${SESSION}`);
      expect(events).toContain(`attachment-disposed:sess-second`);
      const subscribed = records.find(
        (record) => record.event === "subscribed" && record.sessionId === SESSION,
      );
      expect(subscribed?.runtimeIdentity?.identity).toBe(IDENTITY_A);
      expect(subscribed?.scopeMatchesTarget).toBe(true);
      expect(subscribed?.topic).toBe(`conversation/${SESSION}`);
      expect(subscribed?.hostProcessId).toBe(31337);
      // seq 单调递增。
      const seqs = records.map((record) => record.seq);
      expect([...seqs].sort((left, right) => left - right)).toEqual(seqs);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("artifact 目标无效（逃逸/空）时禁用而非崩溃（验收端把缺记录判失败）", async () => {
    // resolve(artifactDir, …) 构造上总在 artifactDir 内；逃逸守卫属纵深防御，
    // 这里只固定「异常按禁用处理、不抛出」的合同（单例 try/catch 的行为基础）。
    const probe = createHostE2EAttachmentProbe({
      enabled: true,
      artifactDir: "   ",
      onWarn: () => undefined,
    });
    expect(probe.enabled).toBe(false);
  });
});
