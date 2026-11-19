import {
  createProjectId,
  createSessionId,
  createToolCallId,
  SessionEventType,
  type ExecutionPort,
  type PermissionBrokerPort,
  type SessionEvent,
  type SessionStorePort,
} from "@zcode/contracts";
import { describe, expect, it, vi } from "vitest";
import { PermissionService } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { bashToolEntry } from "../src/tool/handlers/bash.js";
import { createToolRegistry } from "../src/tool/registry.js";

function setup() {
  const registry = createToolRegistry();
  registry.register(bashToolEntry);
  const sessionId = createSessionId("bash-empty-approval");
  const projectID = createProjectId("bash-empty-project");
  const events: SessionEvent[] = [];
  const requestPermission = vi.fn<PermissionBrokerPort["requestPermission"]>(async () => ({
    decision: "deny",
  }));
  const run = vi.fn<ExecutionPort["run"]>(async () => {
    throw new Error("Test input must not reach the execution port");
  });
  const store = {
    getProjectPermission: vi.fn(async () => null),
    getSession: vi.fn(async () => ({ id: sessionId, projectID })),
    saveProjectPermission: vi.fn(),
    updateSession: vi.fn(),
  };
  const permissionService = new PermissionService();
  const grantSessionPermission = vi.spyOn(permissionService, "grantSessionPermission");
  const executor = createToolExecutor({
    registry,
    permissionService,
    permissionBroker: { requestPermission },
    executionPort: { run } as ExecutionPort,
    sessionStore: store as unknown as SessionStorePort,
    mode: "build",
    workingDirectory: process.cwd(),
    workspaceRoot: process.cwd(),
    sessionId,
    emitEvent: async (event) => { events.push(event); },
  });
  return { events, executor, grantSessionPermission, requestPermission, run, store };
}

function execute(executor: ReturnType<typeof createToolExecutor>, command: string) {
  return executor.execute({
    id: createToolCallId("bash-approval"),
    name: "Bash",
    input: { command },
  });
}

describe("Bash empty command approval", () => {
  it.each(["", " \t "])("returns an empty result without asking or writing rules for %j", async (command) => {
    const { events, executor, grantSessionPermission, requestPermission, run, store } = setup();
    const result = await execute(executor, command);

    // OW-P036：空命令不会到达投影「始终允许」选项或写回授权规则的路径。
    expect(requestPermission).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === SessionEventType.PermissionRequested)).toBe(false);
    expect(store.saveProjectPermission).not.toHaveBeenCalled();
    expect(store.updateSession).not.toHaveBeenCalled();
    expect(grantSessionPermission).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ stdout: "", stderr: "", status: "completed" });
  });

  it("still asks for a non-empty command and does not run it when denied", async () => {
    const { executor, requestPermission, run } = setup();
    expect((await execute(executor, "touch probe-output.txt")).success).toBe(false);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves the permission service's build-mode verdict unchanged", () => {
    expect(new PermissionService().checkPermission({
      input: { command: "" },
      mode: "build",
      riskLevel: bashToolEntry.metadata.riskLevel,
      toolName: "Bash",
    }, {
      ...bashToolEntry.metadata,
      permission: bashToolEntry.permission,
    })).toMatchObject({ decision: "ask", ruleId: "mode.build.highRisk" });
  });
});
