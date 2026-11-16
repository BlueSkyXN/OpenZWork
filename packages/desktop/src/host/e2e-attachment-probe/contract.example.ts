import { createHostE2EAttachmentProbe } from "./contract.js";

/** Host exposeServicesOnMessagePort 内按 registry attach 事实包装 agent service 的用法。 */
export function exampleHostE2EAttachmentProbe(env: NodeJS.ProcessEnv) {
  const probe = createHostE2EAttachmentProbe({
    enabled: env.VITE_ZCODE_E2E_STORE_BRIDGE === "1" && Boolean(env.ZCODE_E2E_RUN_ID?.trim()),
    artifactDir: env.ZCODE_E2E_ARTIFACT_DIR,
  });
  return probe.wrapService({
    attachmentId: "att-example",
    clientMode: "desktop-continuous",
    hostConnectionId: "host-rpc-example",
    hostGeneration: 1,
    scope: { kind: "local" },
    service: {} as Parameters<typeof probe.wrapService>[0]["service"],
    sessionService: undefined,
  });
}
