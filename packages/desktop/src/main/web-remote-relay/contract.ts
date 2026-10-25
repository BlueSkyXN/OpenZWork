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
  mobileRemoteControlUrl: string;
  settings: import("@zcode/shared").WebRemoteControlConnectionSettings;
  authStorageProvider: WebRemoteControlRelayAuthStorageProvider;
  commit(): Promise<void>;
  dispose(): Promise<void>;
}
