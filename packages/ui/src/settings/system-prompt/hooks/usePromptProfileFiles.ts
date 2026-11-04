import { useCallback } from "react";
import { SYSTEM_PROMPT_PROFILE_MAX_BYTES } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useOptionalServices } from "@/hooks/useServices.js";

const READ_CHUNK_BYTES = 1024 * 1024;

export function usePromptProfileFiles() {
  const platform = useOptionalPlatform();
  const services = useOptionalServices();
  const read = useCallback(async () => {
    if (!platform?.canSelectFilePath || !services) return null;
    const path = await platform.selectFile();
    if (!path) return null;
    const info = await services.fileService.readTextFile({ path, length: 1 });
    if (info.totalBytes > SYSTEM_PROMPT_PROFILE_MAX_BYTES) throw new Error("Profile exceeds 2 MiB");
    const bytes = new Uint8Array(info.totalBytes);
    let offset = 0;
    while (offset < bytes.length) {
      const part = await services.fileService.readFileRange({
        path,
        offset,
        length: Math.min(READ_CHUNK_BYTES, bytes.length - offset),
      });
      if (!part.byteLength || part.byteLength > bytes.length - offset)
        throw new Error("Profile file changed while reading");
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    // 文件服务按字节分片；统一解码避免中文字符落在边界时损坏。
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }, [platform, services]);
  const save = useCallback(
    async (text: string) => {
      const suggestedName = "system-prompt-profile.json";
      if (platform?.saveFile) {
        const result = await platform.saveFile({
          data: new TextEncoder().encode(text).buffer,
          suggestedName,
        });
        if (!result.success && !result.canceled)
          throw new Error(result.error ?? "File save failed");
        return;
      }
      const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    [platform],
  );
  return { read, save, canReadFile: Boolean(platform?.canSelectFilePath && services) };
}
