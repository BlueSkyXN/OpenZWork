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
 */
export function verifyDirectAttachmentAssociation(input: {
  sessionId: string;
  desktopQuery: DirectPaneRuntimeQuery | null;
  mobileQuery: DirectPaneRuntimeQuery | null;
  /** Host probe 记录（查看结束后的完整序列）。 */
  hostRecords: HostAttachmentSubscriptionRecord[];
  /** 手机查看开始前的记录条数；窗口内的 subscribed 才算手机查看期间的真实订阅。 */
  recordsBeforeView: number;
}): DirectAssociationFailure[] {
  const failures: DirectAssociationFailure[] = [];
  const { desktopQuery, mobileQuery, hostRecords } = input;

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
    });
    const mobileSubscribed = pickSubscribedRecord(hostRecords, {
      sessionId: input.sessionId,
      clientMode: "web-remote-replayable",
      scopeKind: mobileScopeKind,
      minSeq: input.recordsBeforeView + 1,
    });

    // 桌面 attachment：desktop-continuous + 与 pane 解析一致的 scope + 该会话的真实订阅。
    if (!desktopSubscribed) {
      failures.push({
        code: "desktop-attachment-missing",
        detail: `no desktop-continuous/${desktopScopeKind} subscribed record for session ${input.sessionId}`,
      });
    }
    // 手机 attachment：web-remote-replayable + 与 pane 解析一致的 scope + 查看窗口内
    // 发生的订阅（seq > 查看前记录数）。旧订阅不算当前连接。
    if (!mobileSubscribed) {
      failures.push({
        code: "mobile-attachment-missing",
        detail: `no web-remote-replayable/${mobileScopeKind} subscribed record for session ${input.sessionId} after view start (recordsBeforeView=${input.recordsBeforeView})`,
      });
    }

    // 订阅有效性：桌面订阅在查看期间不得收到 unsubscribed / attachment-disposed。
    if (desktopSubscribed) {
      const ended = hostRecords.find(
        (record) =>
          record.subscriptionId === desktopSubscribed.subscriptionId &&
          record.attachmentId === desktopSubscribed.attachmentId &&
          record.seq > desktopSubscribed.seq &&
          (record.event === "unsubscribed" || record.event === "attachment-disposed"),
      );
      if (ended) {
        failures.push({
          code: "subscription-ended",
          detail: `desktop subscription ${desktopSubscribed.subscriptionId} ended before/while viewing (event=${ended.event}, seq=${ended.seq})`,
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
      // 单侧不同（含同路径不同 identity）在此拒绝。
      const queryKey =
        resolveWorkspaceKey(query.target.workspaceIdentity, query.target.workspacePath) ||
        resolveWorkspaceKey(query.workspaceKey, undefined);
      const hostKey = resolveWorkspaceKey(record.workspaceIdentity, record.workspacePath);
      if (queryKey !== hostKey) {
        failures.push({
          code: "workspace-key-mismatch",
          detail: `${label} pane workspaceKey=${queryKey || "<empty>"} host record workspaceKey=${hostKey || "<empty>"}`,
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
  },
): HostAttachmentSubscriptionRecord | null {
  const candidates = records.filter(
    (record) =>
      record.event === "subscribed" &&
      record.clientMode === filter.clientMode &&
      record.sessionId === filter.sessionId &&
      record.scope.kind === filter.scopeKind &&
      (filter.minSeq === undefined || record.seq >= filter.minSeq),
  );
  if (candidates.length === 0) return null;
  // 取窗口内最后一次订阅（重订阅以最新为准）。
  return candidates.reduce((latest, record) => (record.seq > latest.seq ? record : latest));
}
