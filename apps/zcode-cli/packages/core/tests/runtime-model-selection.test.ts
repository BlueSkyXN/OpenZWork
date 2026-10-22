import { describe, expect, it, vi } from "vitest";
import { createTestModelSelection } from "./test-model-selection.js";
import {
  CoreErrorType,
  ModelErrorCode,
  ModelProtocolError,
  ModelRetryBudget,
  SessionEventType,
  createModelId,
  createModelProviderId,
  createSessionId,
  type Logger,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "./subagent-test-store.js";

describe("AgentRuntime model selection event", () => {
  it("首轮只按 admitted Active Model 构造一次 Context", async () => {
    const runtime = createTestAgentRuntime(
      createSessionId("runtime-first-turn-single-context-build"),
      {
        modelSelection: createTestModelSelection("provider-a/model-a"),
        titleGeneration: { enabled: false },
        workingDirectory: "/workspace/project",
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async generateText(_request, observation) {
            return {
              finishReason: "stop",
              model: observation.model,
              text: "done",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        }),
      },
    );
    const internalRuntime = runtime as typeof runtime & {
      createContextBuilderFromSnapshot: (...args: unknown[]) => unknown;
    };
    const createContextBuilderFromSnapshot =
      internalRuntime.createContextBuilderFromSnapshot.bind(internalRuntime);
    let contextBuildCount = 0;
    internalRuntime.createContextBuilderFromSnapshot = (...args: unknown[]) => {
      contextBuildCount++;
      return createContextBuilderFromSnapshot(...args);
    };

    await runtime.executeTurn("first turn");
    expect(contextBuildCount).toBe(1);

    await runtime.executeTurn("second turn");
    expect(contextBuildCount).toBe(2);
  });

  it("uses the admitted Active Model for both Context and the provider request", async () => {
    const requests: Array<{ modelId: string; providerId: string; text: string }> = [];
    const runtime = createTestAgentRuntime(
      createSessionId("runtime-active-model-context"),
      {
        modelSelection: createTestModelSelection("provider-a/model-a"),
        titleGeneration: { enabled: false },
        workingDirectory: "/workspace/project",
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            requests.push({
              modelId: String(observation.model.modelId),
              providerId: String(observation.model.providerId),
              text: JSON.stringify(request.messages),
            });
            return {
              finishReason: "stop",
              model: observation.model,
              text: "done",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        }),
      },
    );

    await runtime.executeTurn("switch now", undefined, {
      intent: {
        kind: "sendText",
        modelSelection: {
          providerId: "provider-b",
          modelId: "model-b",
          options: { reasoningLevel: "high" },
        },
        requestedDelivery: "start-now",
        sourceCommandId: "switch-command",
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ providerId: "provider-b", modelId: "model-b" });
    expect(requests[0]?.text).toContain("provider-b/model-b");
    expect(requests[0]?.text).not.toContain("provider-a/model-a");
  });

  it("uses an execution-scoped Active Model in Context without changing Session Selection", async () => {
    const requests: Array<{ modelId: string; providerId: string; text: string }> = [];
    const sessionSelection = createTestModelSelection("provider-a/model-a");
    const runtime = createTestAgentRuntime(
      createSessionId("runtime-execution-model-context"),
      {
        modelSelection: sessionSelection,
        titleGeneration: { enabled: false },
        workingDirectory: "/workspace/project",
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            requests.push({
              modelId: String(observation.model.modelId),
              providerId: String(observation.model.providerId),
              text: JSON.stringify(request.messages),
            });
            return {
              finishReason: "stop",
              model: observation.model,
              text: "done",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        }),
      },
    );

    await runtime.executeTurn("idle task", undefined, {
      intent: {
        kind: "sendText",
        modelSelection: {
          providerId: "personal:execution",
          modelId: "GLM-5.2",
          options: { reasoningLevel: "high" },
        },
        requestedDelivery: "start-now",
        sourceCommandId: "idle-command",
      },
      modelExecution: { selectionScope: "execution" },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      providerId: "personal:execution",
      modelId: "GLM-5.2",
    });
    expect(requests[0]?.text).toContain("personal:execution/GLM-5.2");
    expect(requests[0]?.text).not.toContain("provider-a/model-a");
    expect(runtime.getSessionModelSelection()).toEqual(sessionSelection);
  });

  it("applies a Session Selection change during an active turn only to the next Active Model", async () => {
    const requests: Array<{ modelId: string; providerId: string; text: string }> = [];
    let runtime: ReturnType<typeof createTestAgentRuntime>;
    runtime = createTestAgentRuntime(
      createSessionId("runtime-active-turn-selection-change"),
      {
        modelSelection: createTestModelSelection("provider-a/model-a"),
        titleGeneration: { enabled: false },
        workingDirectory: "/workspace/project",
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            requests.push({
              modelId: String(observation.model.modelId),
              providerId: String(observation.model.providerId),
              text: JSON.stringify(request.messages),
            });
            if (requests.length === 1) {
              runtime.setSessionModelSelection({
                providerId: "provider-b",
                modelId: "model-b",
                options: { reasoningLevel: "high" },
              });
            }
            return {
              finishReason: "stop",
              model: observation.model,
              text: "done",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        }),
      },
    );

    await runtime.executeTurn("first");
    await runtime.executeTurn("second");

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ providerId: "provider-a", modelId: "model-a" });
    expect(requests[0]?.text).toContain("provider-a/model-a");
    expect(requests[0]?.text).not.toContain("provider-b/model-b");
    expect(requests[1]).toMatchObject({ providerId: "provider-b", modelId: "model-b" });
    expect(requests[1]?.text).toContain("provider-b/model-b");
    expect(requests[1]?.text).not.toContain("provider-a/model-a");
  });

  it("uses structured ModelSelection as the current Session model fact", () => {
    const runtime = createTestAgentRuntime(
      createSessionId("runtime-structured-session-model-selection"),
      {
        modelSelection: {
          providerId: "provider-a",
          modelId: "model-a",
          options: {
            reasoningLevel: "high",
          },
        },
      },
      { eventStore: createTestSessionEventStore() },
    );

    expect(runtime.getSessionModelSelection()).toEqual({
      providerId: "provider-a",
      modelId: "model-a",
      options: {
        reasoningLevel: "high",
      },
    });

    const nextSelection = {
      providerId: "provider-b",
      modelId: "model-b",
      options: {
        reasoningLevel: "low",
      },
    };
    runtime.setSessionModelSelection(nextSelection);
    nextSelection.options.reasoningLevel = "mutated-outside-runtime";

    expect(runtime.getSessionModelSelection()).toEqual({
      providerId: "provider-b",
      modelId: "model-b",
      options: {
        reasoningLevel: "low",
      },
    });
  });

  it("publishes the Active Model context window with ModelSelected", async () => {
    const sessionId = createSessionId("runtime-model-selection-context-window");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        modelFactory: createTestModelFactory({ properties: { contextWindow: 1_000_000 } }),
      },
    );

    await runtime.emitModelSelected({
      modelSelection: {
        providerId: createModelProviderId("deepseek"),
        modelId: createModelId("deepseek-v4-flash"),
      },
      supportedThoughtLevels: ["max", "high", "nothink"],
      traceContext: { traceId: "trace-runtime-model-selection" } as never,
    });

    const selected = (await eventStore.getEvents(sessionId)).find(
      (event) => event.type === SessionEventType.ModelSelected,
    );
    expect(selected?.payload).toMatchObject({
      contextWindow: 1_000_000,
      modelSelection: {
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
      },
      supportedThoughtLevels: ["max", "high", "nothink"],
    });
  });

  it("preserves the registry fallback origin in ModelSelected", async () => {
    const sessionId = createSessionId("runtime-model-selection-registry-fallback");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, {}, { eventStore });

    await runtime.emitModelSelected({
      modelSelection: {
        providerId: createModelProviderId("provider-b"),
        modelId: createModelId("model-b"),
      },
      previousModelSelection: {
        providerId: createModelProviderId("provider-a"),
        modelId: createModelId("model-a"),
      },
      origin: "registryFallback",
      traceContext: { traceId: "trace-runtime-model-selection-fallback" } as never,
    });

    const selected = (await eventStore.getEvents(sessionId)).find(
      (event) => event.type === SessionEventType.ModelSelected,
    );
    expect(selected?.payload).toMatchObject({
      origin: "registryFallback",
      previousModelSelection: {
        providerId: "provider-a",
        modelId: "model-a",
      },
    });
  });

  it("uses the execution-scoped Selection for foreground children without applying profile reasoning", async () => {
    const sessionId = createSessionId("runtime-turn-model-foreground-subagents");
    const eventStore = createTestSessionEventStore();
    const sessionModel = createTestModelSelection("user-provider/user-model");
    const childExecutions: Array<Record<string, unknown>> = [];
    const mainRequests: Array<Record<string, unknown>> = [];
    const runtime = createTestAgentRuntime(
      sessionId,
      {
        modelSelection: createTestModelSelection(sessionModel),
        subagents: {
          profiles: [
            {
              description: "Search source code",
              modelSelection: {
                providerId: "custom-provider",
                modelId: "custom-code-model",
                options: { reasoningLevel: "high" },
              },
              name: "Code Search",
              source: "user",
              systemPrompt: "Search code.",
              tools: ["Read"],
            },
          ],
        },
        titleGeneration: { enabled: false },
        workingDirectory: "/workspace/project",
      },
      {
        eventStore,
        modelFactory: createTestModelFactory({
          maxOutputTokens: (input) =>
            input.selection.providerId === "personal:execution" ? 16_000 : 32_000,
          async generateText(request, observation) {
            const metadata = observation.invocationContext?.metadata as
              | { querySource?: string; turnNumber?: number }
              | undefined;
            const capturedRequest = {
              maxOutputTokens: request.options?.maxOutputTokens,
              model: observation.model,
            };
            if (metadata?.querySource === "subagent") {
              childExecutions.push(capturedRequest);
              return {
                finishReason: "stop",
                model: observation.model,
                text: "child done",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            }

            mainRequests.push(capturedRequest);
            if (metadata?.turnNumber === 0 && mainRequests.length === 1) {
              return {
                finishReason: "tool-calls",
                model: observation.model,
                text: "",
                toolCalls: [
                  {
                    id: "call_explore",
                    name: "Agent",
                    input: {
                      description: "Explore source",
                      prompt: "Explore the source.",
                      subagent_type: "Explore",
                    },
                  },
                  {
                    id: "call_code_search",
                    name: "Agent",
                    input: {
                      description: "Search source",
                      prompt: "Search the source.",
                      subagent_type: "Code Search",
                    },
                  },
                ],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            }
            if (metadata?.turnNumber === 1 && mainRequests.length === 3) {
              return {
                finishReason: "tool-calls",
                model: observation.model,
                text: "",
                toolCalls: [
                  {
                    id: "call_code_search_ordinary",
                    name: "Agent",
                    input: {
                      description: "Search source with profile settings",
                      prompt: "Search the source with the configured profile.",
                      subagent_type: "Code Search",
                    },
                  },
                ],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            }

            return {
              finishReason: "stop",
              model: observation.model,
              text: "turn done",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        } as never),
      },
    );

    await runtime.executeTurn("run foreground children", undefined, {
      intent: {
        sourceCommandId: "idle-command",
        kind: "sendText",
        requestedDelivery: "start-now",
        modelSelection: {
          providerId: "personal:execution",
          modelId: "GLM-5.2",
          options: { reasoningLevel: "high" },
        },
      },
      modelExecution: {
        selectionScope: "execution",
        subagents: { foregroundModel: "submission", background: "deny" },
      },
    });
    await runtime.executeTurn("ordinary prompt");

    expect(childExecutions).toHaveLength(3);
    expect(childExecutions.slice(0, 2).map((execution) => execution.model)).toEqual([
      expect.objectContaining({
        providerId: "personal:execution",
        modelId: "GLM-5.2",
      }),
      expect.objectContaining({
        providerId: "personal:execution",
        modelId: "GLM-5.2",
      }),
    ]);
    expect(
      childExecutions
        .slice(0, 2)
        .map(
          (execution) =>
            (execution.model as { options?: { reasoningLevel?: string } }).options?.reasoningLevel,
        ),
    ).toEqual(["high", "high"]);
    expect(childExecutions.slice(0, 2).map((execution) => execution.maxOutputTokens)).toEqual([
      16_000, 16_000,
    ]);
    expect(childExecutions[2]?.model).toEqual(
      expect.objectContaining({
        providerId: "custom-provider",
        modelId: "custom-code-model",
      }),
    );
    expect(childExecutions[2]?.model).toEqual(
      expect.objectContaining({ options: expect.objectContaining({ reasoningLevel: "high" }) }),
    );
    expect(mainRequests).toHaveLength(4);
    expect(mainRequests.at(-1)?.model).toEqual(
      expect.objectContaining({
        providerId: "user-provider",
        modelId: "user-model",
      }),
    );
    expect(runtime.getSessionModelSelection()).toEqual({
      providerId: String(sessionModel.providerId),
      modelId: String(sessionModel.modelId),
    });
  });

  it.each(["failure", "cancel"] as const)(
    "does not retain an execution-scoped Selection after %s",
    async (outcome) => {
      const sessionId = createSessionId(`runtime-turn-model-cleanup-${outcome}`);
      const abortController = new AbortController();
      const requests: Array<Record<string, unknown>> = [];
      let failFirstRequest = true;
      const runtime = createTestAgentRuntime(
        sessionId,
        {
          modelSelection: createTestModelSelection(
            createTestModelSelection("user-provider/user-model"),
          ),
          titleGeneration: { enabled: false },
          workingDirectory: "/workspace/project",
        },
        {
          eventStore: createTestSessionEventStore(),
          modelFactory: createTestModelFactory({
            async generateText(request, observation) {
              requests.push({
                model: observation.model,
                request,
              });
              if (failFirstRequest) {
                failFirstRequest = false;
                if (outcome === "cancel") {
                  abortController.abort(new Error("user cancelled idle turn"));
                }
                throw new Error(`${outcome} idle turn`);
              }
              return {
                finishReason: "stop",
                model: observation.model,
                text: "ordinary turn done",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            },
          } as never),
        },
      );

      await expect(
        runtime.executeTurn("idle turn", undefined, {
          abortSignal: abortController.signal,
          intent: {
            sourceCommandId: `idle-${outcome}`,
            kind: "sendText",
            requestedDelivery: "start-now",
            modelSelection: {
              providerId: "personal:execution",
              modelId: "GLM-5.2",
            },
          },
          modelExecution: {
            selectionScope: "execution",
          },
        }),
      ).rejects.toMatchObject({
        type: outcome === "cancel" ? CoreErrorType.TurnCancelled : CoreErrorType.UnknownError,
      });

      await runtime.executeTurn("ordinary prompt");

      expect(requests).toHaveLength(2);
      expect(requests[0]?.model).toEqual(
        expect.objectContaining({
          providerId: "personal:execution",
          modelId: "GLM-5.2",
        }),
      );
      expect(requests[1]?.model).toEqual(
        expect.objectContaining({ providerId: "user-provider", modelId: "user-model" }),
      );
    },
  );

  it("preserves an explicit source-less model boundary in ModelSelected", async () => {
    const sessionId = createSessionId("runtime-model-selection-source-less-boundary");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, {}, { eventStore });

    await runtime.emitModelSelected({
      modelSelection: {
        providerId: createModelProviderId("child-provider"),
        modelId: createModelId("child-model"),
      },
      previousModelSelection: null,
      traceContext: { traceId: "trace-runtime-model-selection-source-less" } as never,
    });

    const selected = (await eventStore.getEvents(sessionId)).find(
      (event) => event.type === SessionEventType.ModelSelected,
    );
    expect(selected?.payload).toMatchObject({
      previousModelSelection: null,
      modelSelection: {
        providerId: "child-provider",
        modelId: "child-model",
      },
    });
  });
});
