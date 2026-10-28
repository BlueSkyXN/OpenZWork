import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function codexFixtureRecords(params: {
  cwd: string;
  userText?: string;
  assistantText?: string;
}): unknown[] {
  const sessionId = "01a15884-78c9-70c0-ba4a-986344514985";
  return [
    {
      timestamp: "2026-10-20T08:54:00.711Z",
      ordinal: 0,
      type: "session_meta",
      payload: {
        session_id: sessionId,
        id: sessionId,
        timestamp: "2026-10-20T08:53:59.114Z",
        cwd: params.cwd,
        originator: "Codex Desktop",
        cli_version: "0.163.0",
      },
    },
    {
      timestamp: "2026-10-20T08:54:01.000Z",
      ordinal: 1,
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "<app-context>internal</app-context>" }],
      },
    },
    {
      timestamp: "2026-10-20T08:54:02.000Z",
      ordinal: 2,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${params.userText ?? "帮我修复构建"}`,
          },
        ],
      },
    },
    {
      timestamp: "2026-10-20T08:54:03.000Z",
      ordinal: 3,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: params.assistantText ?? "已定位并修复。",
          },
        ],
      },
    },
    {
      timestamp: "2026-10-20T08:54:04.000Z",
      ordinal: 4,
      type: "token_usage_record",
      payload: {
        info: { total_token_usage: { input_tokens: 100, output_tokens: 50 } },
      },
    },
  ];
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

async function loadRepo() {
  vi.resetModules();
  return await import("#src/session/external-import/externalSessionImportRepo.js");
}

describe("external session backup path", () => {
  it.each([
    ["codex", "/home/example/.codex/sessions/2026/10/28/rollout.jsonl", "2026/10/28/rollout.jsonl"],
    [
      "codex",
      String.raw`C:\Users\example\.codex\sessions\2026\10\28\rollout.jsonl`,
      String.raw`2026\10\28\rollout.jsonl`,
    ],
    [
      "codex",
      "C:/Users/example/.codex/sessions/2026/10/28/rollout.jsonl",
      String.raw`2026\10\28\rollout.jsonl`,
    ],
    [
      "qoder",
      String.raw`C:\Users\example\.qoder-cn\projects\project\session.jsonl`,
      String.raw`project\session.jsonl`,
    ],
    [
      "qoder",
      String.raw`\\host\share\.qoder\projects\project\session.jsonl`,
      String.raw`project\session.jsonl`,
    ],
    ["qoder", "/home/example/.qoder/projects/project/session.jsonl", "project/session.jsonl"],
    [
      "qoder",
      String.raw`/home/example/.qoder/projects/project/with\slash.jsonl`,
      String.raw`project/with\slash.jsonl`,
    ],
  ] as const)("%s backup path: %s", async (provider, sourcePath, expected) => {
    const { relativeSourcePathForProvider } = await loadRepo();
    // 扫描产生平台原生路径；仅查找正斜杠曾让 Windows 在复制备份前失败。
    expect(relativeSourcePathForProvider(provider, sourcePath)).toBe(expected);
  });
});

describe("ExternalSessionImportRepo (codex)", () => {
  it("扫描 ~/.codex/sessions rollout 文件并提取 session_meta.cwd 候选", async () => {
    const home = makeTempDir("zcode-external-codex-home-");
    const dataBaseDir = makeTempDir("zcode-external-codex-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    const repo = await loadRepo();

    const workspacePath = "/repo/codex-demo";
    const sessionDir = join(home, ".codex", "sessions", "2026", "10", "20");
    mkdirSync(sessionDir, { recursive: true });
    const rolloutPath = join(
      sessionDir,
      "rollout-2026-10-20T16-53-59-01a15884-78c9-70c0-ba4a-986344514985.jsonl",
    );
    writeJsonl(rolloutPath, codexFixtureRecords({ cwd: workspacePath }));

    // archived 分支与普通 jsonl 不应入选
    const archivedDir = join(home, ".codex", "sessions", "archived");
    mkdirSync(archivedDir, { recursive: true });
    writeJsonl(
      join(archivedDir, "rollout-2026-01-01T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
      codexFixtureRecords({ cwd: workspacePath }),
    );

    const candidates = await repo.externalSessionImportRepo.scanImportableSessions({
      provider: "codex",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: "codex",
      sessionId: "01a15884-78c9-70c0-ba4a-986344514985",
      workspacePath,
      sourcePath: rolloutPath,
    });
  });

  it("复制 rollout 到 agent-config/codex/{workspaceHash}/sessions 并保留相对层级", async () => {
    const home = makeTempDir("zcode-external-codex-copy-home-");
    const dataBaseDir = makeTempDir("zcode-external-codex-copy-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    const repo = await loadRepo();

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
    writeJsonl(sourcePath, codexFixtureRecords({ cwd: "/repo/copy-demo" }));

    const workspacePath = "/repo/copy-demo";
    const { outputPath } = await repo.externalSessionImportRepo.copySessionFileToWorkspace({
      provider: "codex",
      workspacePath,
      sourcePath,
    });
    expect(outputPath).toContain(join("agent-config", "codex"));
    expect(outputPath).toContain(join("sessions", "2026", "10", "20"));
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toEqual(readFileSync(sourcePath, "utf-8"));
  });
});

describe("ExternalSessionImportRepo (qoder)", () => {
  function qoderFixtureRecords(cwd: string): unknown[] {
    return [
      {
        type: "workspace-directories",
        sessionId: "49a2c84a-61a9-48e7-8479-32de5dafac28",
        directories: [cwd],
      },
      {
        type: "user",
        uuid: "c34ab452-6ddc-4128-91f4-578e4a99c652",
        timestamp: "2026-09-03T15:02:08.030Z",
        parentUuid: null,
        cwd,
        message: {
          role: "user",
          content: [{ type: "text", text: "帮我整理会话记录" }],
        },
      },
      {
        type: "assistant",
        uuid: "d8da42c3-506b-4088-bff1-b9445f41fbce",
        timestamp: "2026-09-03T15:02:17.249Z",
        parentUuid: "c34ab452-6ddc-4128-91f4-578e4a99c652",
        message: {
          id: "msg_d8da42c3506b4088bff1b9445f41fbce",
          type: "message",
          role: "assistant",
          model: "qfmodel",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "已整理完成。" }],
        },
      },
    ];
  }

  it("双根扫描 ~/.qoder 与 ~/.qoder-cn/projects 且不重复", async () => {
    const home = makeTempDir("zcode-external-qoder-home-");
    const dataBaseDir = makeTempDir("zcode-external-qoder-db-");
    process.env.HOME = home;
    process.env.ZCODE_DATA_BASE_DIR = dataBaseDir;
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => home };
    });
    const repo = await loadRepo();

    const workspacePath = "/repo/qoder-demo";
    const intlDir = join(home, ".qoder", "projects", "-repo-qoder-demo");
    const cnDir = join(home, ".qoder-cn", "projects", "-repo-qoder-demo");
    mkdirSync(intlDir, { recursive: true });
    mkdirSync(cnDir, { recursive: true });
    writeJsonl(join(intlDir, "intl-session-0001.jsonl"), qoderFixtureRecords(workspacePath));
    writeJsonl(join(cnDir, "cn-session-0002.jsonl"), qoderFixtureRecords(workspacePath));

    const candidates = await repo.externalSessionImportRepo.scanImportableSessions({
      provider: "qoder",
    });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((item: { sessionId: string }) => item.sessionId))).toEqual(
      new Set(["intl-session-0001", "cn-session-0002"]),
    );
    for (const candidate of candidates) {
      expect(candidate.provider).toBe("qoder");
      expect(candidate.workspacePath).toBe(workspacePath);
    }
  });
});
