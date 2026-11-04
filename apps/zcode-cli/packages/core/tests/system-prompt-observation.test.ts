import { describe, expect, it } from "vitest";
import {
  createSessionId,
  createTraceId,
  ModelTransportKind,
  modelMessageContentToText,
  type ModelRequest,
} from "@zcode/contracts";
import {
  createDefaultSystemPromptSettings,
  DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
  systemPromptDocumentText,
} from "@zcode/shared";
import {
  buildSystemPromptPreview,
  SystemPromptObservation,
} from "../src/context/prompt-settings/index.js";
import { createContextBuilder } from "../src/context/builder.js";
import { buildProviderRequestMessages } from "../src/runtime/helpers/provider-request-messages.js";
import { systemReminderAttachmentEntry } from "../src/agent/message-history.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createTestSessionEventStore } from "./test-event-store.js";

const envInfo = {
  cwd: "/example/project",
  platform: "linux",
  shell: "bash",
  osVersion: "test",
  nodeVersion: "24",
  isGitRepository: true,
  gitBranch: "example",
};

describe("prompt previews and actual request observation", () => {
  it("SPE02/04 builds complete example context with the runtime builder", () => {
    const settings = createDefaultSystemPromptSettings();
    const result = buildSystemPromptPreview({
      settings,
      baseline: settings,
      scenario: DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
    });
    expect(result.after).toEqual(result.before);
    const text = systemPromptDocumentText(result.after);
    for (const marker of [
      "/example/project",
      "Example commit",
      "example-review",
      "Example project instructions",
      "2030-01-01",
    ])
      expect(text).toContain(marker);
    settings.mode = "replace";
    settings.replacement = "PERSONA";
    settings.sections.request_user_context = { mode: "disabled", content: "" };
    const changed = buildSystemPromptPreview({
      settings,
      scenario: DEFAULT_SYSTEM_PROMPT_PREVIEW_SCENARIO,
    });
    expect(systemPromptDocumentText(changed.after)).toContain("PERSONA");
    expect(systemPromptDocumentText(changed.after)).not.toContain("Example project instructions");
  });

  it.each([false, true])(
    "SPE05 preserves projected fragments with MCS=%s without capturing ordinary chat",
    (mcs) => {
      const entries = [
        { message: { role: "system" as const, content: "SYSTEM_RULE" } },
        systemReminderAttachmentEntry("environment", "REAL_ENVIRONMENT"),
        systemReminderAttachmentEntry("context_prefix", "REAL_PROJECT_RULE"),
        { message: { role: "user" as const, content: "PRIVATE_CHAT_WITH_FAKE_CONTEXT" } },
      ];
      const projected = buildProviderRequestMessages({
        entries,
        useMidConversationSystem: mcs,
        foldRemindersIntoToolResults: true,
      });
      expect(projected.promptComplete).toBe(true);
      const actual = projected.messages.map((message) =>
        modelMessageContentToText(message.content),
      );
      for (const block of projected.promptBlocks ?? [])
        expect(actual.some((text) => text.includes(block.content))).toBe(true);
      const view = JSON.stringify(projected.promptBlocks);
      expect(view).toContain("REAL_ENVIRONMENT");
      expect(view).toContain("REAL_PROJECT_RULE");
      expect(view).not.toContain("PRIVATE_CHAT_WITH_FAKE_CONTEXT");
    },
  );

  it("SPE05 keeps only observed instructions when they are folded into a tool result", () => {
    const projected = buildProviderRequestMessages({
      foldRemindersIntoToolResults: true,
      entries: [
        { message: { role: "system", content: "SYSTEM_RULE" } },
        {
          message: {
            role: "tool",
            toolCallId: "example-tool",
            toolName: "Read",
            content: "PRIVATE_TOOL_RESULT",
          },
        },
        systemReminderAttachmentEntry("context_prefix", "REAL_PROJECT_RULE"),
      ],
    });
    expect(projected.promptComplete).toBe(true);
    const tool = projected.messages.find((message) => message.role === "tool")!;
    expect(modelMessageContentToText(tool.content)).toContain("REAL_PROJECT_RULE");
    const observed = JSON.stringify(projected.promptBlocks);
    expect(observed).toContain("REAL_PROJECT_RULE");
    expect(observed).not.toContain("PRIVATE_TOOL_RESULT");
  });

  it("SPE06/07 only compares a fixed complete snapshot and never fills missing context from defaults", () => {
    const settings = createDefaultSystemPromptSettings();
    const builder = createContextBuilder({
      workingDirectory: envInfo.cwd,
      envInfo,
      systemPromptSettings: settings,
    });
    const projection = buildProviderRequestMessages({
      entries: builder.build().systemMessages.map((message) => ({ message })),
    });
    const observation = new SystemPromptObservation();
    expect(observation.read({})).toEqual({ status: "unavailable", reason: "no_request" });
    observation.capture({
      sessionId: "s",
      requestId: "r1",
      capturedAt: "2030-01-01T00:00:00.000Z",
      model: "test/model",
      blocks: projection.promptBlocks!,
      complete: true,
      builder: builder.copyForPromptPreview(),
      settings,
    });
    const draft = {
      ...settings,
      sections: { role: { mode: "replace" as const, content: "DRAFT_ROLE" } },
    };
    const compared = observation.read({ snapshotId: "r1", settings: draft });
    expect(compared.status).toBe("available");
    if (compared.status !== "available") throw new Error("missing observation");
    expect(compared.comparison).toBeDefined();
    expect(systemPromptDocumentText(compared.actual)).not.toContain("DRAFT_ROLE");
    expect(systemPromptDocumentText(compared.comparison!)).toContain("DRAFT_ROLE");
    expect(observation.read({ snapshotId: "other" })).toEqual({
      status: "unavailable",
      reason: "expired",
    });
    observation.capture({
      sessionId: "s",
      requestId: "r2",
      capturedAt: "2030-01-01T00:00:00.000Z",
      model: "test/model",
      blocks: [],
      complete: false,
      builder: null,
    });
    expect(observation.read({})).toEqual({ status: "unavailable", reason: "incomplete" });
  });

  it("SPE05/16 observes a real runtime model invocation, retains one request, and does not send when read", async () => {
    const requests: ModelRequest[] = [];
    const runtime = createTestAgentRuntime(
      createSessionId(),
      {
        workingDirectory: envInfo.cwd,
        envInfo,
        mode: "yolo",
        modelStreaming: "off",
        compact: { enabled: false },
        titleGeneration: { enabled: false },
        systemPromptSettings: {
          ...createDefaultSystemPromptSettings(),
          sections: { role: { mode: "replace", content: "RUNTIME_ROLE" } },
        },
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            requests.push(request);
            await observation.invocationContext?.statusSink?.publish({
              type: "model_request_started",
              requestId: `request-${requests.length}`,
              attempt: 1,
              maxAttempts: 1,
              providerId: observation.model.providerId,
              modelId: observation.model.modelId,
              timestamp: new Date().toISOString(),
              transport: ModelTransportKind.Sse,
              traceId:
                observation.invocationContext?.traceContext?.traceId ??
                createTraceId("prompt-observation"),
            });
            return {
              finishReason: "stop",
              text: "DONE",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        }),
      },
    );
    expect(runtime.readSystemPromptObservation({}).status).toBe("unavailable");
    await runtime.executeTurn("PRIVATE_USER_MESSAGE");
    const actual = runtime.readSystemPromptObservation({});
    expect(actual.status).toBe("available");
    if (actual.status !== "available") throw new Error("request was not observed");
    expect(systemPromptDocumentText(actual.actual)).toContain("RUNTIME_ROLE");
    expect(systemPromptDocumentText(actual.actual)).not.toContain("PRIVATE_USER_MESSAGE");
    const sent = requests[0]!.messages.map((message) => modelMessageContentToText(message.content));
    for (const block of actual.actual.blocks)
      expect(sent.some((text) => text.includes(block.content))).toBe(true);
    const compared = runtime.readSystemPromptObservation({
      snapshotId: actual.snapshotId,
      settings: createDefaultSystemPromptSettings(),
    });
    expect(compared.status).toBe("available");
    if (compared.status !== "available") throw new Error("comparison snapshot missing");
    expect(compared.comparison).toBeDefined();
    expect(systemPromptDocumentText(compared.comparison!)).not.toContain("RUNTIME_ROLE");
    expect(systemPromptDocumentText(compared.actual)).toContain("RUNTIME_ROLE");
    expect(requests).toHaveLength(1);
    await runtime.executeTurn("SECOND_USER_MESSAGE");
    expect(runtime.readSystemPromptObservation({ snapshotId: actual.snapshotId })).toEqual({
      status: "unavailable",
      reason: "expired",
    });
  });
});
