import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const desktopDir = fileURLToPath(new URL("../../", import.meta.url));
const loadWorkerHome = `
  import { FileSystemPathService } from "@wdio/config/node";
  const config = await new FileSystemPathService().loadFile(new URL("./wdio.conf.ts", import.meta.url).href);
  await config.resetE2EHome([process.argv[1]]);
`;
interface SeededConfig {
  defaultModelSelection: { providerId: string; modelId: string };
  providerConfigRules: { providerRules: Array<{ providerId: string }> };
  modelConfigRules: {
    providerModelRules: Array<{
      providerId: string;
      modelId: string;
      config: {
        properties: { contextWindow: number };
        optionSpecs: { maxOutputTokens: { max: number } };
      };
    }>;
  };
}

async function runReset(spec: string, env: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), ".e2e-home-runner-"));
  const stale = join(home, "previous-worker");
  try {
    await writeFile(stale, "previous worker");
    // 旧测试只摘出 resetE2EHome 的函数体，实际初始化已拆入多个 helper。
    // 使用 WDIO 自己的配置加载器，在隔离子进程内只执行真实的 HOME 准备步骤。
    const systemEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(path|systemroot|systemdrive|windir|tmp|temp|tmpdir)$/i.test(key),
      ),
    );
    await exec(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", loadWorkerHome, spec],
      {
        cwd: desktopDir,
        env: {
          ...systemEnv,
          HOME: home,
          USERPROFILE: home,
          ZCODE_E2E_HOME_DIR: home,
          ZCODE_E2E_PACKAGED_APP_PATH: process.execPath,
          E2E_PROVIDER_PRESET: "env",
          E2E_PROVIDER_HTTP_MODE: "capture",
          E2E_PROVIDER_BASE_URL: "http://127.0.0.1:1",
          E2E_PROVIDER_MODEL: "fixture-model",
          E2E_PROVIDER_API_KEY: "xxx",
          ...env,
        },
      },
    );
    const dir = join(home, ".openzwork", "v2");
    const providerFile = join(dir, "provider_config.json");
    const provider: SeededConfig | null = existsSync(providerFile)
      ? JSON.parse(await readFile(providerFile, "utf8")).config
      : null;
    return {
      cleaned: !existsSync(stale),
      settings: JSON.parse(await readFile(join(dir, "setting.json"), "utf8")),
      hasCredentials: existsSync(join(dir, "credentials.json")),
      provider,
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("desktop-e2e-runner 隔离初始化合同", () => {
  it("清理旧 worker 的 HOME，缺少捕获凭据时只写本地启动设置", async () => {
    const result = await runReset("smoke.test.ts");
    expect(result.cleaned).toBe(true);
    expect(result.settings).toMatchObject({ providerFamilyConnectionSelections: {} });
    expect(result.hasCredentials).toBe(false);
    expect(result.provider).toBeNull();
  });

  it.each([
    ["conversation-session-web-remote-unread.test.ts", {}, 128000, 32000],
    ["conversation-session-compact-auto.test.ts", {}, 240, 80],
    [
      "conversation-session-compact-auto.test.ts",
      {
        ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW: "64000",
        ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS: "4096",
      },
      64000,
      4096,
    ],
  ] as const)(
    "%s 为默认模型写入当前场景的上下文及输出上限 %j",
    async (spec, env, contextWindow, maxOutputTokens) => {
      const { provider } = await runReset(spec, {
        E2E_PROVIDER_API_KEY: "synthetic-runner-fixture",
        ...env,
      });
      expect(provider?.defaultModelSelection).toMatchObject({
        providerId: "e2e-upstream",
        modelId: "fixture-model",
      });
      expect(provider?.providerConfigRules.providerRules).toContainEqual(
        expect.objectContaining({ providerId: "e2e-upstream" }),
      );
      const model = provider?.modelConfigRules.providerModelRules.find(
        (rule) =>
          rule.providerId === provider.defaultModelSelection.providerId &&
          rule.modelId === provider.defaultModelSelection.modelId,
      );
      expect(model?.config.properties.contextWindow).toBe(contextWindow);
      expect(model?.config.optionSpecs.maxOutputTokens.max).toBe(maxOutputTokens);
    },
  );
});
