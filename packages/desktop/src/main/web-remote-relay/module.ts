export const desktopWebRemoteRelayModule = {
  id: "desktop-web-remote-relay",
  requires: ["desktop", "services", "shared", "web-remote-relay"],
  provides: ["desktop-web-remote-relay"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
