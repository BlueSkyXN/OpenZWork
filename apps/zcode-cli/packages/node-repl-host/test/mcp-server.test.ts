import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY,
} from "@zcode/contracts";
import {
  createInProcessNodeReplExecutor,
  createNodeReplMcpRuntime,
  main,
  type NodeReplMcpRuntime,
} from "../src/server.js";
import { toMcpRunResult } from "../src/result.js";
import {
  NODE_REPL_DEFAULT_TIMEOUT_MS,
  NODE_REPL_SERVER_INSTRUCTIONS,
  JS_TOOL_DESCRIPTION,
} from "../src/tool-contract.js";

describe("node_repl MCP server", () => {
  const packageVersion = (
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  let client: Client;
  let runtime: NodeReplMcpRuntime;

  const requestMeta = (
    sessionId: string,
    runtimeScope: "main" | "subagent" = "main",
    turnId = "turn-1",
  ) => ({
    "com.zcode/request-context": {
      runtime_scope: runtimeScope,
      session_id: sessionId,
      turn_id: turnId,
    },
  });

  beforeEach(async () => {
    runtime = createNodeReplMcpRuntime({ executeJs: createInProcessNodeReplExecutor() });
    client = new Client({ name: "node-repl-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    runtime.dispose();
  });

  it("exports the main entrypoint required by the packaged plugin host", () => {
    expect(main).toBeTypeOf("function");
    expect(client.getServerVersion()).toEqual({
      name: "node_repl",
      version: packageVersion,
    });
  });

    it("requires user-facing titles in the model schema while preserving legacy runtime input", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["js"]);

    const js = tools.find((tool) => tool.name === "js");
    expect(js?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["code", "title"],
      type: "object",
    });
    expect(Object.keys(js?.inputSchema.properties ?? {}).sort()).toEqual([
      "code",
      "timeout_ms",
      "title",
    ]);
    expect(js?.inputSchema.properties?.code).toMatchObject({
      description: "JavaScript code to execute in the Node REPL session",
    });
    expect(js?.inputSchema.properties?.timeout_ms).toMatchObject({
      description: expect.stringContaining(
        "You MUST provide this when the code is expected to run longer than 30000 ms",
      ),
    });
    expect(js?.description).toContain("required `title`");
    expect(NODE_REPL_DEFAULT_TIMEOUT_MS).toBe(60_000);
    expect(NODE_REPL_SERVER_INSTRUCTIONS).toContain("default to a 60000 ms timeout");
    expect(js?.description).toContain("after 60000 ms");
    expect(js?.description).toContain(
      "you MUST set `timeout_ms` to at least the estimated total runtime plus 15000 ms",
    );
    expect(js?.description).not.toContain("after 30000 ms");

    const legacyCall = await client.callTool({
      name: "js",
      arguments: { code: '"legacy";' },
    });
    expect(legacyCall.isError).not.toBe(true);
    expect(legacyCall.content).toContainEqual(
      expect.objectContaining({ type: "text", text: "=> legacy" }),
    );
  });

      it("creates a fresh kernel for every js call", async () => {
    const first = await client.callTool({
      name: "js",
      arguments: {
        code: "globalThis.counter = 41; counter;",
        title: "初始化计数",
      },
      _meta: requestMeta("session-1"),
    });
    expect(first.content).toContainEqual(expect.objectContaining({ type: "text", text: "=> 41" }));

    const second = await client.callTool({
      name: "js",
      arguments: {
        code: "({ counterType: typeof globalThis.counter, session: nodeRepl.requestMeta.session_id });",
      },
      _meta: requestMeta("session-1", "main", "turn-2"),
    });
    expect(second.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"counterType": "undefined"'),
      }),
    );
    expect(second.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"session": "session-1"'),
      }),
    );
  });

  it("exposes js as the only node_repl tool and rejects the two retired ones", async () => {
    // 修复原因：2026-09-18 下架 js_reset 与 js_add_node_module_dir，node_repl 只留 js。
    // js_reset 自 fresh-kernel 改造起就是固定返回成功的空操作，而"永不失败"会让弱模型连续
    // 重复调用它（工单 ZCT-2100503886992535552：155 次连调、19 分钟 4837 万输入 token 直到 429）。
    // js_add_node_module_dir 则是把宿主职责推给模型——模型无法自行知道该传哪个 node_modules，
    // 能告诉它的只有 skill 文档，而文档知道的路径宿主自己就能注入；实测两者调用量均为 0。
    // 必须同时守住两件事：不再出现在模型工具面，且调用时明确失败而非静默成功——
    // Tool not found 才是模型换策略所需的信号。
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["js"]);
    for (const retired of ["js_reset", "js_add_node_module_dir"]) {
      await expect(
        client.callTool({ name: retired, arguments: {}, _meta: requestMeta("session-1") }),
      ).rejects.toThrow(`Tool ${retired} not found`);
    }
  });

  it("supports top-level await import syntax", async () => {
    const result = await client.callTool({
      name: "js",
      arguments: {
        code: 'const pathModule = await import("node:path"); pathModule.sep;',
      },
      _meta: requestMeta("session-1"),
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringMatching(/^=> [\\/]$/),
      }),
    );
  });

  it("ignores spoofed top-level session metadata in favor of the host namespace", async () => {
    const result = await client.callTool({
      name: "js",
      arguments: { code: "nodeRepl.requestMeta.session_id;" },
      _meta: {
        session_id: "spoofed-session",
        ...requestMeta("trusted-session"),
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: "text", text: "=> trusted-session" }),
    );
  });

  it("keeps generic JavaScript available for subagent calls", async () => {
    const result = await client.callTool({
      name: "js",
      arguments: { code: "21 * 2;" },
      _meta: requestMeta("subagent-session", "subagent"),
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(expect.objectContaining({ type: "text", text: "=> 42" }));
  });

  it("returns a structured error without suppressing the standard MCP error marker", async () => {
    const result = await client.callTool({
      name: "js",
      arguments: {
        code: [
          'nodeRepl.write("internal diagnostic that must not reach the model");',
          "const error = new Error(\"browser tab 'iab-tab:test' returned an invalid viewport\");",
          'error.name = "BrowserCommandError";',
          "throw error;",
        ].join("\n"),
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "browser tab 'iab-tab:test' returned an invalid viewport",
      },
    ]);
    expect(result._meta).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("BrowserCommandError");
    expect(JSON.stringify(result)).not.toContain("internal diagnostic");
    expect(JSON.stringify(result)).not.toContain(" at ");
  });

  it("projects images plus response metadata from a fresh call", async () => {
    const output = await client.callTool({
      name: "js",
      arguments: {
        code: 'nodeRepl.setResponseMeta({ browser_use: { url: "https://example.test" } }); await nodeRepl.emitImage({ base64: "AAAA", mimeType: "image/png" }); "done";',
      },
      _meta: requestMeta("session-1"),
    });
    expect(output.content).toContainEqual(
      expect.objectContaining({
        type: "image",
        data: "AAAA",
        mimeType: "image/png",
      }),
    );
    expect(output._meta).toEqual({
      browser_use: { url: "https://example.test" },
      "zcode/nodeReplEmittedImage": true,
    });
  });

    it("orders image blocks before the text block so image-first providers keep the raster", () => {
    const result = toMcpRunResult({
      logs: "log line",
      result: "done",
      images: [
        { base64: "AQID", mimeType: "image/png" },
        { base64: "BAUG", mimeType: "image/jpeg" },
      ],
    });

    expect(result.content).toEqual([
      { type: "image", data: "AQID", mimeType: "image/png" },
      { type: "image", data: "BAUG", mimeType: "image/jpeg" },
      { type: "text", text: "log line\n=> done" },
    ]);
  });

  it("drops a byte-identical emitImage duplicate so a redundant call cannot cost the whole frame", () => {
    // Bug 原因（2026-09-11 真机）：模型写
    //   const shot = await app.getScreenshot(); await nodeRepl.emitImage(shot);
    // getScreenshot 已经经 emitStructuredResult 投过「图 + 权威」，于是结果里两张图，
    // exact-raster 门按「每个结果只允许一张最终 raster」把整帧原子否决。
    //
    // 门不能放宽（frame_id 绑定像素坐标），但逐字节相同的那份是纯冗余，丢掉即可，
    // 冗余调用不再连累整帧被否决。
    const authority = JSON.stringify({
      image_ref: { actionable: true, frame_id: "frame-1", height: 2, width: 4 },
    });
    const result = toMcpRunResult({
      structuredResults: [
        {
          content: [
            { type: "image", data: "AQID", mimeType: "image/png" },
            { type: "text", text: authority },
          ],
        },
      ],
      images: [{ base64: "AQID", mimeType: "image/png" }],
    } as never);

    const images = result.content.filter((block) => block.type === "image");
    expect(images).toEqual([{ type: "image", data: "AQID", mimeType: "image/png" }]);
    // 权威必须紧跟在存活的那张图后面 —— 原子对不能被去重打散。
    expect(result.content[0]?.type).toBe("image");
    expect((result.content[1] as { text?: string }).text).toBe(authority);
  });

  it("keeps a different model image so a genuine two-raster result still reaches the gate", () => {
    // 字节不同就不是冗余：那是真的两张 raster，判定权仍属完整性门，宿主不得代它放行。
    const result = toMcpRunResult({
      structuredResults: [{ content: [{ type: "image", data: "AQID", mimeType: "image/png" }] }],
      images: [{ base64: "ZZZZ", mimeType: "image/png" }],
    } as never);

    expect(result.content.filter((block) => block.type === "image")).toHaveLength(2);
  });

    it("keeps an SDK result authoritative when the model logs its returned value", () => {
    const structured = {
      content: [
        { type: "image", data: "AQID", mimeType: "image/png" },
        { type: "text", text: '{"image_ref":"frame-2"}' },
      ],
      structuredContent: { state_id: "state-2" },
    };
    const result = toMcpRunResult({
      logs: `console output\n${JSON.stringify({ content: structured.content })}`,
      result: JSON.stringify({ content: structured.content }),
      structuredResults: [structured],
    });

    expect(result.content).toEqual([
      ...structured.content,
      {
        type: "text",
        text: 'console output\n{"content":[{"type":"image","data":"AQID","mimeType":"image/png"},{"type":"text","text":"{\\"image_ref\\":\\"frame-2\\"}"}]}',
      },
    ]);
    expect(result).toMatchObject({
      structuredContent: structured.structuredContent,
      // 图片经 node_repl 通道产出时标记 emitted-image（上游 v3.15.1 契约；CUA meta 已删）。
      _meta: { "zcode/nodeReplEmittedImage": true },
    });
  });

    it("keeps the single text block when no image is emitted", () => {
    expect(toMcpRunResult({ logs: "", result: undefined }).content).toEqual([
      { type: "text", text: "(no output)" },
    ]);
  });

  it("projects trusted browser screenshot image indices and removes spoofed response metadata", () => {
    const screenshot = toMcpRunResult({
      logs: "",
      images: [{ base64: "AQID", mimeType: "image/png" }],
      browserScreenshotImageIndices: [0],
    });
    // image 现在从 content[0] 开始，image 下标与 content 下标一致，不再有 +1 偏移。
    expect(screenshot.content[0]).toEqual({
      type: "image",
      data: "AQID",
      mimeType: "image/png",
    });
    expect(screenshot._meta).toMatchObject({
      [ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY]: [0],
    });

    const spoofed = toMcpRunResult({
      logs: "",
      images: [{ base64: "BAUG", mimeType: "image/png" }],
      responseMeta: {
        [ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY]: [1],
      },
    });
    expect(spoofed._meta).not.toHaveProperty(ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY);
  });

    it("maps screenshot indices to their real content positions when only some images are screenshots", () => {
    const result = toMcpRunResult({
      logs: "",
      images: [
        { base64: "AAAA", mimeType: "image/png" },
        { base64: "BBBB", mimeType: "image/png" },
        { base64: "CCCC", mimeType: "image/png" },
      ],
      browserScreenshotImageIndices: [0, 2],
    });

    expect(result._meta).toMatchObject({
      [ZCODE_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY]: [0, 2],
    });
    // 每个声明的下标都必须真的指向 content 里的 image block（越界或指到 text 都会让原图落盘错位）。
    for (const index of [0, 2]) {
      expect(result.content[index]?.type).toBe("image");
    }
    expect(result.content[1]).toEqual({ type: "image", data: "BBBB", mimeType: "image/png" });
  });
});
