import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

async function runReset(specs: string[], env: Record<string, string> = {}) {
  const source = await readFile(new URL("../../wdio.conf.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("wdio.conf.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(
    (item): item is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(item) && item.name?.text === "resetE2EHome",
  );
  if (!node) throw new Error("WDIO resetE2EHome is missing");
  const mkdir = vi.fn(async () => undefined);
  const writeFile = vi.fn(async () => undefined);
  const seedPersonalProviderConfig = vi.fn(async (_path: string, _config: unknown) => undefined);
  const seedPersonalDefaultModelSelection = vi.fn(async () => undefined);
  const seedE2EWorkerModelStreamConfig = vi.fn();
  const removeE2EHomeWithRetry = vi.fn(async () => undefined);
  const reset = runInNewContext(
    ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText + ";resetE2EHome;",
    {
      process: { env },
      mkdir,
      writeFile,
      seedPersonalProviderConfig,
      seedPersonalDefaultModelSelection,
      seedE2EWorkerModelStreamConfig,
      removeE2EHomeWithRetry,
      E2E_APP_CONFIG_DIR: "/isolated/.openzwork/v2",
      E2E_STORAGE_ROOT: "/isolated/.openzwork",
      E2E_APP_SETTINGS_FILE: "/isolated/.openzwork/v2/setting.json",
      E2E_APP_PROVIDER_CONFIG_FILE: "/isolated/.openzwork/v2/provider_config.json",
      resolve: (...parts: string[]) => parts.join("/"),
      readPositiveIntegerEnv: (name: string) => (env[name] ? Number(env[name]) : undefined),
    },
  ) as (specs: string[]) => Promise<void>;
  await reset(specs);
  return {
    mkdir,
    writeFile,
    seedPersonalProviderConfig,
    seedPersonalDefaultModelSelection,
    seedE2EWorkerModelStreamConfig,
    removeE2EHomeWithRetry,
  };
}

const providerEnv = {
  E2E_PROVIDER_BASE_URL: "http://127.0.0.1:1/v1",
  E2E_PROVIDER_MODEL: "fixture-model",
};

describe("desktop-e2e-runner 隔离初始化合同", () => {
  it("先清理所属测试目录，只写本地偏好，缺 Provider 配置时不注入账号或模型", async () => {
    const result = await runReset(["smoke.test.ts"]);
    expect(result.removeE2EHomeWithRetry).toHaveBeenCalledOnce();
    expect(result.writeFile).toHaveBeenCalledExactlyOnceWith(
      "/isolated/.openzwork/v2/setting.json",
      JSON.stringify({ locale: "en-US" }),
    );
    expect(result.seedPersonalProviderConfig).not.toHaveBeenCalled();
    expect(result.seedPersonalDefaultModelSelection).not.toHaveBeenCalled();
    expect(result.removeE2EHomeWithRetry.mock.invocationCallOrder[0]).toBeLessThan(
      result.writeFile.mock.invocationCallOrder[0]!,
    );
  });
  it.each([
    ["conversation-session-web-remote-unread.test.ts", 128000, undefined],
    ["conversation-session-compact-auto.test.ts", 240, 80],
  ] as const)(
    "%s 保持目标场景的上下文，并从同一 Provider 设置默认模型",
    async (spec, contextWindow, maxOutputTokens) => {
      const result = await runReset([spec], providerEnv);
      const config = result.seedPersonalProviderConfig.mock.calls[0] as unknown as [
        string,
        { models: object[]; apiKey: string },
      ];
      expect(config[0]).toBe("/isolated/.openzwork/v2/provider_config.json");
      expect(config[1].apiKey).toBe("");
      expect(config[1].models).toEqual([
        {
          id: "fixture-model",
          contextWindow,
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        },
      ]);
      expect(result.seedPersonalDefaultModelSelection).toHaveBeenCalledWith(config[0], {
        providerId: "e2e-personal",
        modelId: "fixture-model",
      });
    },
  );
  it("显式上下文覆盖优先于 Compact 的小窗口", async () => {
    const result = await runReset(["conversation-session-compact-auto.test.ts"], {
      ...providerEnv,
      ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW: "64000",
      ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS: "4096",
    });
    expect(result.seedPersonalProviderConfig).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        models: [{ id: "fixture-model", contextWindow: 64000, maxOutputTokens: 4096 }],
      }),
    );
  });
});
