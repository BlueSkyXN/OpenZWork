import {
  isApiKeyAccess,
  type ProviderConfigObject,
  type ProviderModelDiscoveryError,
} from "@zcode/provider";
import type { ProviderModelDiscoveryContract, ProviderModelDiscoveryResult } from "./contract.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 1000;
const MAX_PAGES = 20;
class DiscoveryError extends Error {
  constructor(readonly code: ProviderModelDiscoveryError) {
    super(code);
  }
}
async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new DiscoveryError("response-too-large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DiscoveryError("invalid-response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) throw new DiscoveryError("response-too-large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DiscoveryError("invalid-response");
  }
}
function endpoint(config: ProviderConfigObject): URL | null {
  if (
    !config.api?.baseUrl ||
    !config.api.type ||
    !["openai-chat-completions", "openai-responses", "anthropic-messages"].includes(config.api.type)
  )
    return null;
  try {
    const url = new URL(config.api.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    let pathname = url.pathname.replace(/\/+$/, "");
    // Messages 的配置允许网关根地址；与推理 adapter 一致补齐 /v1，避免可聊天却拉取 404。
    if (config.api.type === "anthropic-messages" && !pathname.toLowerCase().endsWith("/v1")) {
      pathname += "/v1";
    }
    url.pathname = pathname + "/models";
    return url;
  } catch {
    return null;
  }
}

export function createProviderModelDiscovery(
  fetcher: typeof fetch = globalThis.fetch,
): ProviderModelDiscoveryContract {
  return {
    async discover(config): Promise<ProviderModelDiscoveryResult> {
      const url = endpoint(config);
      if (!url) return { ok: false, error: "invalid-connection" };
      const signal = AbortSignal.timeout(15_000);
      try {
        const headers = new Headers({ accept: "application/json" });
        const key = isApiKeyAccess(config.access) ? config.access.apiKey?.trim() : undefined;
        if (config.api?.type === "anthropic-messages") {
          headers.set("anthropic-version", "2023-06-01");
          if (key) headers.set("x-api-key", key);
        } else if (key) headers.set("authorization", `Bearer ${key}`);
        for (const [name, value] of Object.entries(config.api?.headers ?? {}))
          headers.set(name, value);
        const ids = new Set<string>();
        const cursors = new Set<string>();
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const response = await fetcher(new URL(url), { headers, signal, redirect: "error" });
          if (!response.ok) {
            await response.body?.cancel();
            const status = response.status;
            return {
              ok: false,
              error:
                status === 401 || status === 403
                  ? "authentication"
                  : status === 404 || status === 405
                    ? "unsupported"
                    : status === 429
                      ? "rate-limited"
                      : "http-error",
              status,
            };
          }
          const body = await readJson(response);
          if (
            !body ||
            typeof body !== "object" ||
            !Array.isArray((body as { data?: unknown }).data)
          )
            throw new DiscoveryError("invalid-response");
          const data = body as { data: unknown[]; has_more?: unknown; last_id?: unknown };
          for (const item of data.data) {
            const id = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
            if (
              typeof id !== "string" ||
              !id.trim() ||
              id.length > 512 ||
              Array.from(id).some(
                (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
              )
            )
              throw new DiscoveryError("invalid-response");
            ids.add(id.trim());
            if (ids.size >= MAX_MODELS) break;
          }
          const more = data.has_more === true;
          if (!more || ids.size >= MAX_MODELS || page + 1 === MAX_PAGES) {
            return {
              ok: true,
              models: [...ids].sort().map((modelId) => ({ modelId })),
              truncated:
                more ||
                data.data.length > MAX_MODELS ||
                (ids.size >= MAX_MODELS && data.data.length > 0),
            };
          }
          if (typeof data.last_id !== "string" || !data.last_id || cursors.has(data.last_id))
            throw new DiscoveryError("invalid-response");
          cursors.add(data.last_id);
          url.searchParams.set("after_id", data.last_id);
        }
        throw new DiscoveryError("invalid-response");
      } catch (error) {
        return {
          ok: false,
          error: signal.aborted
            ? "timeout"
            : error instanceof DiscoveryError
              ? error.code
              : "request-failed",
        };
      }
    },
  };
}
