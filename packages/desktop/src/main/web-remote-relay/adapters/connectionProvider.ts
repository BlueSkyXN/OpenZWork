import { createHash, randomBytes, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { ICredentialService } from "@zcode/services";
import {
  DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS,
  OFFICIAL_WEB_REMOTE_CONTROL_V1,
  webRemoteControlConnectionSettingsSchema,
  validateWebRemoteControlUrl,
  resolveWebRemoteControlBrowserRelayUrl,
  type AppSettings,
  type WebRemoteControlConnectionSettings,
} from "@zcode/shared";
import type {
  WebRemoteControlPreparedConnection,
  WebRemoteControlRelayAuthStorageProvider,
  WebRemoteControlRelayStoredAuth,
} from "../contract.js";
import { createWebRemoteControlDirectGateway } from "./directGateway.js";

interface Dependencies {
  credentialService: Pick<ICredentialService, "load" | "save" | "delete">;
  loadSettings(): Promise<AppSettings>;
  patchSettings(patch: Partial<AppSettings>): Promise<void>;
  staticRoot: string;
  relayWsEnv?: string;
  pageUrlEnv?: string;
}

/** 无端点归属的 legacy 凭据保留不动；新记录原子保存 SID 和 hash。 */
export function createScopedWebRemoteControlAuthStorage(
  credentialService: Dependencies["credentialService"],
  scope: string,
): WebRemoteControlRelayAuthStorageProvider {
  const key = `web-remote-control:v1:${createHash("sha256").update(scope).digest("hex")}`;
  let queue = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  return {
    load: () =>
      serialized(async () => {
        const raw = await credentialService.load(key);
        if (!raw) return undefined;
        try {
          const parsed = JSON.parse(raw) as WebRemoteControlRelayStoredAuth;
          if (
            typeof parsed.deviceSid === "string" &&
            parsed.deviceSid.trim() &&
            typeof parsed.passHash === "string" &&
            parsed.passHash.trim()
          )
            return parsed;
        } catch {
          /* 损坏记录不能作为配对凭据发送；下一次注册成功后替换。 */
        }
        return undefined;
      }),
    save: (auth) => serialized(() => credentialService.save(key, JSON.stringify(auth))),
    clear: () => serialized(() => credentialService.delete(key)),
    rotate: (auth) => serialized(() => credentialService.save(key, JSON.stringify(auth))),
  };
}

function memoryAuthStorage(
  auth: WebRemoteControlRelayStoredAuth,
): WebRemoteControlRelayAuthStorageProvider {
  let current: WebRemoteControlRelayStoredAuth | undefined = auth;
  return {
    load: async () => current,
    save: async (next) => {
      current = next;
    },
    clear: async () => {
      current = undefined;
    },
    rotate: async (next) => {
      current = next;
    },
  };
}

export function createWebRemoteControlConnectionProvider(dependencies: Dependencies) {
  const stores = new Map<string, WebRemoteControlRelayAuthStorageProvider>();
  const getSettings = async (): Promise<WebRemoteControlConnectionSettings> => {
    const saved = (await dependencies.loadSettings()).webRemoteControlConnection;
    if (saved) return webRemoteControlConnectionSettingsSchema.parse(saved);
    const defaults = structuredClone(DEFAULT_WEB_REMOTE_CONTROL_CONNECTION_SETTINGS);
    if (dependencies.relayWsEnv || dependencies.pageUrlEnv) {
      defaults.mode = "self-hosted";
      defaults.relay = {
        wsUrl: dependencies.relayWsEnv ?? "",
        pageUrl: dependencies.pageUrlEnv ?? "",
      };
    }
    return defaults;
  };
  return {
    getSettings,
    async prepare(
      windowId: number,
      requested: WebRemoteControlConnectionSettings | undefined,
      signal: AbortSignal,
      resetPairing = false,
    ): Promise<WebRemoteControlPreparedConnection> {
      const settings = webRemoteControlConnectionSettingsSchema.parse(
        requested ?? (await getSettings()),
      );
      signal.throwIfAborted();
      let relayWsUrl: string;
      let mobileRemoteControlUrl: string;
      let authStorageProvider: WebRemoteControlRelayAuthStorageProvider;
      let dispose = async () => {};
      if (settings.mode === "direct") {
        const publicUrl = settings.direct.publicUrl
          ? validateWebRemoteControlUrl(settings.direct.publicUrl, "page")
          : undefined;
        if (publicUrl && !["/", "/remote", "/remote/"].includes(new URL(publicUrl).pathname))
          throw new Error("直连访问地址请使用 /remote/ 路径");
        const detected = Object.values(networkInterfaces())
          .flat()
          .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
        const host =
          settings.direct.listenHost === "0.0.0.0" || settings.direct.listenHost === "::"
            ? detected
            : settings.direct.listenHost;
        if (!publicUrl && !host) throw new Error("未找到可用网络地址，请填写手机可访问的地址");
        const auth = { deviceSid: randomUUID(), passHash: randomBytes(32).toString("base64") };
        const gateway = await createWebRemoteControlDirectGateway({
          ...settings.direct,
          staticRoot: dependencies.staticRoot,
          auth,
          signal,
        });
        dispose = gateway.dispose;
        const localHost = ["0.0.0.0", "::"].includes(settings.direct.listenHost)
          ? "127.0.0.1"
          : settings.direct.listenHost;
        const bracket = (value: string) =>
          value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
        relayWsUrl = `ws://${bracket(localHost)}:${gateway.port}/ws`;
        mobileRemoteControlUrl = publicUrl
          ? new URL("/remote/", publicUrl).toString()
          : `http://${bracket(host!)}:${gateway.port}/remote/`;
        authStorageProvider = memoryAuthStorage(auth);
      } else {
        const endpoint =
          settings.mode === "official"
            ? OFFICIAL_WEB_REMOTE_CONTROL_V1
            : { relayWsUrl: settings.relay.wsUrl, remoteUrl: settings.relay.pageUrl };
        mobileRemoteControlUrl = validateWebRemoteControlUrl(endpoint.remoteUrl, "page");
        relayWsUrl = resolveWebRemoteControlBrowserRelayUrl(
          mobileRemoteControlUrl,
          validateWebRemoteControlUrl(endpoint.relayWsUrl, "relay"),
        );
        const scope = `${relayWsUrl}\nwindow:${windowId}`;
        let stored = stores.get(scope);
        if (!stored) {
          stored = createScopedWebRemoteControlAuthStorage(dependencies.credentialService, scope);
          stores.set(scope, stored);
        }
        authStorageProvider = stored;
        if (resetPairing) await authStorageProvider.clear();
      }
      if (signal.aborted) {
        await dispose();
        signal.throwIfAborted();
      }
      return {
        settings,
        relayWsUrl,
        mobileRemoteControlUrl,
        authStorageProvider,
        dispose,
        commit: async () => {
          signal.throwIfAborted();
          await dependencies.patchSettings({ webRemoteControlConnection: settings });
          signal.throwIfAborted();
        },
      };
    },
  };
}
