import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startProcessProviderRegistryRuntime } from "../src/app/process-provider-registry-runtime.js";
import { describe, expect, it, vi } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { decodeProviderConfigFile } from "@zcode/provider-node";
import { createDefaultSystemPromptSettings } from "@zcode/shared";
import { createZCodeApp } from "../src/app/create-app.js";
import {
  ownerAt,
  providerData,
  sandbox,
} from "../../../../../packages/services/test/configPackageFixture.js";

describe("CP-10 配置包与 Bootstrap 会话", () => {
  it("在途请求保留凭据，刷新后旧会话使用新凭据和旧提示词，重启后两者均更新", async () => {
    const root = await sandbox(),
      a = join(root, "source"),
      b = join(root, "target"),
      workspace = join(root, "workspace");
    await mkdir(workspace);
    const requests: { authorization?: string; messages: string; instructions: string }[] = [];
    const received = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const http = createServer(async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString()) as {
        messages: { role: string; content: unknown }[];
        stream?: boolean;
      };
      const messages = JSON.stringify(body.messages);
      requests.push({
        authorization: req.headers.authorization,
        messages,
        instructions: JSON.stringify(
          body.messages.filter((message) => message.role === "system" || message.role === "developer"),
        ),
      });
      if (messages.includes("first-marker")) {
        received.resolve();
        await release.promise;
      }
      if (!body.stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "local",
            object: "chat.completion",
            created: 1,
            model: "sample",
            choices: [
              { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const event = {
        id: "local",
        created: 1,
        object: "chat.completion.chunk",
        model: "sample",
        choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
      };
      res.end(
        "data: " +
          JSON.stringify(event) +
          "\n\n" +
          "data: " +
          JSON.stringify({ ...event, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
          "\n\ndata: [DONE]\n\n",
      );
    });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("fixture listener");
    const selection = {
      providerId: "personal:fixture",
      modelId: "sample",
      options: { reasoningLevel: "disabled" },
    };
    const setup = async (home: string, marker: string) => {
      const host = ownerAt(home);
      const rule = providerData(selection.providerId, marker);
      rule.config.api = {
        type: "openai-chat-completions",
        baseUrl: "http://127.0.0.1:" + address.port + "/v1",
      };
      await host.repo.update(() =>
        decodeProviderConfigFile({
          schemaVersion: 1,
          config: {
            providerConfigRules: { providerRules: [rule] },
            modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
            defaultModelSelection: selection,
          },
        }),
      );
      await host.options.settings.update(
        {
          systemPromptSettings: {
            ...createDefaultSystemPromptSettings(),
            mode: "replace",
            replacement: "prompt-" + marker,
          },
        },
        { expectedSystemPromptSettings: null },
      );
      return host;
    };
    const sessions: Awaited<ReturnType<typeof createZCodeApp>>[] = [],
      stores: Awaited<ReturnType<typeof createSqliteSessionStore>>[] = [];
    const workers: Awaited<ReturnType<typeof startProcessProviderRegistryRuntime>>[] = [];
    const builtin = join(root, "worker-builtin.json");
    await copyFile(
      fileURLToPath(new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url)),
      builtin,
    );
    const start = async (host: ReturnType<typeof ownerAt>) => {
      const worker = await startProcessProviderRegistryRuntime({
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtin,
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(b, ".openzwork", "v2", "provider_config.json"),
      });
      workers.push(worker);
      const store = await createSqliteSessionStore({ dbPath: ":memory:" });
      stores.push(store);
      const config = await host.repo.read();
      const prefs = await host.options.settings.get();
      const app = await createZCodeApp({
        env: { HOME: b, USERPROFILE: b, ZCODE_STORAGE_DIR: join(b, "storage") },
        configuredDefaultModelSelection: config.defaultModelSelection,
        providerRegistry: worker.runtime.registryService,
        sessionStore: store,
        skipUserConfig: true,
        runtimeConfig: {
          workingDirectory: workspace,
          mcp: { enabled: false },
          systemPromptSettings: prefs.systemPromptSettings,
          modelSelection: config.defaultModelSelection,
        },
      });
      sessions.push(app);
      return app;
    };
    try {
      const file = join(root, "move.gz"),
        source = await setup(a, "synthetic-new");
      await source.service.exportToFile(file, ["providers", "systemPrompt"]);
      const target = await setup(b, "synthetic-old");
      const old = await start(target);
      const turn = async (app: typeof old, label: string) => {
        const before = requests.length;
        await app.submitPrompt(label);
        const request = requests.slice(before).find((value) => value.messages.includes(label));
        expect(request, "运行时必须实际发出此轮请求").toBeDefined();
        return request!;
      };
      const pending = turn(old, "first-marker");
      await Promise.race([
        received.promise,
        pending.then(() => {
          throw new Error("missing in-flight request");
        }),
      ]);
      const rootUrl = new URL("../../../../../", import.meta.url);
      const hostImport = fileURLToPath(
        new URL("packages/services/test/configPackageHostImport.ts", rootUrl),
      );
      await promisify(execFile)(process.execPath, ["--import", "tsx", hostImport, b, file, builtin], {
        cwd: fileURLToPath(rootUrl),
        env: {
          ...process.env,
          HOME: b,
          USERPROFILE: b,
          ZCODE_DATA_BASE_DIR: b,
          ZCODE_DESKTOP_HOME_DIR: b,
        },
        timeout: 20_000,
      });
      release.resolve();
      const first = await pending;
      expect(first.authorization).toBe("Bearer synthetic-old");
      expect(first.instructions).toContain("prompt-synthetic-old");
      // CLI 与导入进程只共享磁盘。等 CLI 观察到本次提交，再测旧会话下一轮。
      await vi.waitFor(
        () =>
          expect(
            workers[0]!.runtime.registryService.getProvider(selection.providerId)?.config.access,
          ).toMatchObject({ apiKey: "synthetic-new" }),
        { timeout: 5000 },
      );
      const previous = await turn(old, "existing-marker");
      expect(previous.authorization).toBe("Bearer synthetic-new");
      expect(previous.instructions).toContain("prompt-synthetic-old");
      expect(previous.instructions).not.toContain("prompt-synthetic-new");
      await old.close?.();
      sessions.pop();
      workers.pop()!.dispose();
      target.runtime.dispose();
      const fresh = await start(ownerAt(b)),
        next = await turn(fresh, "new-marker");
      expect(next.authorization).toBe("Bearer synthetic-new");
      expect(next.instructions).toContain("prompt-synthetic-new");
      expect(next.instructions).not.toContain("prompt-synthetic-old");
    } finally {
      release.resolve();
      for (const app of sessions) await app.close?.();
      for (const store of stores) store.close();
      for (const worker of workers) worker.dispose();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
      vi.restoreAllMocks();
    }
  }, 45000);
});
