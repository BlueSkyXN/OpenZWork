import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import type { McpPort, McpServerConfig } from "@zcode/contracts";
import { createRegistryBackedTestApp as createZCodeApp } from "./helpers/registry-backed-test-app.js";

describe("project MCP config", () => {
  // 标准项目、插件和用户 MCP 配置优先级与自动连接回归。
  it("lists project MCP servers as trusted and auto-connects on startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-bootstrap-mcp-"));
    const cwd = join(root, "workspace");
    const connectedServerSets: string[][] = [];
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });

    try {
      await mkdir(join(root, ".git"));
      await mkdir(cwd, { recursive: true });
      await writeFile(
        join(root, "zcode.json"),
        JSON.stringify({
          mcp: {
            servers: {
              project: {
                type: "stdio",
                command: "node",
                args: ["mcp-server.js"],
              },
            },
          },
        }),
      );

      const app = await createZCodeApp({
        env: {},
        mcpPort: createRecordingMcpPort(connectedServerSets),
        modelExecutor: createStopModelExecutor(),
        runtimeConfig: {
          workingDirectory: cwd,
        },
        sessionStore,
        skipUserConfig: true,
      });

      // OpenZWork v3.17.1 吸收上游 workspace-mcp-trust 门：项目 MCP 不再自动连接，
      // 首次出现为 untrusted，须经用户批准（decide）后才进入连接集；插件/内建/用户源不受门限。
      const statuses = await app.listMcpServers();
      expect(statuses.project?.status).toBe("untrusted");
      expect(statuses.project?.error).toBeUndefined();

      await app.submitPrompt("hello");
      expect(connectedServerSets).toEqual([["node_repl"]]);

      await app.close();
    } finally {
      sessionStore.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("auto-connects plugin MCP servers as trusted startup config", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-bootstrap-plugin-mcp-"));
    const cwd = join(root, "workspace");
    const pluginRoot = join(root, "ios-plugin");
    const connectedServerSets: string[][] = [];
    const connectedConfigs: Record<string, McpServerConfig>[] = [];
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });

    try {
      await mkdir(join(root, ".git"));
      await mkdir(cwd, { recursive: true });
      await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
      await writeFile(
        join(pluginRoot, ".zcode-plugin", "plugin.json"),
        JSON.stringify({
          name: "ios-dev",
          mcpServers: {
            "ios-simulator": {
              command: "node",
              args: ["${ZCODE_PLUGIN_ROOT}/server.js"],
            },
          },
        }),
      );
      await writeFile(
        join(root, "config.json"),
        JSON.stringify({
          plugins: {
            dirs: [pluginRoot],
          },
        }),
      );

      const app = await createZCodeApp({
        env: {},
        mcpPort: createRecordingMcpPort(connectedServerSets, connectedConfigs),
        modelExecutor: createStopModelExecutor(),
        runtimeConfig: {
          workingDirectory: cwd,
        },
        sessionStore,
        userConfigPath: join(root, "config.json"),
      });

      await app.submitPrompt("hello");
      expect(connectedServerSets).toEqual([
        ["plugin:ios-dev:ios-simulator", "node_repl"],
      ]);
      expect(connectedConfigs[0]?.["plugin:ios-dev:ios-simulator"]).toMatchObject({
        command: "node",
        type: "stdio",
      });
      // 模板只替换根目录，Windows 上保留的正斜杠仍指向同一文件；比较规范化后的路径。
      expect(
        connectedConfigs[0]?.["plugin:ios-dev:ios-simulator"]?.args?.map(normalize),
      ).toEqual([join(pluginRoot, "server.js")]);

      await app.close();
    } finally {
      sessionStore.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats user-overridden project MCP servers as trusted user config", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-bootstrap-mcp-user-priority-"));
    const cwd = join(root, "workspace");
    const userConfigPath = join(root, "home", "config.json");
    const connectedServerSets: string[][] = [];
    const connectedConfigs: Record<string, McpServerConfig>[] = [];
    const sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });

    try {
      await mkdir(join(root, ".git"));
      await mkdir(cwd, { recursive: true });
      await mkdir(join(root, "home"), { recursive: true });
      await writeFile(
        join(root, "zcode.json"),
        JSON.stringify({
          mcp: {
            servers: {
              "project-only": {
                type: "stdio",
                command: "project-only-server",
              },
              shared: {
                type: "stdio",
                command: "project-server",
              },
            },
          },
        }),
      );
      await writeFile(
        userConfigPath,
        JSON.stringify({
          mcp: {
            servers: {
              shared: {
                type: "stdio",
                command: "user-server",
              },
            },
          },
        }),
      );

      const app = await createZCodeApp({
        env: {},
        mcpPort: createRecordingMcpPort(connectedServerSets, connectedConfigs),
        modelExecutor: createStopModelExecutor(),
        runtimeConfig: {
          workingDirectory: cwd,
        },
        sessionStore,
        userConfigPath,
      });

      // OpenZWork v3.17.1：user 源不受 workspace-mcp-trust 门限（withReviews 跳过 user），
      // project 源未批准保持 untrusted 且不进连接集——优先级语义在门下依然成立。
      const statuses = await app.listMcpServers();
      expect(statuses["project-only"]?.status).toBe("untrusted");
      expect(statuses.shared?.status).toBe("disconnected");

      await app.submitPrompt("hello");
      expect(connectedServerSets).toEqual([["shared", "node_repl"]]);
      // OpenZWork v3.17.1：project-only 未过信任门不连接；user 源的 shared 照常连接。
      expect(connectedConfigs[0]?.["project-only"]).toBeUndefined();
      expect(connectedConfigs[0]?.shared).toMatchObject({
        command: "user-server",
        type: "stdio",
      });

      await app.close();
    } finally {
      sessionStore.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});

function createRecordingMcpPort(
  connectedServerSets: string[][],
  connectedConfigs: Record<string, McpServerConfig>[] = [],
): McpPort {
  return {
    async callTool() {
      return { content: [] };
    },
    async close() {},
    async connectConfiguredServers(servers) {
      connectedServerSets.push(Object.keys(servers));
      connectedConfigs.push(servers);
      return {
        statuses: {},
        tools: [],
      };
    },
    async connectServer(name, config) {
      return {
        status: "connected",
        transport: config.type,
        toolCount: 0,
        updatedAt: new Date().toISOString(),
      };
    },
    async disconnectServer() {
      return undefined;
    },
    async listTools() {
      return [];
    },
    async status() {
      return {};
    },
  };
}

function createStopModelExecutor() {
  return {
    // 根因：createZCodeApp 初始化时会同步配置模型 I/O 保留策略；旧测试夹具缺少该方法会在用例逻辑前崩溃。
    setModelIoFullRetentionEnabled() {},
    async generateText() {
      return {
        finishReason: "stop",
        text: "ok",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      };
    },
    async *streamText() {
      yield {
        finishReason: "stop",
        type: "finish",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      };
    },
  } as never;
}
