import type { WebRemoteControlRelayRole } from "@zcode/shared";

export interface WebRemoteControlRelayAuthProvider {
  createPassword(): string;
  createPassHash(password: string): string;
  calculateProof(
    passHash: string,
    nonce: string,
    role: WebRemoteControlRelayRole,
    deviceSid: string,
  ): string;
}

export interface WebRemoteControlRelayStoredAuth {
  deviceSid: string;
  passHash: string;
}

export interface WebRemoteControlRelayAuthStorageProvider {
  load(): Promise<WebRemoteControlRelayStoredAuth | undefined>;
  save(auth: WebRemoteControlRelayStoredAuth): Promise<void>;
  clear(): Promise<void>;
  rotate(auth: WebRemoteControlRelayStoredAuth): Promise<void>;
}

export interface WebRemoteControlDirectGatewayOptions {
  listenHost: string;
  port: number;
  staticRoot: string;
  signal: AbortSignal;
  auth: WebRemoteControlRelayStoredAuth;
}

export interface WebRemoteControlPreparedConnection {
  relayWsUrl: string;
  // fork 净化：上游此接口承载官方 V2 通道字段（deviceMid/meta/getToken/resolveDeviceSid 等
  // JWT 注册与 token 获取回调），随官方账号通道剥离；本地 HMAC/directGateway 变体保留下列字段。
  mobileRemoteControlUrl: string;
  settings: import("@zcode/shared").WebRemoteControlConnectionSettings;
  authStorageProvider: WebRemoteControlRelayAuthStorageProvider;
  commit(): Promise<void>;
  dispose(): Promise<void>;
}
