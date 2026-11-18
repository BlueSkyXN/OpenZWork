// WT04 direct 关联判定合同（docs/specs/wt04-direct-runtime-association-openzwork.md）。
// 输入只有三类真实观察面：两端 pane 各自独立查询结果、Host probe 落盘的
// attachment/subscription 记录、查看窗口的记录分界。判定不接收任何「测试自造」的
// 共同实例标识——旧「两端赋同一 sharedInstanceKey」代填因缺少 Host 记录支撑而被拒绝。
// runtime identity（`${workspaceKey}:${generation}:${pid}` 形态，见 zcodeAgentProcessManager）
// 是实例决定性字段：不同 runtime 即使 generation/state 相同也会因 identity 不同被拒绝。

export interface DirectPaneRuntimeQuery {
  status: "ok" | "error";
  identity?: string;
  generation?: number;
  processId?: number;
  workspaceKey?: string;
  error?: string;
  queriedAt: string;
  target: {
    workspacePath: string;
    workspaceIdentity: string | null;
    remoteSessionId: string | null;
  };
}

export interface HostAttachmentProbeScopeRecord {
  kind: "local" | "remote" | "source-settings";
  remoteSessionId?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  sourceServerId?: string;
}

export interface HostAttachmentSubscriptionRecord {
  attachmentId: string;
  clientMode: string;
  event: "subscribed" | "unsubscribed" | "attachment-disposed";
  hostConnectionId: string;
  hostGeneration: number;
  hostProcessId: number;
  recordedAt: string;
  remoteSessionId: string | null;
  runtimeIdentity: {
    generation: number;
    identity: string;
    processId?: number;
    workspaceKey: string;
  } | null;
  runtimeIdentityError?: string;
  scope: HostAttachmentProbeScopeRecord;
  scopeMatchesTarget: boolean;
  seq: number;
  sessionId: string;
  subscribeRemoteSessionId: string | null;
  subscriptionId: string;
  topic: string;
  workspaceIdentity: string | null;
  workspaceKey: string;
  workspacePath: string;
}

export interface DirectAssociationFailure {
  code: string;
  detail: string;
}

/** 解析 Host probe ndjson；按行序返回（seq 由 Host 单调递增，行序即事件序）。 */
export function parseHostAttachmentProbeRecords(
  ndjson: string,
): HostAttachmentSubscriptionRecord[] {
  const records: HostAttachmentSubscriptionRecord[] = [];
  for (const line of ndjson.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed) as HostAttachmentSubscriptionRecord);
  }
  return records;
}

function resolveWorkspaceKey(identity: string | null | undefined, path: string | undefined) {
  return identity?.trim() || path || "";
}

/**
 * 判定「桌面/手机 pane 的真实 runtime 查询与 Host 真实 attachment/subscription 证据
 * 指向同一会话 runtime」。任一必需观察面缺失、不匹配或已失效都返回失败原因；
 * 调用方必须把非空失败列表整体判失败（缺证据不是通过）。
 *
 * 窗口以 Host probe 的单调 seq 表达（不是文件行数）：`lastSeqBeforeView` 是手机查看
 * 前最后一条已落盘记录的 seq（查看开始快照），`lastSeqInViewEnd` 是查看结束、用例收尾
 * 之前的 seq 快照。收尾 dispose 事件（seq > lastSeqInViewEnd）不算查看中关闭。
 */
export function verifyDirectAttachmentAssociation(input: {
  sessionId: string;
  desktopQuery: DirectPaneRuntimeQuery | null;
  mobileQuery: DirectPaneRuntimeQuery | null;
  /** Host probe 记录（查看结束、收尾之前的完整序列）。 */
  hostRecords: HostAttachmentSubscriptionRecord[];
  /** 查看前最后一条记录的 seq。桌面订阅取该值及之前，手机订阅取该值之后。 */
  lastSeqBeforeView: number;
  /** 查看结束快照的 seq（含）；结束事件只在 (subscribed.seq, lastSeqInViewEnd] 内算查看中结束。 */
  lastSeqInViewEnd: number;
}): DirectAssociationFailure[] {
  const failures: DirectAssociationFailure[] = [];
  const { desktopQuery, mobileQuery, hostRecords } = input;

  // 序列完整性：probe 按单一写链落盘，文件行序必须与 seq 单调递增一致；
  // 行序错乱说明观察输出不可靠（丢记录/乱序），不能当有效证据。
  for (let index = 1; index < hostRecords.length; index += 1) {
    const current = hostRecords[index];
    const previous = hostRecords[index - 1];
    if (current && previous && current.seq <= previous.seq) {
      failures.push({
        code: "host-records-seq-disorder",
        detail: `host probe records not monotonically increasing at index ${index} (seq ${previous.seq} -> ${current.seq})`,
      });
      break;
    }
  }
  if (input.lastSeqInViewEnd < input.lastSeqBeforeView) {
    failures.push({
      code: "view-window-invalid",
      detail: `lastSeqInViewEnd(${input.lastSeqInViewEnd}) < lastSeqBeforeView(${input.lastSeqBeforeView})`,
    });
  }

  // 观察面 0：Host artifact。没有记录 = 缺 artifact / gate 未启用，直接失败，
  // 不给「两侧查询相等」留替代通道。
  if (hostRecords.length === 0) {
    failures.push({
      code: "host-records-missing",
      detail: "no host attachment/subscription records in run artifact",
    });
  }

  // 观察面 1/2：两端 pane 独立查询必须都成功返回实例身份。
  for (const [label, query] of [
    ["desktop", desktopQuery],
    ["mobile", mobileQuery],
  ] as const) {
    if (!query || query.status !== "ok" || !query.identity) {
      failures.push({
        code: "query-unavailable",
        detail: `${label} pane runtime query unavailable${
          query?.status === "error" ? `: ${query.error ?? "unknown"}` : ""
        }`,
      });
    }
  }

  if (hostRecords.length > 0 && desktopQuery && mobileQuery) {
    // attachment 的 scope 必须与各端 pane 实际解析的连接形态一致：本地配对查看走
    // shared Host attachment（scope=local，见 desktopHostProcess 的共享 attachment），
    // 远端 workspace 查看走 remote scope；scope/remoteSessionId 不匹配即拒绝。
    const desktopScopeKind = desktopQuery.target.remoteSessionId ? "remote" : "local";
    const mobileScopeKind = mobileQuery.target.remoteSessionId ? "remote" : "local";
    const desktopSubscribed = pickSubscribedRecord(hostRecords, {
      sessionId: input.sessionId,
      clientMode: "desktop-continuous",
      scopeKind: desktopScopeKind,
      // 固定查看前的订阅，避免查看期间断开后用后续重订阅掩盖中断。
      maxSeq: input.lastSeqBeforeView,
    });
    const mobileSubscribed = pickSubscribedRecord(hostRecords, {
      sessionId: input.sessionId,
      clientMode: "web-remote-replayable",
      scopeKind: mobileScopeKind,
      minSeq: input.lastSeqBeforeView + 1,
      maxSeq: input.lastSeqInViewEnd,
    });

    // 桌面 attachment：desktop-continuous + 与 pane 解析一致的 scope + 该会话的真实订阅。
    if (!desktopSubscribed) {
      failures.push({
        code: "desktop-attachment-missing",
        detail: `no desktop-continuous/${desktopScopeKind} subscribed record for session ${input.sessionId} before view start (lastSeqBeforeView=${input.lastSeqBeforeView})`,
      });
    }
    // 手机 attachment：web-remote-replayable + 与 pane 解析一致的 scope + 查看窗口内
    // 发生的订阅（seq > 查看前快照）。旧订阅不算当前连接。
    if (!mobileSubscribed) {
      failures.push({
        code: "mobile-attachment-missing",
        detail: `no web-remote-replayable/${mobileScopeKind} subscribed record for session ${input.sessionId} after view start (lastSeqBeforeView=${input.lastSeqBeforeView})`,
      });
    }

    // 订阅有效性（两端同标准）：订阅在查看窗口内不得收到 unsubscribed / attachment-disposed。
    // 窗口以 seq 界定（subscribed.seq < end.seq <= lastSeqInViewEnd）；用例收尾的
    // dispose（seq > lastSeqInViewEnd）不算查看中关闭。
    for (const [label, record] of [
      ["desktop", desktopSubscribed],
      ["mobile", mobileSubscribed],
    ] as const) {
      if (!record) continue;
      const ended = hostRecords.find(
        (candidate) =>
          candidate.subscriptionId === record.subscriptionId &&
          candidate.attachmentId === record.attachmentId &&
          candidate.seq > record.seq &&
          candidate.seq <= input.lastSeqInViewEnd &&
          (candidate.event === "unsubscribed" || candidate.event === "attachment-disposed"),
      );
      if (ended) {
        failures.push({
          code: "subscription-ended",
          detail: `${label} subscription ${record.subscriptionId} ended before view completed (event=${ended.event}, seq=${ended.seq}, windowEnd=${input.lastSeqInViewEnd})`,
        });
      }
    }

    // 两端独立关系：桌面与手机必须各自持有一条真实、独立的 attachment/连接/订阅。
    // 实测拓扑（local 配对查看）也是两个不同 attachmentId（base-* 与 shared-host-attachment-*）、
    // 两条 hostConnectionId、两个 subscriptionId；任一同值意味着一端记录被另一端复用。
    if (desktopSubscribed && mobileSubscribed) {
      if (desktopSubscribed.hostConnectionId === mobileSubscribed.hostConnectionId) {
        failures.push({
          code: "cross-end-connection-reuse",
          detail: `desktop and mobile records share hostConnectionId=${desktopSubscribed.hostConnectionId}`,
        });
      }
      if (desktopSubscribed.subscriptionId === mobileSubscribed.subscriptionId) {
        failures.push({
          code: "cross-end-subscription-reuse",
          detail: `desktop and mobile records share subscriptionId=${desktopSubscribed.subscriptionId}`,
        });
      }
      if (desktopSubscribed.attachmentId === mobileSubscribed.attachmentId) {
        failures.push({
          code: "cross-end-attachment-reuse",
          detail: `desktop and mobile records share attachmentId=${desktopSubscribed.attachmentId}`,
        });
      }
    }

    for (const [label, record, query] of [
      ["desktop", desktopSubscribed, desktopQuery],
      ["mobile", mobileSubscribed, mobileQuery],
    ] as const) {
      if (!record) continue;
      // scope/会话一致性：Host 记录的 scope 必须自洽（scopeMatchesTarget），sessionId
      // 与 topic 对应，remote 记录的 scope 会话与订阅参数会话一致。
      if (!record.scopeMatchesTarget) {
        failures.push({
          code: "scope-mismatch",
          detail: `${label} record scope does not match its subscribe target (attachmentId=${record.attachmentId})`,
        });
      }
      if (record.sessionId !== input.sessionId) {
        failures.push({
          code: "session-mismatch",
          detail: `${label} host record session=${record.sessionId} expected=${input.sessionId}`,
        });
      }
      const expectedTopic = `conversation/${input.sessionId}`;
      if (record.topic !== expectedTopic) {
        failures.push({
          code: "topic-mismatch",
          detail: `${label} host record topic=${record.topic} expected=${expectedTopic}`,
        });
      }
      if (record.scope.kind === "remote" && query.target.remoteSessionId) {
        const scopeRemote = record.scope.kind === "remote" ? record.scope.remoteSessionId : null;
        if (scopeRemote && scopeRemote !== query.target.remoteSessionId) {
          failures.push({
            code: "remote-scope-mismatch",
            detail: `${label} scope remoteSessionId=${scopeRemote} pane resolved=${query.target.remoteSessionId}`,
          });
        }
      }
      // Host 侧 runtime 查询必须成功（existing-only；失败/缺失都不是证据）。
      if (!record.runtimeIdentity || record.runtimeIdentityError) {
        failures.push({
          code: "host-runtime-query-unavailable",
          detail: `${label} host runtime identity missing${
            record.runtimeIdentityError ? `: ${record.runtimeIdentityError}` : ""
          }`,
        });
        continue;
      }
      // pane 独立查询必须与 Host 对同一 attachment/scope 查到的 runtime identity 一致：
      // 不同 runtime（identity 含 pid+generation）即使 generation/state 相同也在此拒绝。
      if (
        query.status === "ok" &&
        query.identity &&
        query.identity !== record.runtimeIdentity.identity
      ) {
        failures.push({
          code: "identity-mismatch",
          detail: `${label} pane query identity=${query.identity} host record identity=${record.runtimeIdentity.identity}`,
        });
      }
      // workspace key 严格一致：identity?.trim() || path 回落；两侧同为空合法，
      // 单侧不同（含同路径不同 identity）在此拒绝。Host 侧优先用 runtime 查询返回值
      // （runtimeIdentity.workspaceKey，Host 对同一 attachment 实际查到的 key），
      // 不只比记录顶层按订阅参数推导的字段。
      const queryKey =
        resolveWorkspaceKey(query.target.workspaceIdentity, query.target.workspacePath) ||
        resolveWorkspaceKey(query.workspaceKey, undefined);
      const hostKey =
        resolveWorkspaceKey(record.runtimeIdentity?.workspaceKey, undefined) ||
        resolveWorkspaceKey(record.workspaceIdentity, record.workspacePath);
      if (queryKey !== hostKey) {
        failures.push({
          code: "workspace-key-mismatch",
          detail: `${label} pane workspaceKey=${queryKey || "<empty>"} host record workspaceKey=${hostKey || "<empty>"}`,
        });
      }
      // 查询返回值互证：两端都是对同一 runtime 的真实查询，返回的 workspaceKey 必须一致
      //（Host 返回 other-workspace 而 pane 查回本 workspace 即在此拒绝）。
      if (
        record.runtimeIdentity &&
        query.workspaceKey !== undefined &&
        query.workspaceKey.trim() &&
        query.workspaceKey.trim() !== record.runtimeIdentity.workspaceKey
      ) {
        failures.push({
          code: "host-returned-workspace-key-mismatch",
          detail: `${label} pane query returned workspaceKey=${query.workspaceKey} host runtime query returned=${record.runtimeIdentity.workspaceKey}`,
        });
      }
    }

    // 两端 pane 查询互相独立取得，但必须指向同一实例（identity 由各自查询得出，
    // 不是测试赋值）；workspace key 也必须一致（本地两侧同为空合法）。
    if (
      desktopQuery.status === "ok" &&
      mobileQuery.status === "ok" &&
      desktopQuery.identity &&
      mobileQuery.identity &&
      desktopQuery.identity !== mobileQuery.identity
    ) {
      failures.push({
        code: "cross-end-identity-mismatch",
        detail: `desktop=${desktopQuery.identity} mobile=${mobileQuery.identity}`,
      });
    }
    const desktopKey = resolveWorkspaceKey(
      desktopQuery.target.workspaceIdentity,
      desktopQuery.target.workspacePath,
    );
    const mobileKey = resolveWorkspaceKey(
      mobileQuery.target.workspaceIdentity,
      mobileQuery.target.workspacePath,
    );
    if (desktopKey !== mobileKey) {
      failures.push({
        code: "cross-end-workspace-key-mismatch",
        detail: `desktop=${desktopKey || "<empty>"} mobile=${mobileKey || "<empty>"}`,
      });
    }
  }

  return failures;
}

function pickSubscribedRecord(
  records: HostAttachmentSubscriptionRecord[],
  filter: {
    sessionId: string;
    clientMode: string;
    scopeKind: "local" | "remote";
    minSeq?: number;
    maxSeq?: number;
  },
): HostAttachmentSubscriptionRecord | null {
  const candidates = records.filter(
    (record) =>
      record.event === "subscribed" &&
      record.clientMode === filter.clientMode &&
      record.sessionId === filter.sessionId &&
      record.scope.kind === filter.scopeKind &&
      (filter.minSeq === undefined || record.seq >= filter.minSeq) &&
      (filter.maxSeq === undefined || record.seq <= filter.maxSeq),
  );
  if (candidates.length === 0) return null;
  // 只在调用方给定的 seq 范围内取最近的订阅。
  return candidates.reduce((latest, record) => (record.seq > latest.seq ? record : latest));
}
