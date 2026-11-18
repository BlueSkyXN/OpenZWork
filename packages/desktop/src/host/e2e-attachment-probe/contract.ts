/** Host 探针公开面：类型与工厂经 index.ts 提供，contract 只做类型级出口。 */
export type {
  HostE2EAttachmentProbeBinding,
  HostE2EAttachmentProbeContext,
  HostE2EAttachmentProbeIdentity,
  HostE2EAttachmentProbeRecord,
} from "./index.js";
export { createHostE2EAttachmentProbe, resolveHostE2EAttachmentProbeFilePath } from "./index.js";
