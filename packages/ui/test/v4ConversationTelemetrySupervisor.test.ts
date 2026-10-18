    supervisor.handleFact({
      ...base,
      eventId: "usage-start",
      eventSeq: 1,
      kind: "turn.started",
    });
    const usage = {
      ...base,
      eventId: "usage-once",
      eventSeq: 2,
      kind: "usage.delta",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 18,
      reasoningTokens: 3,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    } satisfies ConversationTelemetryFact;
    supervisor.handleFact(usage);
    supervisor.handleFact(usage);
    supervisor.handleFact({
      ...base,
      eventId: "usage-chunk",
      eventSeq: 3,
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 1,
      firstChunk: true,
    });
    supervisor.handleFact({
      ...base,
      eventId: "usage-terminal",
      eventSeq: 4,
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();

    expect(
      reportsByElement(reportTelemetryEvent, "message_completion")[0]?.eventExtraDetail,
    ).toMatchObject({
      input_tokens: "10",
      output_tokens: "5",
      reasoning_tokens: "3",
      total_tokens: "18",
    });
    expect(reportsByElement(reportTelemetryEvent, "agent_step")[0]?.eventExtraDetail).toMatchObject(
      {
        input_tokens: "0",
        output_tokens: "0",
        cached_tokens: "0",
      },
    );
    supervisor.dispose();

  it("CronCreate 成功终态把新任务 automation_id 写入对应 agent_step", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-cron-create",
      now: () => 500,
    });
    supervisor.acceptPromptSeed({
      sessionId: "session-cron-create",
      sourceCommandId: "command-cron-create",
      sendTime: 100,
      extraDetail: { message_source: "chat", task_trigger: "" },
    });
    const base = {
      version: 1 as const,
      sessionId: "session-cron-create",
      sourceCommandId: "command-cron-create",
      turnId: "turn-cron-create",
    };
    supervisor.handleFact({
      ...base,
      eventId: "cron-turn-start",
      eventSeq: 1,
      occurredAt: 110,
      kind: "turn.started",
    });
    supervisor.handleFact({
      ...base,
      eventId: "cron-tool-start",
      eventSeq: 2,
      occurredAt: 120,
      kind: "tool.lifecycle",
      phase: "started",
      toolCallId: "tool-cron-create",
      toolName: "CronCreate",
    });
    supervisor.handleFact({
      ...base,
      eventId: "cron-tool-complete",
      eventSeq: 3,
      occurredAt: 150,
      kind: "tool.lifecycle",
      phase: "completed",
      toolCallId: "tool-cron-create",
      toolName: "CronCreate",
      automationId: "automation-created",
    });
    await supervisor.flushReportsForTest();

    expect(reportsByElement(reportTelemetryEvent, "agent_step")[0]?.eventExtraDetail).toMatchObject(
      {
        tool_name: "CronCreate",
        status: "success",
        automation_id: "automation-created",
      },
    );
    supervisor.dispose();
  });

  it("异步 reporter 仍严格按 send → step → completion 串行", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const releases: Array<() => void> = [];
    reportTelemetryEvent.mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-report-order",
      now: () => 100,
    });
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 10,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.handleFact({
      ...commonFact("order-start", 1),
      kind: "turn.started",
    });
    supervisor.handleFact({
      ...commonFact("order-model", 2),
      kind: "model.request.status",
      requestId: "request-1",
      status: "model_request_started",
      providerId: "provider",
      modelId: "model",
      transport: "fetch",
      attempt: 1,
      maxAttempts: 1,
    });
    supervisor.handleFact({
      ...commonFact("order-chunk", 3),
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 1,
      firstChunk: true,
    });
    supervisor.handleFact({
      ...commonFact("order-terminal", 4),
      kind: "turn.terminal",
      status: "success",
    });

    const reportedNames = () =>
      reportTelemetryEvent.mock.calls.map(([payload]) => payload.elementName);
    expect(reportedNames()).toEqual(["send_btn"]);
    releases.shift()?.();
    await vi.waitFor(() => expect(reportedNames()).toEqual(["send_btn", "agent_step"]));
    releases.shift()?.();
    await vi.waitFor(() =>
      expect(reportedNames()).toEqual(["send_btn", "agent_step", "message_completion"]),
    );
    releases.shift()?.();
    await supervisor.flushReportsForTest();
    supervisor.dispose();
  });

  it("ACK 前 buffer 保留 turn.started，并按 terminal key exactly-once", async () => {
    const { platform, reportTelemetryEvent, reportArmsCustomEvent } = createPlatform();
    setUiPerfArmsReporter(platform);
    let now = 1_000;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-buffer",
      now: () => now,
    });
    supervisor.handleFact({
      ...commonFact("buffer-start", 1),
      kind: "turn.started",
    });
    for (let index = 0; index < 140; index += 1) {
      now += 1;
      supervisor.handleFact({
        ...commonFact(`buffer-chunk-${index}`, index + 2),
        kind: "stream.chunk",
        channel: "text",
        chunkLength: 1,
        firstChunk: index === 0,
      });
    }
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 900,
      extraDetail: {
        model_name: "model",
        model_provider: "provider",
      },
    });
    supervisor.attachForeground({}, "session-1");
    now = 2_000;
    const terminal = {
      ...commonFact("buffer-terminal-1", 200),
      kind: "turn.terminal",
      status: "interrupted",
      resultType: "cancelled",
      errorCode: "USER_INTERRUPT",
      errorMessage: "stopped",
    } satisfies ConversationTelemetryFact;
    supervisor.handleFact(terminal);
    supervisor.handleFact({ ...terminal, eventId: "buffer-terminal-2", eventSeq: 201 });
    await supervisor.flushReportsForTest();

    const completion = reportsByElement(reportTelemetryEvent, "message_completion");
    expect(completion).toHaveLength(1);
    expect(completion[0]).toMatchObject({
      talkId: "session-1",
      messageId: "command-1",
      eventExtraDetail: {
        status: "user_interrupt",
        error_type: "USER_INTERRUPT",
        error_msg: "[redacted]",
        time_to_first_token: "101",
      },
    });
    // buffered chunk 到达时仍在 background；terminal 前切回也不能补造 UI TTFT。
    expect(armsByName(reportArmsCustomEvent, "perf_ui_first_token")).toHaveLength(0);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")).toHaveLength(0);
    expect(reportsByElement(reportTelemetryEvent, "agent_step")[0]).toMatchObject({
      eventExtraDetail: { status: "success" },
    });
    supervisor.dispose();
  });

  it("同 session direct 与 queued seed 依次 promotion，terminal 不清后续队列", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    let now = 100;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-queued",
      now: () => now,
    });
    for (const sourceCommandId of ["command-direct", "command-queued"]) {
      supervisor.acceptPromptSeed({
        sessionId: "session-queued",
        sourceCommandId,
        sendTime: now,
        extraDetail: { model_name: "model", model_provider: "provider" },
      });
      now += 10;
    }

    supervisor.handleFact({
      ...commonFact("direct-start", 1, "session-queued"),
      sourceCommandId: "command-direct",
      turnId: "turn-direct",
      kind: "turn.started",
    });
    now = 200;
    supervisor.handleFact({
      ...commonFact("direct-terminal", 2, "session-queued"),
      sourceCommandId: "command-direct",
      turnId: "turn-direct",
      kind: "turn.terminal",
      status: "success",
    });
    now = 300;
    supervisor.handleFact({
      ...commonFact("queued-start", 3, "session-queued"),
      sourceCommandId: "command-queued",
      turnId: "turn-queued",
      kind: "turn.started",
    });
    now = 400;
    supervisor.handleFact({
      ...commonFact("queued-terminal", 4, "session-queued"),
      sourceCommandId: "command-queued",
      turnId: "turn-queued",
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();

    expect(reportsByElement(reportTelemetryEvent, "send_btn")).toHaveLength(2);
    expect(
      reportsByElement(reportTelemetryEvent, "message_completion").map(
        (payload) => payload.messageId,
      ),
    ).toEqual(["command-direct", "command-queued"]);
    supervisor.dispose();
  });

  it("无本地 seed 的 command fact 使用 200 组 LRU 上限", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-pending-lru",
      now: () => 1_000,
    });
    for (let index = 0; index < 200; index += 1) {
      supervisor.handleFact({
        ...commonFact(`pending-${index}`, index, `session-${index}`),
        sourceCommandId: `command-${index}`,
        turnId: `turn-${index}`,
        kind: "turn.started",
      });
    }
    // 再命中 command-0，把它移到 LRU 尾部；新增 command-200 应淘汰 command-1。
    supervisor.handleFact({
      ...commonFact("pending-0-touch", 201, "session-0"),
      sourceCommandId: "command-0",
      turnId: "turn-0",
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 1,
      firstChunk: true,
    });
    supervisor.handleFact({
      ...commonFact("pending-200", 202, "session-200"),
      sourceCommandId: "command-200",
      turnId: "turn-200",
      kind: "turn.started",
    });
    expect(supervisor.getPendingCommandCountForTest()).toBe(200);

    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 900,
      extraDetail: {},
    });
    supervisor.handleFact({
      ...commonFact("evicted-terminal", 203, "session-1"),
      sourceCommandId: "command-1",
      turnId: "turn-1",
      kind: "turn.terminal",
      status: "success",
    });
    supervisor.acceptPromptSeed({
      sessionId: "session-0",
      sourceCommandId: "command-0",
      sendTime: 900,
      extraDetail: {},
    });
    supervisor.handleFact({
      ...commonFact("retained-terminal", 204, "session-0"),
      sourceCommandId: "command-0",
      turnId: "turn-0",
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();
    expect(
      reportsByElement(reportTelemetryEvent, "message_completion").map(
        (payload) => payload.messageId,
      ),
    ).toEqual(["command-0"]);
    supervisor.dispose();
  });

  it("foreground raw 负 TTFT 仅由 ui_perf 钳 0，plan_ttft 丢弃", () => {
    const { platform, reportArmsCustomEvent } = createPlatform();
    setUiPerfArmsReporter(platform);
    let now = 200;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-clock-rollback",
      now: () => now,
    });
    supervisor.attachForeground({}, "session-1");
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 200,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.handleFact({
      ...commonFact("rollback-start", 1),
      kind: "turn.started",
    });
    now = 100;
    supervisor.handleFact({
      ...commonFact("rollback-token", 2),
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 1,
      firstChunk: true,
    });
    now = 300;
    supervisor.handleFact({
      ...commonFact("rollback-terminal", 3),
      kind: "turn.terminal",
      status: "success",
    });
    expect(armsByName(reportArmsCustomEvent, "perf_ui_first_token")[0]?.value).toBe(0);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")).toHaveLength(0);
    supervisor.dispose();
  });

  it("plan_request 五态无需 seed，compaction 按到达时 foreground 与 operation 去重", () => {
    const { platform, reportTelemetryEvent, reportArmsCustomEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-independent",
      now: () => 2_000,
    });
    const statuses = [
      "model_request_started",
      "model_request_completed",
      "model_request_failed",
      "model_retry_scheduled",
      "model_stream_stalled",
    ] as const;
    statuses.forEach((status, index) => {
      supervisor.handleFact({
        ...commonFact(`plan-${index}`, index, "session-plan"),
        sourceCommandId: undefined,
        turnId: undefined,
        kind: "model.request.status",
        requestId: "request-plan",
        status,
        providerId: "provider",
        modelId: "model",
        transport: "fetch",
        attempt: 1,
        maxAttempts: 3,
      });
    });
    expect(
      armsByName(reportArmsCustomEvent, "plan_request").map(
        (payload) => payload.properties?.request_status,
      ),
    ).toEqual(["started", "completed", "failed", "retry_scheduled", "stream_stalled"]);

    const compaction = {
      ...commonFact("compact-1", 20, "session-compact"),
      sourceCommandId: undefined,
      turnId: undefined,
      kind: "compaction.terminal",
      operationId: "operation-1",
      summaryMessageId: "summary-1",
      status: "completed",
      trigger: "manual",
      reason: "manual request",
      attempt: 2,
      startedAt: 1_000,
      endedAt: 1_500,
      preCompactTokenCount: 100,
      postCompactTokenCount: 40,
      truePostCompactTokenCount: 35,
      modelName: "model",
      modelProvider: "provider",
    } satisfies ConversationTelemetryFact;
    supervisor.handleFact(compaction);
    expect(reportsByElement(reportTelemetryEvent, "context_compaction")).toHaveLength(0);
    supervisor.attachForeground({}, "session-compact");
    supervisor.handleFact({ ...compaction, eventId: "compact-2", eventSeq: 21 });
    supervisor.handleFact({ ...compaction, eventId: "compact-3", eventSeq: 22 });
    expect(reportsByElement(reportTelemetryEvent, "context_compaction")).toHaveLength(0);
    const foregroundCompaction = {
      ...compaction,
      eventId: "compact-4",
      eventSeq: 23,
      operationId: "operation-2",
      summaryMessageId: "summary-2",
    } satisfies ConversationTelemetryFact;
    supervisor.handleFact(foregroundCompaction);
    supervisor.handleFact({
      ...foregroundCompaction,
      eventId: "compact-5",
      eventSeq: 24,
      status: "failed",
      reason: "late contradictory terminal",
    });
    expect(reportsByElement(reportTelemetryEvent, "context_compaction")).toEqual([
      expect.objectContaining({
        elementName: "context_compaction",
        eventRegion: "app",
        eventType: "agent_trace",
        talkId: "session-compact",
        messageId: "summary-2",
        eventExtraDetail: {
          status: "completed",
          trigger: "manual",
          reason: "manual request",
          attempt: "2",
          duration_ms: "500",
          pre_compact_tokens: "100",
          post_compact_tokens: "40",
          true_post_compact_tokens: "35",
          compact_ratio: "0.4000",
          model_name: "provider/model",
          model_provider: "provider",
        },
      }),
    ]);
    supervisor.dispose();
  });

  it("compaction 不用 compactReason 回填旧 reason，glm 模型保持原值", () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-compact-legacy-fields",
      now: () => 2_000,
    });
    supervisor.attachForeground({}, "session-compact");
    supervisor.handleFact({
      ...commonFact("compact-legacy", 1, "session-compact"),
      sourceCommandId: undefined,
      turnId: undefined,
      kind: "compaction.terminal",
      operationId: "operation-legacy",
      status: "completed",
      trigger: "auto",
      compactReason: "context_limit",
      modelName: "glm-model",
      modelProvider: "glm",
    });
    expect(reportsByElement(reportTelemetryEvent, "context_compaction")[0]).toMatchObject({
      eventExtraDetail: {
        reason: "",
        model_name: "glm-model",
        model_provider: "glm",
      },
    });
    supervisor.dispose();
  });

  it("tool-first 与无 token terminal 保留旧 first-token ARMS 边界", () => {
    const { platform, reportArmsCustomEvent } = createPlatform();
    setUiPerfArmsReporter(platform);
    let now = 100;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-tool-first",
      now: () => now,
    });
    supervisor.attachForeground({}, "session-1");
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 100,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.handleFact({ ...commonFact("tool-first-start", 1), kind: "turn.started" });
    now = 140;
    supervisor.handleFact({
      ...commonFact("tool-first-tool", 2),
      kind: "tool.lifecycle",
      phase: "scheduled",
      toolCallId: "tool-1",
      toolName: "Read",
    });
    now = 200;
    supervisor.handleFact({
      ...commonFact("tool-first-terminal", 3),
      kind: "turn.terminal",
      status: "success",
    });
    expect(armsByName(reportArmsCustomEvent, "perf_ui_first_token")[0]?.value).toBe(40);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")[0]?.value).toBe(40);

    supervisor.acceptPromptSeed({
      sessionId: "session-2",
      sourceCommandId: "command-2",
      sendTime: 200,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.attachForeground({}, "session-2");
    supervisor.handleFact({
      ...commonFact("no-token-start", 4, "session-2"),
      sourceCommandId: "command-2",
      turnId: "turn-2",
      kind: "turn.started",
    });
    now = 260;
    supervisor.handleFact({
      ...commonFact("no-token-terminal", 5, "session-2"),
      sourceCommandId: "command-2",
      turnId: "turn-2",
      kind: "turn.terminal",
      status: "success",
    });
    expect(
      armsByName(reportArmsCustomEvent, "perf_ui_first_token").map((item) => item.value),
    ).toEqual([40, 0]);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")).toHaveLength(1);
    supervisor.dispose();
  });

  it("parented child text 不进入 generation，但保留旧 TTFT 与 stall", async () => {
    const { platform, reportTelemetryEvent, reportArmsCustomEvent } = createPlatform();
    setUiPerfArmsReporter(platform);
    let now = 100;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-parented-child",
      now: () => now,
    });
    supervisor.attachForeground({}, "session-1");
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 100,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.handleFact({ ...commonFact("child-start", 1), kind: "turn.started" });
    now = 150;
    supervisor.handleFact({
      ...commonFact("child-chunk-1", 2),
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 10,
      firstChunk: true,
      parentToolCallId: "parent-agent-tool",
    });
    now = 3_251;
    supervisor.handleFact({
      ...commonFact("child-chunk-2", 3),
      kind: "stream.chunk",
      channel: "text",
      chunkLength: 10,
      firstChunk: false,
      parentToolCallId: "parent-agent-tool",
    });
    now = 3_300;
    supervisor.handleFact({
      ...commonFact("child-terminal", 4),
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();
    expect(reportsByElement(reportTelemetryEvent, "agent_step")).toHaveLength(0);
    expect(armsByName(reportArmsCustomEvent, "perf_ui_stream_stall")[0]?.value).toBe(3_101);
    expect(armsByName(reportArmsCustomEvent, "perf_ui_first_token")[0]?.value).toBe(50);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")[0]?.value).toBe(50);
    supervisor.dispose();
  });

  it("parented child thought 保留旧 reasoning 与 TTFT 行为", async () => {
    const { platform, reportTelemetryEvent, reportArmsCustomEvent } = createPlatform();
    setUiPerfArmsReporter(platform);
    let now = 100;
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-parented-thought",
      now: () => now,
    });
    supervisor.attachForeground({}, "session-1");
    supervisor.acceptPromptSeed({
      sessionId: "session-1",
      sourceCommandId: "command-1",
      sendTime: 100,
      extraDetail: { model_name: "model", model_provider: "provider" },
    });
    supervisor.handleFact({ ...commonFact("thought-start", 1), kind: "turn.started" });
    now = 150;
    supervisor.handleFact({
      ...commonFact("parented-thought", 2),
      kind: "stream.chunk",
      channel: "thought",
      chunkLength: 10,
      firstChunk: true,
      parentToolCallId: "parent-agent-tool",
    });
    now = 200;
    supervisor.handleFact({
      ...commonFact("thought-terminal", 3),
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();
    expect(reportsByElement(reportTelemetryEvent, "agent_step")).toHaveLength(1);
    expect(armsByName(reportArmsCustomEvent, "perf_ui_first_token")[0]?.value).toBe(50);
    expect(armsByName(reportArmsCustomEvent, "plan_ttft")[0]?.value).toBe(50);
    supervisor.dispose();
  });

  it("chat_error_banner 复用既有 builder 上报真实可见错误", () => {
    const { platform, reportArmsCustomEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-error",
    });
    supervisor.reportVisibleChatError({
      errorKey: "error-1",
      displayMessage: "Request failed",
      error: {
        message: "raw request failed",
        code: "MODEL_ERROR",
        traceId: "trace-1",
        taskId: "session-1",
        detail: "detail",
      },
    });
    expect(armsByName(reportArmsCustomEvent, "chat_error_banner")).toEqual([
      {
        name: "chat_error_banner",
        group: "ui_error",
        value: 1,
        properties: expect.objectContaining({
          surface: "chat_input_error_banner",
          error_code: "MODEL_ERROR",
          error_message: "Request failed",
          trace_id: "trace-1",
          task_id: "session-1",
          has_detail: true,
          provider_business_action: "",
          provider_business_code: "",
        }),
      },
    ]);
    supervisor.dispose();
  });

  it("chat_error_banner 保留普通业务恢复维度并隐藏 3007 内部动作", () => {
    const { platform, reportArmsCustomEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-provider-errors",
    });
    supervisor.reportVisibleChatError({
      displayMessage: "Please login",
      error: { message: "login required", code: "1006" },
    });
    supervisor.reportVisibleChatError({
      displayMessage: "Security check rejected",
      error: { message: "security check rejected", code: "3007" },
    });
    expect(
      armsByName(reportArmsCustomEvent, "chat_error_banner").map((payload) => payload.properties),
    ).toEqual([
      expect.objectContaining({
        provider_business_action: "login",
        provider_business_code: "1006",
      }),
      expect.objectContaining({
        provider_business_action: "",
        provider_business_code: "",
      }),
    ]);
    supervisor.dispose();
  });

describe("workflow subagent：动态工作流子代理的 token 埋点（apps/zcode-cli/packages/dynamic-workflow/docs/execution-engine.md「Token telemetry for subagents」）", () => {
  const CHILD = "sess_dwf-run-1-worker_1";

  function spawnWorkflowActor(
    supervisor: ConversationTelemetrySupervisor,
    input: { sourceCommandId?: string; childSessionId?: string; agentId?: string } = {},
  ) {
    supervisor.handleFact({
      ...commonFact("wf-actor-spawned", 1, "parent-session"),
      ...(input.sourceCommandId === undefined
        ? { sourceCommandId: "launch-input-1" }
        : { sourceCommandId: input.sourceCommandId }),
      kind: "workflow.lifecycle",
      phase: "actor-spawned",
      runId: "dwfrun-1",
      toolCallId: "tool-wf",
      agentId: input.agentId ?? "worker@1",
      childSessionId: input.childSessionId ?? CHILD,
    });
  }

  function childUsage(
    supervisor: ConversationTelemetrySupervisor,
    eventId: string,
    requestId: string,
  ) {
    supervisor.handleFact({
      ...commonFact(`${eventId}-request`, 1, CHILD),
      turnId: "child-turn-1",
      kind: "model.request.status",
      requestId,
      status: "model_request_started",
      providerId: "glm-provider",
      modelId: "glm-5.3",
      providerHostname: "glm.example.com",
      transport: "sse",
      querySource: "workflow_child",
      attempt: 1,
      maxAttempts: 1,
    });
    supervisor.handleFact({
      ...commonFact(eventId, 2, CHILD),
      turnId: "child-turn-1",
      kind: "usage.delta",
      requestId,
      providerId: "glm-provider",
      modelId: "glm-5.3",
      providerHostname: "glm.example.com",
      inputTokens: 1000,
      outputTokens: 50,
      totalTokens: 1050,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  }

  function settleRun(
    supervisor: ConversationTelemetrySupervisor,
    status: "completed" | "errored" | "stopped",
    errorMessage?: string,
  ) {
    supervisor.handleFact({
      ...commonFact("wf-run-settled", 9, "parent-session"),
      sourceCommandId: "launch-input-1",
      kind: "workflow.lifecycle",
      phase: "run-settled",
      runId: "dwfrun-1",
      toolCallId: "tool-wf",
      status,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    });
  }

  it("工具 step 零 token 带角色与 run 字段；usage 按 requestId 去重；子会话 turn.terminal 不结算；run-settled 一条汇总 step", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-workflow-actor",
    });
    spawnWorkflowActor(supervisor);
    childUsage(supervisor, "wf-usage-1", "req-1");
    // 同一 requestId 重放（重连 / 重放）不重复计。
    childUsage(supervisor, "wf-usage-1-dup", "req-1");
    supervisor.handleFact({
      ...commonFact("wf-tool-start", 3, CHILD),
      turnId: "child-turn-1",
      kind: "tool.lifecycle",
      phase: "started",
      toolCallId: "bash-1",
      toolName: "Bash",
    });
    supervisor.handleFact({
      ...commonFact("wf-tool-done", 4, CHILD),
      turnId: "child-turn-1",
      kind: "tool.lifecycle",
      phase: "completed",
      toolCallId: "bash-1",
      toolName: "Bash",
      durationMs: 12,
    });
    // 一次 ask 结束：子会话自己的 turn.terminal 不是子代理终态。
    supervisor.handleFact({
      ...commonFact("wf-child-terminal", 5, CHILD),
      turnId: "child-turn-1",
      kind: "turn.terminal",
      status: "success",
    });
    await supervisor.flushReportsForTest();

    const beforeSettle = reportsByElement(reportTelemetryEvent, "agent_step");
    expect(beforeSettle).toHaveLength(1);
    expect(beforeSettle[0]).toEqual(
      expect.objectContaining({
        talkId: "parent-session",
        messageId: "launch-input-1",
        eventExtraDetail: expect.objectContaining({
          step_type: "tool_call",
          tool_name: "Bash",
          tool_call_id: "tool_workflow_worker@1_bash-1",
          agent_id: "worker@1",
          agent_role: "workflow subagent",
          workflow_run_id: "dwfrun-1",
          child_session_id: CHILD,
          workflow_tool_call_id: "tool-wf",
          total_tokens: "0",
          model_name: "glm-provider/glm-5.3",
        }),
      }),
    );

    // 第二次 ask 的用量继续累计到同一个子代理。
    supervisor.handleFact({
      ...commonFact("wf-usage-2", 6, CHILD),
      turnId: "child-turn-2",
      kind: "usage.delta",
      requestId: "req-2",
      providerId: "glm-provider",
      modelId: "glm-5.3",
      inputTokens: 200,
      outputTokens: 10,
      totalTokens: 210,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    settleRun(supervisor, "completed");
    await supervisor.flushReportsForTest();

    const steps = reportsByElement(reportTelemetryEvent, "agent_step");
    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual(
      expect.objectContaining({
        talkId: "parent-session",
        messageId: "launch-input-1",
        eventExtraDetail: expect.objectContaining({
          step_type: "tool_call",
          tool_name: "Agent",
          tool_call_id: "tool_workflow_worker@1_dwfrun-1",
          agent_id: "worker@1",
          agent_role: "workflow subagent",
          workflow_run_id: "dwfrun-1",
          status: "success",
          token_usage_scope: "subagent_requests",
          model_request_count: "2",
          input_tokens: "1200",
          output_tokens: "60",
          total_tokens: "1260",
          model_name: "glm-provider/glm-5.3",
          provider_name: "glm.example.com",
        }),
      }),
    );
    expect(reportsByElement(reportTelemetryEvent, "message_completion")).toHaveLength(0);
    supervisor.dispose();
  });

  it("停下的 run：每个子代理一条 fail 汇总 step，错误原文保留，无 usage 时 token 为 0", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-workflow-stopped",
    });
    spawnWorkflowActor(supervisor);
    settleRun(supervisor, "stopped", "Workflow run stopped (user)");
    await supervisor.flushReportsForTest();

    expect(reportsByElement(reportTelemetryEvent, "agent_step")).toEqual([
      expect.objectContaining({
        messageId: "launch-input-1",
        eventExtraDetail: expect.objectContaining({
          tool_name: "Agent",
          agent_role: "workflow subagent",
          status: "fail",
          error_msg: "[redacted]",
          model_request_count: "0",
          total_tokens: "0",
        }),
      }),
    ]);
    // 结算后迟到的用量不再改变任何上报（也不再有新的 step）。
    childUsage(supervisor, "wf-late", "req-late");
    await supervisor.flushReportsForTest();
    expect(reportsByElement(reportTelemetryEvent, "agent_step")).toHaveLength(1);
    supervisor.dispose();
  });

  it("没有锚点（sourceCommandId 缺席）不登记也不上报", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-workflow-no-anchor",
    });
    supervisor.handleFact({
      version: 1,
      eventId: "wf-no-anchor",
      eventSeq: 1,
      occurredAt: 1,
      sessionId: "parent-session",
      kind: "workflow.lifecycle",
      phase: "actor-spawned",
      runId: "dwfrun-1",
      agentId: "worker@1",
      childSessionId: CHILD,
    });
    childUsage(supervisor, "wf-usage", "req-1");
    settleRun(supervisor, "completed");
    await supervisor.flushReportsForTest();
    expect(reportsByElement(reportTelemetryEvent, "agent_step")).toHaveLength(0);
    supervisor.dispose();
  });

  it("workflow 通知唤起的 main turn 计为 main_plus_wf，message_source 为 background_workflow", async () => {
    const { platform, reportTelemetryEvent } = createPlatform();
    const supervisor = new ConversationTelemetrySupervisor({
      platform,
      workspaceScopeKey: "scope-workflow-composition",
    });
    supervisor.handleFact({
      ...commonFact("wf-wake-start", 1, "session-1"),
      sourceCommandId: "wf-wake-command",
      kind: "turn.started",
      inputSource: "background_task",
      backgroundSource: "workflow",
    });
    supervisor.handleFact({
      ...commonFact("wf-wake-terminal", 2, "session-1"),
      sourceCommandId: "wf-wake-command",
      kind: "turn.terminal",
      status: "success",
      workflowResultConsumed: true,
      backgroundSubagentResultConsumed: true,
    });
    await supervisor.flushReportsForTest();

    expect(completionAgentCompositions(reportTelemetryEvent)).toEqual(["main_plus_bg_wf"]);
    expect(
      reportsByElement(reportTelemetryEvent, "message_completion")[0]?.eventExtraDetail,
    ).toMatchObject({ message_source: "background_workflow" });
    supervisor.dispose();
  });
});
