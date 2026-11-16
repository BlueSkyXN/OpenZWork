/** Host 侧 WT04 direct 证据只读探针：真实 V4 订阅面观察（E2E gate 全开才启用）。 */
export const hostE2EAttachmentProbeModule = {
  id: "host-e2e-attachment-probe",
  requires: ["services", "shared"],
  provides: ["host-e2e-attachment-probe"],
  publicEntrypoints: ["index.ts"],
} as const;
