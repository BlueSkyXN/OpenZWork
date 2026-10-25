import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { pluginUiStateKey } from "@/plugin-ui/adapters/pluginUiStateKey.js";
it("下发稳定的不透明窗口键，不暴露路径或 session", async () => {
  const key = '["/Users/dev/private","session-private","panel"]';
  const result = await pluginUiStateKey(key);
  expect(result).toMatch(/^[a-f0-9]{64}$/);
  expect(result).toBe(await pluginUiStateKey(key));
  expect(result).not.toBe(await pluginUiStateKey(key + "other"));
  expect(result).not.toContain("private");
});

afterEach(() => vi.unstubAllGlobals());
it("普通 HTTP 下的窗口键与 HTTPS 使用相同摘要", async () => {
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const key = '["/workspace","session","panel"]';
  expect(await pluginUiStateKey(key)).toBe(createHash("sha256").update(key).digest("hex"));
});
