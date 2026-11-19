import type { IConfigPackageService } from "./contract.js";

/** 端口断开时释放已返回及仍在读取的预览，避免切窗或 renderer 重载后敏感载荷驻留。 */
export function attachConfigPackage(owner: IConfigPackageService) {
  let closed = false;
  const previews = new Set<string>();
  const requireActive = () => {
    if (closed) throw new Error("config-package.expired");
  };
  const release = (id: string) => owner.releasePreview(id).catch(() => {});
  const service: IConfigPackageService = {
    exportToFile(path, categories) {
      requireActive();
      return owner.exportToFile(path, categories);
    },
    async previewFile(path) {
      requireActive();
      const result = await owner.previewFile(path);
      if (closed) {
        await release(result.previewId);
        throw new Error("config-package.expired");
      }
      previews.add(result.previewId);
      return result;
    },
    async applyPreview(id, selected) {
      requireActive();
      if (!previews.has(id)) throw new Error("config-package.expired");
      return owner.applyPreview(id, selected);
    },
    async releasePreview(id) {
      if (previews.delete(id)) await release(id);
    },
  };
  return {
    service,
    dispose() {
      closed = true;
      for (const id of previews) void release(id);
      previews.clear();
    },
  };
}
