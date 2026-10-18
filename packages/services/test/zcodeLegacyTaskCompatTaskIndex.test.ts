
  it("backfills indexed thought level for web replayable snapshot resume", async () => {
    const { agent, service, taskIndexRepo } = createService();
    const taskId = "replayable_glm52_task";
    const workspacePath = "/repo";
    await seedIndexedTask(taskIndexRepo, {
      taskId,
      workspacePath,
      provider: "glm",
      model: "bigmodel-api/GLM-5.2",
      thoughtLevel: "high",
    });
    vi.mocked(agent.resumeSession).mockResolvedValueOnce(
      makeSnapshot({
        sessionId: taskId,
        workspacePath,
      }),
    );

    await service.getTaskSnapshot({
      workspacePath,
      taskId,
      clientMode: "web-remote-replayable",
    });

    expect(agent.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        workspaceIdentity: undefined,
        sessionId: taskId,
        model: {
          providerId: "bigmodel-api",
          modelId: "GLM-5.2",
        },
        thoughtLevel: "high",
      }),
    );
  });

  it("skips indexed model backfill for web replayable ui-resolved snapshot restore", async () => {
    const { agent, service, taskIndexRepo } = createService();
    const taskId = "replayable_readonly_unavailable_model";
    const workspacePath = "/repo";
    await seedIndexedTask(taskIndexRepo, {
      taskId,
      workspacePath,
      provider: "glm",
      model: "account:bigmodel-individual-coding-plan/GLM-5.2",
      thoughtLevel: "max",
    });
    vi.mocked(agent.resumeSession).mockResolvedValueOnce(
      makeSnapshot({
        sessionId: taskId,
        workspacePath,
      }),
    );

    await service.getTaskSnapshot({
      workspacePath,
      taskId,
      clientMode: "web-remote-replayable",
      resumeModelPolicy: "ui-resolved-only",
    } as Parameters<typeof service.getTaskSnapshot>[0]);

    const resumeParams = vi.mocked(agent.resumeSession).mock.calls[0]?.[0];
    expect(resumeParams).toMatchObject({
      workspacePath,
      workspaceIdentity: undefined,
      sessionId: taskId,
      model: undefined,
    });
    expect(resumeParams?.thoughtLevel).toBeUndefined();
  });

  it("marks idle protocol snapshots with completed assistant turns as completed tasks", async () => {
    const { agent, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const restored = makeSnapshot({
      sessionId: task.taskId,
      workspacePath: "/repo",
      messages: [
        makeUserMessage({
          sessionId: task.taskId,
          messageId: "msg_user_done",
          text: "继续执行",
        }),
        makeAssistantAgentToolMessage({
          sessionId: task.taskId,
          messageId: "msg_assistant_done",
          toolCallId: "tool_done",
        }),
      ],
    });
    vi.mocked(agent.resumeSession).mockResolvedValueOnce({
      ...restored,
      session: {
        ...restored.session,
        status: "idle",
      },
      projection: {
        ...restored.projection,
        status: "idle",
        pendingPermissions: [],
        activeToolCalls: [],
      },
      runtime: {
        ...restored.runtime,
        pendingRequestIds: [],
      },
    });

    const snapshot = await service.getTaskSnapshot({
      workspacePath: "/repo",
      taskId: task.taskId,
    });

    expect(snapshot?.meta.status).toBe("completed");
  });

  it("marks protocol task snapshots when messageLimit trims older history", async () => {
    const { agent, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    vi.mocked(agent.resumeSession).mockResolvedValueOnce(
      makeSnapshot({
        sessionId: task.taskId,
        workspacePath: "/repo",
        messages: [
          makeUserMessage({
            sessionId: task.taskId,
            messageId: "message_1",
            text: "message 1",
          }),
          makeUserMessage({
            sessionId: task.taskId,
            messageId: "message_2",
            text: "message 2",
          }),
          makeUserMessage({
            sessionId: task.taskId,
            messageId: "message_3",
            text: "message 3",
          }),
        ],
      }),
    );

    const snapshot = await service.getTaskSnapshot({
      workspacePath: "/repo",
      taskId: task.taskId,
      messageLimit: 2,
    });

    expect(snapshot?.messages.map((message) => message.content)).toEqual([
      "message 2",
      "message 3",
    ]);
    expect(snapshot?.history?.truncatedBefore).toBe(true);
    expect(snapshot?.history?.totalMessages).toBe(3);
  });

  it("restores legacy v2 task snapshots when the protocol session is missing", async () => {
    const { agent, service } = createService();
    const workspacePath = "/repo";
    const taskId = "legacy_task";
    const snapshotPath = getLegacyTaskSessionSnapshotPath(workspacePath, taskId);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        meta: {
          taskId,
          traceId: "trace_legacy",
          title: "Legacy ACP task",
          workspacePath,
          createdAt: 10,
          updatedAt: 20,
          mode: "yolo",
          provider: "glm",
        },
        messages: [
          {
            role: "user",
            content: "old prompt",
            timestamp: 10,
          },
        ],
      }),
      "utf-8",
    );
    vi.mocked(agent.resumeSession).mockRejectedValue(new Error(`Session not found: ${taskId}`));

    const snapshot = await service.getTaskSnapshot({ workspacePath, taskId });

    expect(snapshot?.meta).toMatchObject({
      taskId,
      title: "Legacy ACP task",
      workspacePath,
      status: "completed",
    });
    expect(snapshot?.messages.map((message) => message.content)).toEqual(["old prompt"]);

    vi.mocked(agent.onDynamicSessionEvent).mockClear();
    const disposable = service.onDynamicTaskEvent({
      workspacePath,
      taskId,
      deliveryKind: "continuous",
    })(() => undefined);
    disposable.dispose();

    expect(agent.onDynamicSessionEvent).not.toHaveBeenCalled();
  });

  it("upgrades legacy imported Claude snapshots to protocol sessions before model switching", async () => {
    const { agent, service, taskIndexRepo } = createService();
    const workspacePath = "/repo";
    const taskId = "claude-import-590ccc622ab6db6bd9f1d7bf";
    const snapshotPath = getLegacyTaskSessionSnapshotPath(workspacePath, taskId);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        meta: {
          taskId,
          traceId: "trace_claude_import",
          title: "Claude imported task",
          workspacePath,
          createdAt: 10,
          updatedAt: 20,
          provider: "glm",
          migrationSource: "claudeCode",
        },
        messages: [
          {
            role: "user",
            content: "旧 Claude 提问",
            timestamp: 10,
          },
          {
            role: "assistant",
            content: "旧 Claude 回答",
            timestamp: 20,
          },
        ],
      }),
      "utf-8",
    );
    vi.mocked(agent.resumeSession).mockImplementation(async (params) => {
      throw new Error(`Session not found: ${params.sessionId}`);
    });

    const snapshot = await service.getTaskSnapshot({ workspacePath, taskId });

    expect(agent.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        workspaceIdentity: undefined,
        sessionId: taskId,
        persistence: "immediate",
        importedHistory: expect.objectContaining({
          source: "claudeCode",
          title: "Claude imported task",
          messages: [
            { role: "user", content: "旧 Claude 提问", timestamp: 10 },
            { role: "assistant", content: "旧 Claude 回答", timestamp: 20 },
          ],
        }),
      }),
    );
    expect(snapshot?.meta).toMatchObject({
      taskId,
      title: "Claude imported task",
      workspacePath,
      migrationSource: "claudeCode",
      model: "glm/glm-4.6",
    });
    expect(snapshot?.messages.map((message) => message.content)).toEqual([
      "旧 Claude 提问",
      "旧 Claude 回答",
    ]);
    await expect(taskIndexRepo.getTaskMeta({ workspacePath, taskId })).resolves.toMatchObject({
      taskId,
      migrationSource: "claudeCode",
      model: "glm/glm-4.6",
    });

    vi.mocked(agent.resumeSession).mockRestore();
    await service.setModel({
      taskId,
      traceId: "trace_set_model",
      modelSelection: { providerId: "glm", modelId: "glm-4.6" },
    });

    expect(agent.setModel).toHaveBeenCalledWith({
      workspacePath,
      workspaceIdentity: undefined,
      sessionId: taskId,
      model: { providerId: "glm", modelId: "glm-4.6" },
    });
  });

  it("repairs empty protocol snapshots for imported Claude tasks from legacy backups", async () => {
    const { agent, service } = createService();
    const workspacePath = "/repo";
    const taskId = "claude-import-empty-protocol";
    const snapshotPath = getLegacyTaskSessionSnapshotPath(workspacePath, taskId);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        meta: {
          taskId,
          traceId: "trace_empty_protocol",
          title: "Claude empty protocol",
          workspacePath,
          createdAt: 10,
          updatedAt: 20,
          migrationSource: "claudeCode",
        },
        messages: [
          { role: "user", content: "旧问题", timestamp: 10 },
          { role: "assistant", content: "旧回答", timestamp: 20 },
        ],
      }),
      "utf-8",
    );
    vi.mocked(agent.resumeSession).mockResolvedValue(
      makeSnapshot({
        sessionId: taskId,
        workspacePath,
        title: "Claude empty protocol",
        messages: [],
      }),
    );

    const snapshot = await service.getTaskSnapshot({ workspacePath, taskId });

    expect(agent.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        sessionId: taskId,
        persistence: "immediate",
        importedHistory: expect.objectContaining({
          source: "claudeCode",
          messages: [
            { role: "user", content: "旧问题", timestamp: 10 },
            { role: "assistant", content: "旧回答", timestamp: 20 },
          ],
        }),
      }),
    );
    expect(snapshot?.messages.map((message) => message.content)).toEqual(["旧问题", "旧回答"]);
    expect(snapshot?.meta).toMatchObject({
      taskId,
      migrationSource: "claudeCode",
    });
  });

  it("migrates legacy wrapper task ids to acp_session_id backed protocol sessions", async () => {
    const { agent, service, taskIndexRepo } = createService();
    const workspacePath = "/repo";
    const taskId = "legacy_wrapper_task";
    const acpSessionId = "sess_legacy_real";
    await seedIndexedTask(taskIndexRepo, {
      taskId,
      provider: "glm",
      workspacePath,
    });
    await seedLegacyAcpSessionId(taskIndexRepo, {
      workspacePath,
      taskId,
      acpSessionId,
    });

    await expect(taskIndexRepo.getTaskMeta({ workspacePath, taskId })).resolves.toBeNull();
    await expect(
      taskIndexRepo.getTaskMeta({ workspacePath, taskId: acpSessionId }),
    ).resolves.toMatchObject({
      taskId: acpSessionId,
      workspacePath,
      provider: "glm",
    });

    const dbSnapshot = makeSnapshot({
      sessionId: acpSessionId,
      workspacePath,
      title: "DB session",
      messages: [
        makeUserMessage({
          sessionId: acpSessionId,
          messageId: "msg_db_user",
          text: "db prompt",
        }),
      ],
    });
    vi.mocked(agent.resumeSession).mockImplementation(async (params) => {
      if (params.sessionId === acpSessionId) {
        return dbSnapshot;
      }
      throw new Error(`Session not found: ${params.sessionId}`);
    });

    const snapshot = await service.getTaskSnapshot({
      workspacePath,
      taskId: acpSessionId,
    });

    expect(snapshot?.meta).toMatchObject({
      taskId: acpSessionId,
      title: "DB session",
      workspacePath,
      model: "glm/glm-4.6",
      thoughtLevel: "think",
    });
    expect(snapshot?.messages.map((message) => message.content)).toEqual(["db prompt"]);
    expect(agent.resumeSession).toHaveBeenCalledWith({
      workspacePath,
      workspaceIdentity: undefined,
      sessionId: acpSessionId,
    });

    const disposable = service.onDynamicTaskEvent({
      workspacePath,
      taskId: acpSessionId,
      deliveryKind: "continuous",
    })(() => undefined);
    disposable.dispose();
    expect(agent.onDynamicSessionEvent).toHaveBeenCalledWith({
      workspacePath,
      workspaceIdentity: undefined,
      sessionId: acpSessionId,
      deliveryKind: "desktop-continuous",
      includeSnapshot: false,
    });

    await service.sendPrompt({
      taskId: acpSessionId,
      traceId: "input_1",
      content: "continue",
    });
    expect(agent.sendConversationCommandV4).toHaveBeenCalledWith({
      workspacePath,
      workspaceIdentity: undefined,
      envelope: expect.objectContaining({
        type: "sendText",
        sessionId: acpSessionId,
        commandId: "input_1",
        payload: { text: "continue", heldQueueDisposition: "keepQueueAndSend" },
      }),
    });
  });

  it("maps ZCode Protocol context projection events to legacy usage_update", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_usage",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_usage",
        type: "session.updated",
        payload: {
          contextUsed: 24000,
          contextWindow: 128000,
        },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual({
      type: "usage_update",
      taskId: task.taskId,
      traceId: "trace_usage",
      used: 24000,
      size: 128000,
      cost: null,
    });
  });

  it.each([
    { streamed: "", expected: "完整项目说明" },
    { streamed: "完整项目", expected: "说明" },
    { streamed: "完整项目说明", expected: "" },
  ])(
    "补齐工具调用后缺失的终态正文且不重复已收到的部分：$streamed",
    async ({ streamed, expected }) => {
      const { eventEmitter, service } = createService();
      const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
      const received: ZCodeStreamEvent[] = [];
      const subscription = service.onDynamicTaskEvent({
        workspacePath: "/repo",
        taskId: task.taskId,
        deliveryKind: "bot-channel-continuous",
      })((event) => {
        received.push(event);
      });
      let seq = 0;
      const emit = (
        type: ZCodeSessionEvent["type"],
        payload: Record<string, unknown>,
        turnId = "turn_repair",
      ) => {
        eventEmitter.fire({
          type: "session.event",
          event: {
            eventId: `repair_${++seq}`,
            sessionId: task.taskId,
            turnId,
            seq,
            timestamp: seq,
            traceId: turnId,
            type,
            payload,
          },
        });
      };
      emit("turn.started", { inputId: "input_repair" });
      emit("session.updated", {
        kind: "text_delta",
        delta: "我来看一下项目目录的内容。",
        assistantMessageId: "preface",
      });
      emit("tool.updated", {
        kind: "scheduled",
        toolCallId: "read_project",
        toolName: "Read",
        input: {},
      });
      if (streamed)
        emit("session.updated", {
          kind: "text_delta",
          delta: streamed,
          assistantMessageId: "answer",
        });
      const before = received.length;
      emit("turn.completed", {
        inputId: "input_repair",
        response: "完整项目说明",
        resultType: "success",
      });
      const terminal = received.slice(before);
      expect(
        terminal
          .filter((event) => event.type === "agent_message_chunk")
          .map((event) => event.content)
          .join(""),
      ).toBe(expected);
      expect(terminal.at(-1)?.type).toBe("task_complete");
      emit("turn.started", { inputId: "input_next" }, "turn_next");
      const next = received.length;
      emit(
        "turn.completed",
        { inputId: "input_next", response: "完整项目说明", resultType: "success" },
        "turn_next",
      );
      expect(received.slice(next)).toContainEqual(
        expect.objectContaining({
          type: "agent_message_chunk",
          content: "完整项目说明",
          inputId: "input_next",
        }),
      );
      subscription.dispose();
    },
  );

  it("不同 assistant message 的正文独立核对，不受前言或子代理文字影响", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const subscription = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "bot-channel-continuous",
    })((event) => {
      received.push(event);
    });
    let seq = 0;
    const emit = (
      payload: Record<string, unknown>,
      type: "session.updated" | "turn.completed" = "session.updated",
    ) =>
      eventEmitter.fire({
        type: "session.event",
        event: {
          eventId: `message_${++seq}`,
          sessionId: task.taskId,
          turnId: "message_turn",
          seq,
          timestamp: seq,
          traceId: "message_turn",
          type,
          payload,
        },
      });
    emit({ kind: "text_delta", assistantMessageId: "preface", delta: "先检查。" });
    emit({ kind: "text_delta", assistantMessageId: "answer", delta: "最终" });
    emit({
      kind: "text_delta",
      assistantMessageId: "child",
      parentToolUseId: "agent_tool",
      delta: "子代理内容",
    });
    const before = received.length;
    emit({ response: "最终回答", resultType: "success" }, "turn.completed");
    expect(received.slice(before)).toEqual([
      expect.objectContaining({ type: "agent_message_chunk", content: "回答" }),
      expect.objectContaining({ type: "task_complete" }),
    ]);
    subscription.dispose();
  });

  it("uses prompt inputId as per-turn traceId for session stream events", async () => {
    const { agent, eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    await service.sendPrompt({
      taskId: task.taskId,
      traceId: "input_turn_1",
      content: "continue",
    });
    expect(agent.sendConversationCommandV4).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({ commandId: "input_turn_1" }),
      }),
    );

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_stream",
        sessionId: task.taskId,
        turnId: "turn_1",
        seq: 1,
        timestamp: 2,
        traceId: "runtime_trace_1",
        type: "session.updated",
        payload: { kind: "text_delta", delta: "hello" },
      },
    });
    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_tool",
        sessionId: task.taskId,
        turnId: "turn_1",
        seq: 2,
        timestamp: 3,
        traceId: "runtime_trace_1",
        type: "tool.updated",
        payload: {
          kind: "scheduled",
          toolCallId: "call_1",
          toolName: "Read",
          input: { filePath: "/repo/app.ts" },
        },
      },
    });
    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_done",
        sessionId: task.taskId,
        turnId: "turn_1",
        seq: 3,
        timestamp: 4,
        traceId: "runtime_trace_1",
        type: "turn.completed",
        payload: { inputId: "input_turn_1", resultType: "success" },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual(
      expect.objectContaining({
        type: "agent_message_chunk",
        traceId: "input_turn_1",
        inputId: "input_turn_1",
      }),
    );
    expect(received).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        traceId: "input_turn_1",
        inputId: "input_turn_1",
        toolId: "call_1",
      }),
    );
    expect(received).toContainEqual(
      expect.objectContaining({
        type: "task_complete",
        traceId: "input_turn_1",
        inputId: "input_turn_1",
      }),
    );
  });

  it("maps main turn model usage with context window to legacy usage_update", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_model_usage",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_model_usage",
        type: "session.updated",
        payload: {
          contextWindow: 1_000_000,
          querySource: "main_turn",
          usage: {
            inputTokens: 279454,
            outputTokens: 177,
            totalTokens: 279631,
            cacheReadTokens: 1000,
            cacheWriteTokens: 200,
            cacheHitRate: 0.25,
          },
          contextUsageBreakdown: [
            { source: "messages", chars: 1200 },
            { source: "system_tool_schemas", chars: 300 },
          ],
        },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual({
      type: "usage_update",
      taskId: task.taskId,
      traceId: "trace_model_usage",
      used: 279631,
      size: 1_000_000,
      cost: null,
      cache: {
        inputTokens: 279454,
        cacheReadTokens: 1000,
        cacheWriteTokens: 200,
        latestHitRate: 0.25,
        hitRate: 0.25,
      },
      breakdown: [
        { source: "messages", chars: 1200 },
        { source: "system_tool_schemas", chars: 300 },
      ],
    });
    expect(received).toContainEqual({
      type: "task_token_usage_delta",
      taskId: task.taskId,
      traceId: "trace_model_usage",
      eventKey: "evt_model_usage",
      eventId: "evt_model_usage",
      querySource: "main_turn",
      usage: {
        inputTokens: 279454,
        outputTokens: 177,
        totalTokens: 279631,
        reasoningTokens: undefined,
        cachedInputTokens: 1000,
        cachedWriteInputTokens: 200,
      },
    });
  });

  it("maps aggregate main turn cache hit usage to legacy usage_update", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_model_usage_average",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_model_usage_average",
        type: "session.updated",
        payload: {
          contextWindow: 1_000_000,
          querySource: "main_turn",
          cacheHit: {
            inputTokens: 200,
            cacheReadTokens: 80,
            cacheWriteTokens: 10,
            latestHitRate: 0.4,
            hitRate: 0.3,
            hitRateRequestCount: 2,
            totalInputTokens: 500,
            totalCacheReadTokens: 150,
            totalCacheWriteTokens: 25,
          },
          usage: {
            inputTokens: 200,
            outputTokens: 20,
            totalTokens: 220,
            cacheReadTokens: 80,
            cacheWriteTokens: 10,
          },
        },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual({
      type: "usage_update",
      taskId: task.taskId,
      traceId: "trace_model_usage_average",
      used: 220,
      size: 1_000_000,
      cost: null,
      cache: {
        inputTokens: 200,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
        latestHitRate: 0.4,
        hitRate: 0.3,
        hitRateRequestCount: 2,
        totalInputTokens: 500,
        totalCacheReadTokens: 150,
        totalCacheWriteTokens: 25,
      },
    });
  });

  it("prefers real main turn model usage over projected context used", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_model_usage_projection",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_model_usage_projection",
        type: "session.updated",
        payload: {
          contextUsed: 64000,
          contextWindow: 1_000_000,
          querySource: "main_turn",
          usage: {
            inputTokens: 12345,
            outputTokens: 77,
            totalTokens: 12422,
          },
        },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual({
      type: "usage_update",
      taskId: task.taskId,
      traceId: "trace_model_usage_projection",
      used: 12422,
      size: 1_000_000,
      cost: null,
    });
    expect(received).toContainEqual({
      type: "task_token_usage_delta",
      taskId: task.taskId,
      traceId: "trace_model_usage_projection",
      eventKey: "evt_model_usage_projection",
      eventId: "evt_model_usage_projection",
      querySource: "main_turn",
      usage: {
        inputTokens: 12345,
        outputTokens: 77,
        totalTokens: 12422,
        reasoningTokens: undefined,
        cachedInputTokens: undefined,
        cachedWriteInputTokens: undefined,
      },
    });
  });

  it("does not map sidecar model usage to legacy usage_update", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_title_usage",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_title_usage",
        type: "session.updated",
        payload: {
          contextWindow: 1_000_000,
          querySource: "session_title",
          usage: {
            inputTokens: 89,
            outputTokens: 84,
            totalTokens: 173,
          },
        },
      },
    });
    disposable.dispose();

    expect(received).not.toContainEqual(
      expect.objectContaining({
        type: "usage_update",
        traceId: "trace_title_usage",
      }),
    );
    expect(received).toContainEqual({
      type: "task_token_usage_delta",
      taskId: task.taskId,
      traceId: "trace_title_usage",
      eventKey: "evt_title_usage",
      eventId: "evt_title_usage",
      querySource: "session_title",
      usage: {
        inputTokens: 89,
        outputTokens: 84,
        totalTokens: 173,
        reasoningTokens: undefined,
        cachedInputTokens: undefined,
        cachedWriteInputTokens: undefined,
      },
    });
  });

  it("maps ZCode model retry status to apiRetry stream events and runtime snapshots", async () => {
    const { eventEmitter, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    const received: ZCodeStreamEvent[] = [];
    const disposable = service.onDynamicTaskEvent({
      workspacePath: "/repo",
      taskId: task.taskId,
      deliveryKind: "continuous",
    })((event) => {
      received.push(event);
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_retry",
        sessionId: task.taskId,
        seq: 1,
        timestamp: 2,
        traceId: "trace_retry",
        type: "session.updated",
        payload: {
          type: "model_retry_scheduled",
          attempt: 1,
          maxAttempts: 4,
          delayMs: 2_000,
          statusCode: 429,
          message: "rate limited",
        },
      },
    });

    expect(received).toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: {
        kind: "api_retry",
        attempt: 1,
        maxRetries: 3,
        retryDelayMs: 2_000,
        errorStatus: 429,
        error: "rate limited",
      },
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: {
          kind: "api_retry",
          attempt: 1,
          maxRetries: 3,
          retryDelayMs: 2_000,
          errorStatus: 429,
          error: "rate limited",
        },
      },
    });

    const retryStartedReceivedIndex = received.length;
    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_retry_started",
        sessionId: task.taskId,
        seq: 2,
        timestamp: 3,
        traceId: "trace_retry",
        type: "session.updated",
        payload: {
          type: "model_request_started",
          attempt: 2,
          maxAttempts: 4,
          requestId: "request_retry",
        },
      },
    });
    const retryStartedEvents = received.slice(retryStartedReceivedIndex);
    expect(retryStartedEvents).toContainEqual(
      expect.objectContaining({
        type: "task_network_debug_status",
        taskId: task.taskId,
        traceId: "trace_retry",
        eventKey: "evt_retry_started",
        statusType: "model_request_started",
        attempt: 2,
        maxAttempts: 4,
      }),
    );
    expect(retryStartedEvents).not.toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: null,
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: {
          kind: "api_retry",
          attempt: 1,
          maxRetries: 3,
          retryDelayMs: 2_000,
          errorStatus: 429,
          error: "rate limited",
        },
      },
    });

    const retryProgressReceivedIndex = received.length;
    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_retry_progress",
        sessionId: task.taskId,
        seq: 3,
        timestamp: 4,
        traceId: "trace_retry",
        type: "session.updated",
        payload: {
          kind: "text_delta",
          delta: "recovered",
          assistantMessageId: "msg_retry",
        },
      },
    });
    const retryProgressEvents = received.slice(retryProgressReceivedIndex);
    expect(retryProgressEvents).toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: null,
    });
    expect(retryProgressEvents).toContainEqual({
      type: "agent_message_chunk",
      taskId: task.taskId,
      traceId: "trace_retry",
      messageId: "msg_retry",
      content: "recovered",
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: null,
      },
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_stream_recovery_retry",
        sessionId: task.taskId,
        seq: 4,
        timestamp: 5,
        traceId: "trace_retry",
        type: "session.updated",
        payload: {
          type: "model_request_started",
          attempt: 1,
          maxAttempts: 11,
          requestId: "request_recovery",
          streamRecovery: {
            attemptId: "stream_attempt_1",
            anchorId: "anchor_1",
            maxRetries: 10,
            recoveredFromRequestId: "request_failed",
            retryNumber: 3,
          },
        },
      },
    });

    expect(received).toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: {
        kind: "api_retry",
        attempt: 3,
        maxRetries: 10,
        retryDelayMs: 0,
        errorStatus: null,
        error: "Model stream recovery retry started",
      },
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: {
          kind: "api_retry",
          attempt: 3,
          maxRetries: 10,
          retryDelayMs: 0,
          errorStatus: null,
          error: "Model stream recovery retry started",
        },
      },
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_stream_recovery_progress",
        sessionId: task.taskId,
        seq: 5,
        timestamp: 6,
        traceId: "trace_retry",
        type: "streamRecovery.updated",
        payload: {
          attemptId: "stream_attempt_2",
          failedRequestId: "request_failed",
          maxRetries: 10,
          recoveredFromRequestId: "request_failed",
          retryNumber: 4,
          streamMode: "sse",
        },
      },
    });

    expect(received).toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: {
        kind: "api_retry",
        attempt: 4,
        maxRetries: 10,
        retryDelayMs: 0,
        errorStatus: null,
        error: "Model stream recovery retry started",
      },
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: {
          kind: "api_retry",
          attempt: 4,
          maxRetries: 10,
          retryDelayMs: 0,
          errorStatus: null,
          error: "Model stream recovery retry started",
        },
      },
    });

    eventEmitter.fire({
      type: "session.event",
      event: {
        eventId: "evt_retry_clear",
        sessionId: task.taskId,
        seq: 6,
        timestamp: 7,
        traceId: "trace_retry",
        type: "session.updated",
        payload: {
          type: "model_request_completed",
          attempt: 2,
          maxAttempts: 4,
        },
      },
    });
    disposable.dispose();

    expect(received).toContainEqual({
      type: "session_info_update",
      taskId: task.taskId,
      traceId: "trace_retry",
      apiRetry: null,
    });
    await expect(
      service.getTaskSnapshot({ workspacePath: "/repo", taskId: task.taskId }),
    ).resolves.toMatchObject({
      runtime: {
        apiRetry: null,
      },
    });
  });

  it("keeps pinned state in sqlite without resuming the agent session", async () => {
    const { agent, service } = createService();
    const task = await service.createTask({ workspacePath: "/repo", provider: "glm" });
    vi.mocked(agent.resumeSession).mockClear();

    await service.setTaskPinned({
      workspacePath: "/repo",
      taskId: task.taskId,
      pinned: true,
    });
    const pinned = await service.listPinnedTasks({ workspacePath: "/repo" });
    const active = await service.listTasks({ workspacePath: "/repo" });

    expect(agent.resumeSession).not.toHaveBeenCalled();
    expect(pinned.map((item) => item.taskId)).toEqual([task.taskId]);
    expect(active).toEqual([]);
  });
