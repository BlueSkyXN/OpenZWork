import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJsonl(path: string, records: unknown[]): void {
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf-8");
}

afterEach(() => {
  process.env.HOME = originalHome;
  delete process.env.ZCODE_DATA_BASE_DIR;
  vi.doUnmock("node:os");
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function codexFixture(cwd: string): unknown[] {
  const sessionId = "01a15884-78c9-70c0-ba4a-986344514985";
  return [
    {
      timestamp: "2026-10-20T08:54:00.711Z",
      type: "session_meta",
      payload: {
        session_id: sessionId,
        cwd,
        timestamp: "2026-10-20T08:53:59.114Z",
      },
    },
    {
      timestamp: "2026-10-20T08:54:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "# AGENTS.md instructions for /repo\n<INSTRUCTIONS>\n内部指令\n</INSTRUCTIONS>\n真正的问题：构建失败",
          },
        ],
      },
    },
    {
      timestamp: "2026-10-20T08:54:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "已修复。" }],
      },
    },
  ];
}

describe("external session parsers", () => {
  it("过滤连续的客户端环境前缀，标题和轮次从真实用户问题开始", async () => {
    const directory = makeTempDir("zcode-external-context-");
    const sourcePath = join(directory, "rollout.jsonl");
    const { parseCodexRolloutSessionFile, parseCodexRolloutSessionHeadInfo } =
      await import("#src/session/external-import/codexRolloutParser.js");
    const records = [
      { type: "session_meta", payload: { cwd: directory } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "# AGENTS.md instructions for /example\n<INSTRUCTIONS>合成指令</INSTRUCTIONS>\n<environment_context><cwd>/example</cwd></environment_context>\n<app-context>合成环境</app-context>",
            },
          ],
        },
      },
      ...codexFixture(directory).slice(1),
    ];
    writeJsonl(sourcePath, records);
    const parsed = await parseCodexRolloutSessionFile({
      filePath: sourcePath,
      sessionId: "context",
    });

    // 环境注入曾成为第一条 user 消息和标题；头采样与完整导入必须使用同一过滤规则。
    expect(parseCodexRolloutSessionHeadInfo(records).previewTitle).toBe("真正的问题：构建失败");
    expect(parsed.title).toBe("真正的问题：构建失败");
    expect(
      parsed.messages.map(({ role, content, turnIndex }) => ({ role, content, turnIndex })),
    ).toEqual([
      { role: "user", content: "真正的问题：构建失败", turnIndex: 0 },
      { role: "assistant", content: "已修复。", turnIndex: 0 },
    ]);
  });

  it("保留用户正文的标签引用与 assistant 原文", async () => {
    const directory = makeTempDir("zcode-external-quoted-context-");
    const sourcePath = join(directory, "rollout.jsonl");
    const { parseCodexRolloutSessionFile } =
      await import("#src/session/external-import/codexRolloutParser.js");
    const userText =
      "请解释 <INSTRUCTIONS>示例</INSTRUCTIONS>，以及 <environment_context>示例</environment_context>";
    const assistantText =
      "<app-context>这是回答中的示例</app-context>\n```xml\n<INSTRUCTIONS>原文</INSTRUCTIONS>\n```";
    writeJsonl(sourcePath, [
      { type: "session_meta", payload: { cwd: directory } },
      ...[
        ["user", userText],
        ["assistant", assistantText],
      ].map(([role, text]) => ({
        type: "response_item",
        payload: { type: "message", role, content: [{ type: "text", text }] },
      })),
    ]);
    const parsed = await parseCodexRolloutSessionFile({
      filePath: sourcePath,
      sessionId: "quoted-context",
    });
    expect(parsed.messages.map(({ content }) => content)).toEqual([userText, assistantText]);
  });

  it("codex rollout 解析：developer 注入与 AGENTS.md 头被过滤，模型不迁移", async () => {
    const home = makeTempDir("zcode-external-parse-home-");
    const dataBaseDir = makeTempDir("zcode-external-parse-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    vi.resetModules();
    const { parseCodexRolloutSessionFile } =
      await import("#src/session/external-import/codexRolloutParser.js");

    const workspacePath = "/repo/codex-parse";
    const sourcePath = join(
      home,
      ".codex",
      "sessions",
      "2026",
      "10",
      "20",
      "rollout-2026-10-20T16-53-59-01a15884-78c9-70c0-ba4a-986344514985.jsonl",
    );
    mkdirSync(join(home, ".codex", "sessions", "2026", "10", "20"), {
      recursive: true,
    });
    writeJsonl(sourcePath, [
      ...codexFixture(workspacePath).slice(0, 1),
      {
        timestamp: "2026-10-20T08:54:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "<app-context>secret</app-context>" }],
        },
      },
      ...codexFixture(workspacePath).slice(1),
    ]);

    const parsed = await parseCodexRolloutSessionFile({
      filePath: sourcePath,
      sessionId: "01a15884-78c9-70c0-ba4a-986344514985",
    });

    expect(parsed.provider).toBe("codex");
    expect(parsed.migrationSource).toBe("codexCli");
    expect(parsed.workspacePath).toBe(workspacePath);
    expect(parsed.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(parsed.messages[0]?.content).toContain("真正的问题：构建失败");
    expect(parsed.messages[0]?.content).not.toContain("内部指令");
    expect(parsed.messages[0]?.content).not.toContain("AGENTS.md instructions");
    // 模型不迁移：来源模型名不落到导入结果（spec 不变量 2）。
    expect(parsed.model).toBeUndefined();
    expect(parsed.sourceContentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("qoder 解析：Claude 同构记录复用 claude-native 提取，模型被清洗", async () => {
    const home = makeTempDir("zcode-external-qoder-parse-home-");
    const dataBaseDir = makeTempDir("zcode-external-qoder-parse-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    vi.resetModules();
    const { parseQoderSessionFile } =
      await import("#src/session/external-import/qoderSessionParser.js");

    const workspacePath = "/repo/qoder-parse";
    const sourcePath = join(home, ".qoder-cn", "projects", "-repo-qoder-parse", "sess-77.jsonl");
    mkdirSync(join(home, ".qoder-cn", "projects", "-repo-qoder-parse"), {
      recursive: true,
    });
    writeJsonl(sourcePath, [
      {
        type: "workspace-directories",
        sessionId: "sess-77",
        directories: [workspacePath],
      },
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-09-03T15:02:08.030Z",
        cwd: workspacePath,
        message: {
          role: "user",
          content: [{ type: "text", text: "整理记忆" }],
        },
      },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-09-03T15:02:17.249Z",
        parentUuid: "u1",
        message: {
          role: "assistant",
          model: "qfmodel",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "已完成。" }],
        },
      },
    ]);

    const parsed = await parseQoderSessionFile({
      filePath: sourcePath,
      sessionId: "sess-77",
      workspacePath,
    });

    expect(parsed.provider).toBe("qoder");
    expect(parsed.migrationSource).toBe("qoder");
    expect(parsed.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(parsed.messages[1]?.model).toBeUndefined();
    expect(parsed.sourceContentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("importExternalSessions 幂等", () => {
  it("同来源哈希未变时重导 → skipped(already_imported_unchanged)；无指纹时正常导入", async () => {
    const home = makeTempDir("zcode-external-idem-home-");
    const dataBaseDir = makeTempDir("zcode-external-idem-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    vi.resetModules();
    const { importExternalSessions } =
      await import("#src/session/external-import/externalSessionImportService.js");

    const workspacePath = dataBaseDir; // workspace 必须真实存在，用临时 dataBaseDir 充当
    const sourcePath = join(
      home,
      ".codex",
      "sessions",
      "2026",
      "10",
      "20",
      "rollout-2026-10-20T16-53-59-01a15884-78c9-70c0-ba4a-986344514985.jsonl",
    );
    mkdirSync(join(home, ".codex", "sessions", "2026", "10", "20"), {
      recursive: true,
    });
    writeJsonl(sourcePath, codexFixture(workspacePath));
    const sourceContentSha256 = createHash("sha256")
      .update(
        codexFixture(workspacePath)
          .map((record) => JSON.stringify(record))
          .join("\n") + "\n",
      )
      .digest("hex");

    const createdTasks: ZCodeTaskMeta[] = [];
    const fakeMeta = (taskId: string): ZCodeTaskMeta =>
      ({
        taskId,
        traceId: "trace",
        title: "imported",
        workspacePath,
        createdAt: 1,
        updatedAt: 1,
        mode: "default",
      }) as ZCodeTaskMeta;

    const run = async (fingerprint: { sourceContentSha256?: string } | null) =>
      await importExternalSessions({
        taskIndexRepo: {} as never,
        importIndex: {
          findImportedFingerprint: async () =>
            fingerprint ? { taskId: "existing", ...fingerprint } : null,
        },
        provider: "codex",
        sessionIds: ["01a15884-78c9-70c0-ba4a-986344514985"],
        createImportedSession: async (source) => {
          expect(source.migrationSource).toBe("codexCli");
          expect(source.sourceContentSha256).toBe(sourceContentSha256);
          const meta = fakeMeta(`task-${createdTasks.length}`);
          createdTasks.push(meta);
          return meta;
        },
        onTaskImported: () => {},
      });

    // 首次（无指纹）→ 导入成功
    const first = await run(null);
    expect(first.imported).toHaveLength(1);
    expect(first.skipped).toHaveLength(0);

    // 来源未变化 + 已有相同哈希指纹 → 幂等跳过，不建新会话
    const second = await run({ sourceContentSha256 });
    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]?.reason).toBe("already_imported_unchanged");
    expect(createdTasks).toHaveLength(1);

    // 来源变化（指纹哈希不同）→ 重新导入，产生新会话
    const third = await run({ sourceContentSha256: "0".repeat(64) });
    expect(third.imported).toHaveLength(1);
    expect(createdTasks).toHaveLength(2);
  });
});
