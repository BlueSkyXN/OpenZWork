import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildServerRemoteWorkspaceIdentity } from "@zcode/shared";
import { localProjectId, dataDirectory } from "@zcode/shared/data-directory";
import {
  SqliteSessionStore,
  NodeToolArtifactStore,
  cliStorageRelocation,
} from "@zcode/adapters/storage";
import { resolveProjectMemoryRoot } from "../../../apps/zcode-cli/packages/core/src/memory/project-root.js";
import { resolvePersistentAgentMemoryRoot } from "../../../apps/zcode-cli/packages/core/src/subagent/persistent-memory.js";
import { projectTask } from "../../../apps/zcode-cli/packages/core/src/tool/handlers/task-output-projection.js";
import { copyDataDirectory } from "../src/paths.js";
import { startupStorage } from "../src/startup-storage/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function put(path: string, body: string) {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}
function artifactStore(root: string) {
  return new NodeToolArtifactStore({
    rootDir: join(root, "cli/artifacts"),
    imageCacheRootDir: join(root, "cli/image-cache"),
    videoCacheRootDir: join(root, "cli/video-cache"),
  });
}

it("recovers sessions, tool output, attachments and both memory scopes after A→B→C with old roots unavailable", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "true-data-relocation-")));
  roots.push(base);
  const a = join(base, "a");
  const b = join(base, "b");
  const c = join(base, "c");
  for (const directory of [a, b, c]) await mkdir(directory);
  const source = join(a, ".openzwork");
  const workspace = join(source, "workspace/default");
  await mkdir(workspace, { recursive: true });
  const dbPath = join(source, "cli/db/db.sqlite");
  const store = await SqliteSessionStore.openStartup({ dbPath });
  store.close();
  const trace = { traceId: "migration-trace", spanId: "migration-span" } as Parameters<
    NodeToolArtifactStore["writeToolResultArtifact"]
  >[0]["trace"];
  const artifact = await artifactStore(source).writeToolResultArtifact({
    sessionId: "session-local",
    toolCallId: "call-1",
    content: "full historical output",
    contentType: "text/plain",
    trace,
  } as Parameters<NodeToolArtifactStore["writeToolResultArtifact"]>[0]);
  const bashPath = join(source, "cli/exec/session-local/bash.log");
  await put(bashPath, "bash historical output");
  const attachmentPath = join(source, "clipboard/image.png");
  await put(attachmentPath, "synthetic image bytes");
  const memory = resolveProjectMemoryRoot({
    cliStorageRoot: join(source, "cli"),
    workspacePath: workspace,
  });
  await put(join(memory, "MEMORY.md"), "remember default workspace");
  const agentMemory = resolvePersistentAgentMemoryRoot({
    storageRoot: source,
    workspaceRoot: workspace,
    agentName: "tester",
    scope: "user",
  });
  await put(join(agentMemory, "MEMORY.md"), "remember user agent");
  const userText = `Keep this literal path: ${bashPath}`;
  const checkpointArtifact = await artifactStore(source).writeToolResultArtifact({
    sessionId: "session-local",
    toolCallId: "file-change",
    toolName: "Write",
    contentType: "application/json",
    content: JSON.stringify({
      version: 1,
      kind: "workspace_file_before_change",
      createdAt: "2026-01-01T00:00:00Z",
      toolCallId: "file-change",
      toolName: "Write",
      files: [
        {
          path: join(workspace, "note.txt"),
          existedBefore: true,
          beforeContent: userText,
          structuredPatch: [],
        },
      ],
    }),
  } as Parameters<NodeToolArtifactStore["writeToolResultArtifact"]>[0]);
  const hint = `<persisted-output>\nOutput too large (1 KB). Full output saved to: ${artifact.path}\n\nPreview: ${artifact.path}\n</persisted-output>`;
  const toolData = {
    type: "tool",
    callID: "call-1",
    tool: "Bash",
    state: {
      status: "completed",
      input: { command: userText },
      output: hint,
      metadata: {
        schemaVersion: 1,
        outputFile: bashPath,
        serialization: {
          artifactPath: artifact.path,
          truncated: true,
          originalBytes: 1000,
          returnedBytes: 100,
          budgetStrategy: "artifact",
        },
        modelContent: hint,
      },
      title: "Bash",
      time: { start: 1, end: 2 },
    },
  };
  const db = new DatabaseSync(dbPath);
  const remoteId = buildServerRemoteWorkspaceIdentity({
    serverId: "synthetic-remote",
    workspacePath: workspace,
  });
  try {
    const insert = db.prepare(
      "INSERT INTO session(id,project_id,workspace_id,slug,directory,title,version,time_created,time_updated) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "session-local",
      localProjectId(workspace),
      null,
      "local",
      workspace,
      "local history",
      "3.16.2",
      1,
      2,
    );
    insert.run(
      "session-remote",
      "remote-project",
      remoteId,
      "remote",
      workspace,
      "remote history",
      "3.16.2",
      1,
      2,
    );
    db.prepare(
      "INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?)",
    ).run(
      "message-1",
      "session-local",
      1,
      2,
      JSON.stringify({ role: "assistant", path: { cwd: workspace, root: workspace } }),
    );
    for (const [id, data] of [
      ["tool-part", toolData],
      ["text-part", { type: "text", text: userText }],
      [
        "file-part",
        {
          type: "file",
          mime: "image/png",
          url: pathToFileURL(attachmentPath).href,
          source: { type: "file", path: attachmentPath },
        },
      ],
    ] as const) {
      db.prepare(
        "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES(?,?,?,?,?,?)",
      ).run(id, "message-1", "session-local", 1, 2, JSON.stringify(data));
    }
    db.prepare(
      "INSERT INTO input_history(id,project_id,session_id,text,kind,time_created,attachments) VALUES(?,?,?,?,?,?,?)",
    ).run(
      "input-1",
      localProjectId(workspace),
      "session-local",
      userText,
      "prompt",
      1,
      JSON.stringify([{ type: "image", path: attachmentPath }]),
    );
    db.prepare(
      "INSERT INTO session_entry(id,session_id,type,time_created,time_updated,data) VALUES(?,?,?,?,?,?)",
    ).run(
      "checkpoint-1",
      "session-local",
      "runtime/workspace_checkpoint",
      1,
      2,
      JSON.stringify({ payload: { snapshotRef: checkpointArtifact.uri } }),
    );
  } finally {
    db.close();
  }
  // 第一跳使用 Desktop 的真实子进程端口，覆盖 command → CLI owner → 完成回执。
  await copyDataDirectory(a, b, "plan-a-b", {
    relocateAgent: (plan) =>
      startupStorage.relocateAgent({
        command: {
          command: process.execPath,
          args: [
            "--import",
            fileURLToPath(import.meta.resolve("tsx")),
            fileURLToPath(
              new URL("../../../apps/zcode-cli/packages/cli/src/main.ts", import.meta.url),
            ),
            "app-server",
            "--stdio",
          ],
          cwd: base,
        },
        env: {
          ...process.env,
          HOME: base,
          USERPROFILE: base,
          ZCODE_STORAGE_DIR: source,
          ZCODE_SESSION_DB_PATH: dbPath,
        },
        plan,
      }),
  });
  await expect(dataDirectory.acquireUse(source)).rejects.toMatchObject({
    code: "DATA_DIRECTORY_RELOCATED",
  });
  await rename(source, join(a, "unavailable"));
  await copyDataDirectory(b, c, "plan-b-c", { relocateAgent: cliStorageRelocation.relocate });
  await rename(join(b, ".openzwork"), join(b, "unavailable"));
  const target = join(c, ".openzwork");
  const targetWorkspace = join(target, "workspace/default");
  const reopened = await SqliteSessionStore.openStartup({
    dbPath: join(target, "cli/db/db.sqlite"),
  });
  try {
    const messages = await reopened.messages({
      sessionID: "session-local" as Parameters<SqliteSessionStore["messages"]>[0]["sessionID"],
    });
    const parts = messages[0]!.parts;
    const tool = parts.find((part) => part.id === "tool-part")!;
    expect(tool.type).toBe("tool");
    if (tool.type !== "tool" || tool.state.status !== "completed")
      throw new Error("missing completed tool");
    const metadata = tool.state.metadata as typeof toolData.state.metadata;
    expect(await readFile(metadata.serialization.artifactPath!, "utf8")).toBe(
      "full historical output",
    );
    expect(tool.state.output).toContain(
      `Full output saved to: ${metadata.serialization.artifactPath}`,
    );
    expect(tool.state.output).toContain(`Preview: ${artifact.path}`);
    expect(tool.state.input.command).toBe(userText);
    expect(parts.find((part) => part.type === "text")).toMatchObject({ text: userText });
    const file = parts.find((part) => part.type === "file")!;
    if (file.type !== "file") throw new Error("missing file");
    expect(await readFile(new URL(file.url), "utf8")).toBe("synthetic image bytes");
    const output = await projectTask(
      {
        type: "local_bash",
        taskId: "task-1",
        status: "completed",
        description: "historical output",
        outputFile: metadata.outputFile,
      } as Parameters<typeof projectTask>[0],
      { abortSignal: new AbortController().signal } as Parameters<typeof projectTask>[1],
    );
    expect(output.output).toBe("bash historical output");
    const loaded = await artifactStore(target).readToolResultArtifact({ uri: artifact.uri, trace });
    expect(loaded.content).toBe("full historical output");
    const checkpoint = await artifactStore(target).readToolResultArtifact({
      uri: checkpointArtifact.uri,
    });
    expect(JSON.parse(checkpoint.content).files[0]).toMatchObject({
      path: join(targetWorkspace, "note.txt"),
      beforeContent: userText,
    });
  } finally {
    reopened.close();
  }
  const actual = new DatabaseSync(join(target, "cli/db/db.sqlite"));
  try {
    expect(
      actual.prepare("SELECT directory,project_id FROM session WHERE id='session-local'").get(),
    ).toMatchObject({ directory: targetWorkspace, project_id: localProjectId(targetWorkspace) });
    expect(
      actual.prepare("SELECT directory,workspace_id FROM session WHERE id='session-remote'").get(),
    ).toMatchObject({ directory: workspace, workspace_id: remoteId });
    const input = actual.prepare("SELECT text,attachments FROM input_history").get()!;
    expect(input.text).toBe(userText);
    expect(await readFile(JSON.parse(String(input.attachments))[0].path, "utf8")).toBe(
      "synthetic image bytes",
    );
    actual
      .prepare("UPDATE session SET title=? WHERE id=?")
      .run("continued in new root", "session-local");
  } finally {
    actual.close();
  }
  const targetMemory = resolveProjectMemoryRoot({
    cliStorageRoot: join(target, "cli"),
    workspacePath: targetWorkspace,
  });
  expect(await readFile(join(targetMemory, "MEMORY.md"), "utf8")).toBe(
    "remember default workspace",
  );
  const targetAgentMemory = resolvePersistentAgentMemoryRoot({
    storageRoot: target,
    workspaceRoot: targetWorkspace,
    agentName: "tester",
    scope: "user",
  });
  expect(await readFile(join(targetAgentMemory, "MEMORY.md"), "utf8")).toBe("remember user agent");
});
