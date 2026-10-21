import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createLocalPairingRelay } from "./local-pairing-relay.js";

// 手机入口通过配对链接授权；当前产品没有账号登录凭据。
export const WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS: Record<string, string> = {};

/** 真实 Main/Host/renderer 链路只替换外部 relay，仍执行设备挑战应答。 */
export async function prepareWebRemoteControlSessionEventsFixture(options: {
  credentialsFile: string;
  settingsFile: string;
  workspacePath: string;
  webUrl?: string;
}): Promise<() => Promise<void>> {
  const relay = await createLocalPairingRelay();
  const envPatch = {
    ...(options.webUrl ? { VITE_ZCODE_E2E_STORE_BRIDGE: "1" } : {}),
    ZCODE_ENDPOINT_ORIGIN: relay.httpUrl,
    ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL: relay.wsUrl,
    ZCODE_WEB_REMOTE_CONTROL_URL: options.webUrl ?? `${relay.httpUrl}/remote/v4`,
  };
  const previous = Object.fromEntries(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, envPatch);
  let web: ViteDevServer | undefined;
  const close = async () => {
    try {
      await web?.close();
    } finally {
      await relay.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  try {
    if (options.webUrl) {
      // 默认 Web 开发代理指向 3030；fixture 必须将 /ws 接到同一个隔离 relay。
      const url = new URL(options.webUrl);
      web = await createViteServer({
        root: resolve(import.meta.dirname, "../../../../../packages/web"),
        server: {
          host: "127.0.0.1",
          port: Number(url.port),
          strictPort: true,
          // target 只含 origin；http-proxy 会追加入站 /ws，否则变为 /ws/ws。
          proxy: { "/ws": { target: relay.httpUrl, ws: true } },
        },
      });
      await web.listen();
    }
    const settings = JSON.parse(await readFile(options.settingsFile, "utf8"));
    await writeFile(
      options.settingsFile,
      JSON.stringify({
        ...settings,
        zcodeEndpointOrigin: relay.httpUrl,
        webRemoteControlLastEnabledContext: { workspacePath: options.workspacePath },
      }),
    );
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
