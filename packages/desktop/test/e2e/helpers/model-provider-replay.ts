import { homedir } from "node:os";
import { resolve } from "node:path";
import { startUpstreamReplayServer, type UpstreamReplayServer } from "./upstream-replay-server.js";
import { createE2EReplayFixtureVariables } from "./e2e-runtime-paths.js";
import { DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY } from "./network-capture-proxy.js";
import { getE2EAppDataPaths } from "./desktop-app.js";
import {
  seedPersonalProviderConfig,
  seedPersonalDefaultModelSelection,
} from "./model-provider-restart-config.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_PROVIDER_NAME,
  getUpstreamApiKey,
} from "./upstream-provider.js";

const DESKTOP_DIR = resolve(import.meta.dirname, "../../..");
const UPSTREAM_REPLAY_FIXTURE_ROOT = resolve(DESKTOP_DIR, "test/e2e/fixtures/upstream");
const UPSTREAM_COMMON_REPLAY_FIXTURE_PATH = resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "common.json");

export async function startConversationModelProviderReplayServer(
  caseName: string,
  options: { seedPersonalConfig?: boolean } = {},
): Promise<UpstreamReplayServer> {
  const captureDir = resolve(
    process.env.ZCODE_E2E_NETWORK_CAPTURE_DIR?.trim() ||
      resolve(homedir(), "..", ".e2e-network-capture"),
  );
  const server = await startUpstreamReplayServer({
    artifactPath: resolve(captureDir, `${caseName}.json`),
    fixtureVariables: createE2EReplayFixtureVariables(),
    fixturePaths: [
      UPSTREAM_COMMON_REPLAY_FIXTURE_PATH,
      resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "conversation-session", `${caseName}.json`),
    ],
  });

  process.env.E2E_PROVIDER_CAPTURE_MODE = "replay";
  process.env.E2E_PROVIDER_CAPTURE_PATH = server.artifactPath;
  process.env.E2E_PROVIDER_CAPTURE_PROXY_URL = server.baseUrl;
  process.env.E2E_PROVIDER_EXPECTED_HOST = `${server.host}:${server.port}`;
  process.env.E2E_PROVIDER_EXPECTED_PROTOCOL = "http";
  process.env.E2E_PROVIDER_RUNTIME_BASE_URL = server.baseUrl;
  process.env.NO_PROXY = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;
  process.env.no_proxy = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;

  if (options.seedPersonalConfig) {
    // 会话布局用例需要稳定 Provider 身份；通过正式 Personal Config 写入完整执行事实，
    // 避免 UI 新建产生随机 ID 后，后续模型选择仍按 fixture ID 查找。
    try {
      const configFile = getE2EAppDataPaths().configFile;
      await seedPersonalProviderConfig(configFile, {
        id: UPSTREAM_PROVIDER_ID,
        label: UPSTREAM_PROVIDER_NAME,
        apiFormat: "anthropic-messages",
        apiKey: getUpstreamApiKey(),
        baseURL: server.baseUrl,
        models: [
          { id: UPSTREAM_MODEL, reasoningLevel: { values: ["disabled", "high"], map: "{}" } },
        ],
      });
      await seedPersonalDefaultModelSelection(configFile, {
        providerId: UPSTREAM_PROVIDER_ID,
        modelId: UPSTREAM_MODEL,
      });
    } catch (error) {
      await server.stop();
      throw error;
    }
  }

  return server;
}
